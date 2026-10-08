'use strict';

const db = require.main.require('./src/database');
const batch = require.main.require('./src/batch');
const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const user = require.main.require('./src/user');

// A thread up to this size goes to the model in one request. Longer threads are summarized in
// parts and the part summaries are merged. Anything beyond MAX_TOTAL_CHARS is cut.
const SINGLE_REQUEST_CHARS = 100000;
const CHUNK_CHARS = 60000;
const MAX_TOTAL_CHARS = 400000;

const DEFAULT_SYSTEM_PROMPT = 'You summarize discussion forum threads into concise summaries. ' +
	'Write the summary in the language of the discussion. Do not open with phrases like "Here is a summary"; ' +
	'go straight to the content. Do not invent anything that is not in the text.';
const DEFAULT_FINAL_PROMPT = 'You are an assistant that summarizes forum thread summaries into a single cohesive summary.';

function stripReasoning(text) {
	if (!text) return text;
	return text
		.replace(/<thought>[\s\S]*?<\/thought>/gi, '')
		.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
		.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
		.replace(/^<thought>[\s\S]*$/i, '')
		.replace(/^<thinking>[\s\S]*$/i, '')
		.trim();
}

function formatPost(post, index) {
	return `--- Post ${index + 1} by ${post.username} ---\n${post.content.trim()}\n`;
}

// Reads the visible posts of a topic (raw markdown, deleted posts skipped).
// Returns the formatted entries, how many posts were read and how many the topic has.
async function readThread(tid) {
	const [allPids, total] = await Promise.all([
		topics.getPids(tid),
		topics.getTopicField(tid, 'postcount'),
	]);
	const userMap = {};
	const entries = [];
	let index = 0;

	await batch.processArray(allPids, async (pids) => {
		let postData = await posts.getPostsFields(pids, ['uid', 'content', 'deleted']);
		postData = postData.filter(p => p && !p.deleted && p.content && p.content.trim());
		const missingUids = [...new Set(postData.map(p => p.uid).filter(uid => !userMap.hasOwnProperty(uid)))];
		if (missingUids.length) {
			const userData = await user.getUsersFields(missingUids, ['username', 'displayname']);
			userData.forEach((u) => {
				userMap[u.uid] = u.displayname || u.username || 'user';
			});
		}
		postData.forEach((p) => {
			p.username = userMap[p.uid] || 'user';
			entries.push(formatPost(p, index));
			index += 1;
		});
	}, { batch: 500 });

	return { entries, fetched: entries.length, total: parseInt(total, 10) || entries.length };
}

function joinEntries(entries, limit) {
	let text = '';
	for (const entry of entries) {
		if (text.length + entry.length > limit) {
			return `${text}\n...[the rest of the discussion was cut because of its length]...`;
		}
		text += `${entry}\n`;
	}
	return text;
}

function chunkEntries(entries) {
	const chunks = [];
	let current = '';
	let total = 0;
	for (const entry of entries) {
		if (total + entry.length > MAX_TOTAL_CHARS) {
			break;
		}
		if (current && current.length + entry.length > CHUNK_CHARS) {
			chunks.push(current);
			current = '';
		}
		current += `${entry}\n`;
		total += entry.length;
	}
	if (current) {
		chunks.push(current);
	}
	return chunks;
}

function cancelled() {
	return Object.assign(new Error('[[openai:error.cancelled]]'), { cancelled: true });
}

function ensureNotCancelled(signal) {
	if (signal && signal.aborted) {
		throw cancelled();
	}
}

async function completeMessages(client, settings, messages, signal) {
	ensureNotCancelled(signal);
	const response = await client.chat.completions.create({
		model: settings.model || 'gpt-3.5-turbo',
		messages,
		temperature: 0.5,
	}, signal ? { signal } : undefined);
	return stripReasoning(response.choices[0] && response.choices[0].message.content) || '';
}

function complete(client, settings, system, content, signal) {
	return completeMessages(client, settings, [
		{ role: 'system', content: system },
		{ role: 'user', content },
	], signal);
}

// prompt (optional) replaces the system prompt from the settings, for a user's own prompt.
// options: { prompt, signal, onProgress }. onProgress gets { stage: 'read' | 'summarize' | 'merge', ... }.
exports.summarizeTopic = async function (tid, client, settings, options = {}) {
	const { prompt, signal } = options;
	const onProgress = options.onProgress || (() => {});
	const { entries, fetched, total } = await readThread(tid);
	onProgress({ stage: 'read', fetched, total });
	if (!entries.length) {
		return { summary: '', fetched, total };
	}
	const systemPrompt = (prompt && prompt.trim()) ||
		(settings.summarySystemPrompt && settings.summarySystemPrompt.trim()) ||
		DEFAULT_SYSTEM_PROMPT;

	const single = joinEntries(entries, SINGLE_REQUEST_CHARS);
	if (entries.join('\n').length <= SINGLE_REQUEST_CHARS) {
		onProgress({ stage: 'summarize', done: 0, total: 1 });
		return {
			summary: await complete(client, settings, systemPrompt, `Summarize the following discussion thread:\n\n${single}`, signal),
			fetched,
			total,
		};
	}

	const chunkSummaries = [];
	const chunks = chunkEntries(entries);
	for (const chunk of chunks) {
		onProgress({ stage: 'summarize', done: chunkSummaries.length, total: chunks.length });
		// sequential on purpose: parallel requests trip the rate limits of the free API tiers
		// eslint-disable-next-line no-await-in-loop
		chunkSummaries.push(await complete(client, settings, systemPrompt, `Summarize the following part of a discussion thread:\n\n${chunk}`, signal));
	}
	onProgress({ stage: 'merge' });
	const finalPrompt = (prompt && prompt.trim()) ||
		(settings.summaryFinalSystemPrompt && settings.summaryFinalSystemPrompt.trim()) ||
		DEFAULT_FINAL_PROMPT;
	const summary = await complete(
		client, settings, finalPrompt,
		`Here are summaries of parts of a forum discussion:\n\n${chunkSummaries.join('\n\n')}\n\nPlease write a final, concise summary of the full discussion.`,
		signal
	);
	return { summary, fetched, total };
};

// Answers a question from the thread only. history: earlier turns of this conversation
// ([{ role: 'user' | 'assistant', content }]), so follow-up questions make sense.
exports.askTopic = async function (tid, question, client, settings, options = {}) {
	const { entries } = await readThread(tid);
	if (!entries.length) {
		return '';
	}
	let thread = entries.join('\n');
	if (thread.length > SINGLE_REQUEST_CHARS) {
		const half = SINGLE_REQUEST_CHARS / 2;
		thread = `${thread.slice(0, half)}\n...[middle of the discussion cut because of its length]...\n${thread.slice(-half)}`;
	}
	const system = 'You answer questions about a forum discussion. Base the answer only on the discussion below. ' +
		'If the answer is not in the discussion, say so and do not invent anything. ' +
		'Answer briefly and to the point, in the language of the question. Basic markdown is allowed. ' +
		`The user may ask follow-up questions; use the earlier questions and answers for context.\n\nDiscussion:\n${thread}`;
	return completeMessages(client, settings, [
		{ role: 'system', content: system },
		...(options.history || []),
		{ role: 'user', content: question },
	], options.signal);
};

exports.stripReasoning = stripReasoning;

exports.clearTopicSummary = async function (tids) {
	await db.deleteObjectFields(tids.map(tid => `topic:${tid}`), ['openai:summary', 'openai:summaryMeta']);
};
