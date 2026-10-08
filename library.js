'use strict';

const { OpenAI } = require('openai');

let openai;
let openaiPm;

const db = require.main.require('./src/database');
const meta = require.main.require('./src/meta');
const controllers = require('./lib/controllers');
const routeHelpers = require.main.require('./src/routes/helpers');
const socketHelpers = require.main.require('./src/socket.io/helpers');
const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const categories = require.main.require('./src/categories');
const user = require.main.require('./src/user');
const messaging = require.main.require('./src/messaging');
const api = require.main.require('./src/api');
const privileges = require.main.require('./src/privileges');
const groups = require.main.require('./src/groups');
const translator = require.main.require('./src/translator');
const sockets = require.main.require('./src/socket.io');
const socketPlugins = require.main.require('./src/socket.io/plugins');
const summary = require('./lib/summary');

const plugin = module.exports;

const defaults = {
	apikey: '',
	'chatgpt-username': '',
	enablePrivateMessages: 'off',
	model: 'gpt-3.5-turbo',
	minimumReputation: 0,
	allowedGroups: '[]',
	systemPrompt: 'You are a helpful assistant',
	summarySystemPrompt: '',
	summaryFinalSystemPrompt: '',
	summaryRenderMarkdown: 'off',
	summaryKeyMode: 'owner',
	summaryDisableCustomPrompt: 'off',
	summaryHourlyLimit: 20,
	mentionApiKey: '',
	mentionApiBaseUrl: '',
	mentionMinimumReputation: '',
	mentionAllowedGroups: '',
	pmApiKey: '',
	pmApiBaseUrl: '',
	pmMinimumReputation: '',
	pmAllowedGroups: '',
	pmNoPermissionMessage: '',
};


plugin.init = async (params) => {
	const { router /* , middleware , controllers */ } = params;
	const settings = await meta.settings.get('openai');
	if (settings && settings.apikey) {
		openai = new OpenAI({
			apiKey: settings.apikey,
			baseURL: settings.apiBaseUrl || 'https://api.openai.com/v1',
		});

		plugin.openai = openai;
	}

	if (settings && (settings.pmApiKey || settings.pmApiBaseUrl)) {
		openaiPm = new OpenAI({
			apiKey: settings.pmApiKey || settings.apikey,
			baseURL: settings.pmApiBaseUrl || 'https://api.openai.com/v1',
		});
	}

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/openai', controllers.renderAdminPage);
};

async function getSettings() {
	const settings = await meta.settings.get('openai');
	return {...defaults, ...settings };
}

plugin.actionMentionsNotify = async function (hookData) {
	try {
		const { notification } = hookData;
		// console.log('[openai] actionMentionsNotify fired, notification:', JSON.stringify(notification));

		if (!notification) {
			// console.log('[openai] no notification object, returning');
			return;
		}

		const settings = await getSettings();
		// console.log('[openai] chatgpt-username:', settings['chatgpt-username'], '| openai client:', !!openai, '| mentionApiBaseUrl:', settings.mentionApiBaseUrl || '(none)');

		const allowed = await canUseMention(notification.from, settings);
		// console.log('[openai] canUseMention for uid', notification.from, ':', allowed);
		if (!allowed) {
			return;
		}

		const chatgptusername = settings['chatgpt-username'];
		const chatgptUid = await user.getUidByUsername(chatgptusername);
		// console.log('[openai] chatgptUid:', chatgptUid);
		if (!chatgptUid) {
			// console.log('[openai] chatgpt user not found, returning');
			return;
		}

		const rawContent = await posts.getPostField(notification.pid, 'content');
		// console.log('[openai] rawContent (markdown):', rawContent && rawContent.slice(0, 150));
		// console.log('[openai] notification.tid:', notification.tid, '| rawContent starts with @username (case-insensitive):', rawContent && rawContent.toLowerCase().startsWith(`@${chatgptusername.toLowerCase()}`));
		if (notification.tid && rawContent && rawContent.toLowerCase().startsWith(`@${chatgptusername.toLowerCase()}`)) {
			const canReply = await privileges.topics.can('topics:reply', notification.tid, chatgptUid);
			// console.log('[openai] canReply:', canReply);
			if (!canReply) {
				return;
			}

			const message = rawContent.replace(new RegExp(`^@${chatgptusername}`, 'i'), '').trim();
			// console.log('[openai] message after stripping username (length:', message.length, '):', message.slice(0, 100));
			if (message.length) {
				const context = await buildMentionContext(notification);
				// console.log('[openai] context built:', context);

				const fullMessage = `[Context]\n${context}\n\n[Message]\n${message}`;
				const payload = JSON.stringify({
					tid: notification.tid,
					pid: notification.pid,
					content: fullMessage,
				});
				// console.log('[openai] sending payload to API (length:', payload.length, ')');

				if (settings.mentionApiBaseUrl) {
					await postMentionToCustomApi(payload, settings);
					// console.log('[openai] payload sent to custom API, reply will be handled externally');
				} else {
					const response = await chatComplete(payload, openai);
					// console.log('[openai] API response received (length:', response ? response.length : 0, '):', response ? response.slice(0, 100) : null);

					if (response) {
						const postData = await topics.reply({
							uid: chatgptUid,
							content: response,
							tid: notification.tid,
							toPid: notification.pid,
						});

						await user.updateOnlineUsers(chatgptUid);
						await socketHelpers.notifyNew(chatgptUid, 'newPost', {
							posts: [postData],
							'reputation:disabled': meta.config['reputation:disabled'] === 1,
							'downvote:disabled': meta.config['downvote:disabled'] === 1,
						});
						// console.log('[openai] reply posted successfully, pid:', postData && postData.pid);
					}
				}
			}
		} else {
			// console.log('[openai] condition not met: tid present =', !!notification.tid, '| rawContent =', rawContent && rawContent.slice(0, 80));
		}
	} catch (err) {
		console.error('[openai] actionMentionsNotify error:', err.stack);
	}
};

plugin.actionMessagingSave = async function (hookData) {
	try {
		const { message } = hookData;
		if (message.system) {
			return;
		}
		const settings = await getSettings();

		const chatgptusername = settings['chatgpt-username'];
		const chatgptUid = await user.getUidByUsername(chatgptusername);
		const { roomId, content, fromuid } = message;
		// don't reply to self
		if (parseInt(fromuid, 10) === parseInt(chatgptUid, 10)) {
			return;
		}

		// Check actual room membership directly against the database.
		// messaging.isUserInRoom() runs filter:messaging.isUserInRoom, which
		// moderation plugins (e.g. nodebb-plugin-admin-chats) use to grant
		// virtual access to every room — that would make the bot react to
		// every private chat on the forum.
		const [roomData, inRoom] = await Promise.all([
			messaging.getRoomData(roomId),
			db.isSortedSetMember(`chat:room:${roomId}:uids`, chatgptUid),
		]);

		if (!roomData || !inRoom) {
			return;
		}
		const isPrivate = !roomData.public && !roomData.groupChat;
		if (isPrivate && settings.enablePrivateMessages === 'off') {
			return;
		}
		const shouldReply = isPrivate || content.startsWith(`@${chatgptusername}`);

		// only reply in 1v1 chats or in public group chats when @<chat-gpt-username> is used
		if (!shouldReply) {
			return;
		}

		if (!await canUsePm(fromuid, settings)) {
			const noPermMsg = settings.pmNoPermissionMessage || await translator.translate('[[openai:no-permission-to-chat]]');
			await api.chats.post({ uid: chatgptUid, session: {} }, {
				roomId,
				message: noPermMsg,
				toMid: message.mid,
			});
			return;
		}

		let conversation = [{ role: 'user', content: message.content }];
		if (isPrivate) {
			// keep context bounded to the 20 most recent messages
			const mids = await getMessageIds(roomId, chatgptUid, 0, 19);
			let messages = await messaging.getMessagesFields(mids, ['fromuid', 'content', 'system']);
			messages = messages.filter(m => m && !m.system && m.content);
			conversation = messages.map(
				msg => ({ role: parseInt(msg.fromuid, 10) === parseInt(chatgptUid, 10) ? 'assistant' : 'user', content: msg.content })
			);
		}

		if (!conversation.length) {
			return;
		}

		const response = await chatComplete(conversation, openaiPm || openai);

		if (response) {
			await api.chats.post({ uid: chatgptUid, session: {} }, {
				roomId,
				message: response,
				toMid: isPrivate ? undefined : message.mid,
			});
		}
	} catch (err) {
		console.error(err.stack);
	}
};

function getMentionEffectiveSettings(settings) {
	const mentionMinRep = settings.mentionMinimumReputation !== '' && settings.mentionMinimumReputation != null
		? settings.mentionMinimumReputation
		: settings.minimumReputation;
	const mentionGroups = settings.mentionAllowedGroups && settings.mentionAllowedGroups !== '[]' && settings.mentionAllowedGroups !== ''
		? settings.mentionAllowedGroups
		: settings.allowedGroups;
	return { ...settings, minimumReputation: mentionMinRep, allowedGroups: mentionGroups };
}

async function canUseOpenAI(uid, settings, silent = false) {
	if (!await checkReputation(uid, settings, silent)) {
		return false;
	}
	if (!await checkGroupMembership(uid, settings, silent)) {
		return false;
	}
	return true;
}

async function canUseMention(uid, settings, silent = false) {
	return canUseOpenAI(uid, getMentionEffectiveSettings(settings), silent);
}

function getPmEffectiveSettings(settings) {
	const pmMinRep = settings.pmMinimumReputation !== '' && settings.pmMinimumReputation != null
		? settings.pmMinimumReputation
		: settings.minimumReputation;
	const pmGroups = settings.pmAllowedGroups && settings.pmAllowedGroups !== '[]' && settings.pmAllowedGroups !== ''
		? settings.pmAllowedGroups
		: settings.allowedGroups;
	return { ...settings, minimumReputation: pmMinRep, allowedGroups: pmGroups };
}

async function canUsePm(uid, settings) {
	return canUseOpenAI(uid, getPmEffectiveSettings(settings), true);
}

async function checkReputation(uid, settings, silent) {
	const reputation = await user.getUserField(uid, 'reputation');
	const hasEnoughRep = parseInt(settings.minimumReputation, 10) === 0 ||
		parseInt(reputation, 10) >= parseInt(settings.minimumReputation, 10);

	if (!hasEnoughRep && !silent) {
		sockets.server.in(`uid_${uid}`).emit('event:alert', {
			type: 'danger',
			title: '[[global:alert.error]]',
			message: `[[openai:error.need-x-reputation-to-mention, ${settings.minimumReputation}]]`,
		});
	}
	return hasEnoughRep;
}

async function checkGroupMembership(uid, settings, silent) {
	let allowedGroups = [];
	try {
		allowedGroups = JSON.parse(settings.allowedGroups) || [];
	} catch (err) {
		console.error('[openai] Failed to parse allowedGroups:', settings.allowedGroups, err);
		allowedGroups = [];
	}


	if (!allowedGroups.length) {
		return true;
	}

	const isMembers = await groups.isMemberOfGroups(uid, allowedGroups);
	const memberOfAny = isMembers.includes(true);
	if (!memberOfAny && !silent) {
		sockets.server.in(`uid_${uid}`).emit('event:alert', {
			type: 'danger',
			title: '[[global:alert.error]]',
			message: `[[error:no-privileges]]`,
		});
	}
	return memberOfAny;
}

async function postMentionToCustomApi(payload, settings) {
	const url = settings.mentionApiBaseUrl;
	const apiKey = settings.mentionApiKey || settings.apikey;
	// console.log('[openai] POSTing to custom mention API:', url);

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		},
		body: payload,
	});

	// console.log('[openai] custom API response status:', res.status);
	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`${res.status} ${errText}`);
	}

	const contentType = res.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		const data = await res.json();
		return data.content || data.response || data.message || data.reply || data.text || JSON.stringify(data);
	}
	return await res.text();
}

function stripHtml(html) {
	return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function buildMentionContext(notification) {
	const { tid, pid, from } = notification;

	const [topicData, askerUsername] = await Promise.all([
		topics.getTopicFields(tid, ['title', 'cid', 'postcount', 'tags', 'locked']),
		user.getUserField(from, 'username'),
	]);

	const lines = [];
	lines.push(`Topic: "${topicData.title}"`);

	if (topicData.cid) {
		try {
			const categoryData = await categories.getCategoryFields(topicData.cid, ['name']);
			if (categoryData && categoryData.name) {
				lines.push(`Category: ${categoryData.name}`);
			}
		} catch (e) { /* skip if unavailable */ }
	}

	try {
		let tags = topicData.tags;
		if (typeof tags === 'string') {
			tags = JSON.parse(tags);
		}
		if (Array.isArray(tags) && tags.length) {
			const tagValues = tags.map(t => (t && typeof t === 'object' ? t.value : t)).filter(Boolean);
			if (tagValues.length) {
				lines.push(`Tags: ${tagValues.join(', ')}`);
			}
		}
	} catch (e) { /* skip if unavailable */ }

	lines.push(`Posts in topic so far: ${topicData.postcount}`);

	if (parseInt(topicData.locked, 10) === 1) {
		lines.push(`Topic status: locked`);
	}

	lines.push(`Asked by: @${askerUsername}`);

	try {
		const postData = await posts.getPostFields(pid, ['toPid']);
		if (postData.toPid) {
			const toPidIndex = await posts.getPidIndex(postData.toPid, tid, 'oldest_to_newest');
			lines.push(`Replying to: post #${toPidIndex} in this topic (pid: ${postData.toPid})`);
		}
	} catch (e) { /* skip if unavailable */ }

	return lines.join('\n');
}

// Returns the newest messages (like core's getMessageIds), in chronological order
async function getMessageIds(roomId, uid, start, stop) {
	const isPublic = await db.getObjectField(`chat:room:${roomId}`, 'public');
	if (parseInt(isPublic, 10) === 1) {
		const mids = await db.getSortedSetRevRange(
			`chat:room:${roomId}:mids`, start, stop
		);
		return mids.reverse();
	}
	const userjoinTimestamp = await db.sortedSetScore(`chat:room:${roomId}:uids`, uid);
	if (userjoinTimestamp === null) {
		return [];
	}
	const mids = await db.getSortedSetRevRangeByScore(
		`chat:room:${roomId}:mids`, start, stop === -1 ? -1 : stop - start + 1, '+inf', userjoinTimestamp
	);
	return mids.reverse();
}

async function chatComplete(messages, client) {
	const openaiClient = client || openai;
	if (!openaiClient) {
		throw new Error('API not created!');
	}
	const isConversation = Array.isArray(messages);
	const { model, systemPrompt } = await getSettings();
	const conversation = [];
	if (systemPrompt) {
		conversation.push({ role: 'system', content: systemPrompt });
	}
	if (isConversation) {
		conversation.push(...messages);
	} else {
		conversation.push({ role: 'user', content: messages });
	}

	const chatCompletion = await openaiClient.chat.completions.create({
		model: model || 'gpt-3.5-turbo',
		messages: conversation,
	});

	return chatCompletion.choices[0]?.message?.content;
}

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/openai',
		icon: 'fa-robot',
		name: 'OpenAI',
	});

	return header;
};

// Tells the client whether to show the "summarize topic" button, and how the API key works.
plugin.filterTopicGet = async (hookData) => {
	try {
		const { topic, uid } = hookData;
		if (!topic || !(parseInt(uid, 10) > 0)) {
			return hookData;
		}
		const settings = await getSettings();
		const mode = getKeyMode(settings);
		const available = mode !== 'owner' || !!openai;
		if (available && await canUseOpenAI(uid, settings, true)) {
			const lang = (await user.getSettings(uid)).userLang || meta.config.defaultLang || 'en-GB';
			topic.openaiSummary = {
				label: await translator.translate('[[openai:summarize-topic]]', lang),
				mode,
				customPrompt: settings.summaryDisableCustomPrompt !== 'on',
				defaultPrompt: (settings.summarySystemPrompt || '').trim(),
				renderMarkdown: settings.summaryRenderMarkdown === 'on',
			};
		}
	} catch (err) {
		console.error('[openai] filterTopicGet failed:', err.message);
	}
	return hookData;
};

plugin.actionTopicReply = async (hookData) => {
	await summary.clearTopicSummary([hookData.post.tid]);
};

plugin.actionPostEdit = async (hookData) => {
	await summary.clearTopicSummary([hookData.post.tid]);
};

plugin.actionPostsPurge = async (hookData) => {
	const { posts } = hookData;
	const uniqTids = [...new Set(posts.map(p => p.tid))];
	await summary.clearTopicSummary(uniqTids);
};

plugin.actionPostRestore = async (hookData) => {
	await summary.clearTopicSummary([hookData.post.tid]);
};

plugin.actionPostDelete = async (hookData) => {
	await summary.clearTopicSummary([hookData.post.tid]);
};

plugin.actionPostMove = async (hookData) => {
	await summary.clearTopicSummary([hookData.post.tid, hookData.tid]);
};

plugin.actionPostChangeOwner = async (hookData) => {
	const { posts } = hookData;
	const uniqTids = [...new Set(posts.map(p => p.tid))];
	await summary.clearTopicSummary(uniqTids);
};

socketPlugins.openai = {};

function getKeyMode(settings) {
	return ['owner', 'user', 'both'].includes(settings.summaryKeyMode) ? settings.summaryKeyMode : 'owner';
}

// Who pays for a request: the forum's key, or the key the user typed in their own browser.
// A user's key is used for this request only and is never stored on the server.
function pickClient(settings, userKey) {
	const mode = getKeyMode(settings);
	const key = typeof userKey === 'string' ? userKey.trim().slice(0, 400) : '';
	if (mode !== 'owner' && key) {
		return {
			client: new OpenAI({ apiKey: key, baseURL: settings.apiBaseUrl || 'https://api.openai.com/v1' }),
			own: false,
		};
	}
	if (mode === 'user' || (mode === 'both' && !openai)) {
		throw new Error('[[openai:error.api-key-required]]');
	}
	if (!openai) {
		throw new Error('[[openai:error.not-configured]]');
	}
	return { client: openai, own: true };
}

// Requests that spend the forum's key are limited per user (administrators are exempt).
const usage = new Map();
const COOLDOWN_MS = 10 * 1000;

async function checkRateLimit(uid, settings) {
	const configured = settings.summaryHourlyLimit;
	const limit = configured === '' || configured == null ? 20 : parseInt(configured, 10);
	if (!(limit > 0) || await user.isAdministrator(uid)) {
		return;
	}
	const now = Date.now();
	const recent = (usage.get(uid) || []).filter(t => now - t < 3600 * 1000);
	if (recent.length >= limit || (recent.length && now - recent[recent.length - 1] < COOLDOWN_MS)) {
		usage.set(uid, recent);
		throw new Error('[[openai:error.rate-limited]]');
	}
	recent.push(now);
	usage.set(uid, recent);
}

// Gemini answers a wrong key with a bare 400, OpenAI with 401. With the forum's own key a refusal is
// the admin's problem, so only a user's key is reported as invalid.
function translateApiError(err, own) {
	if (err && (err.cancelled || err.name === 'APIUserAbortError')) {
		return new Error('[[openai:error.cancelled]]');
	}
	if (err && !own && [400, 401, 403].includes(err.status)) {
		return new Error('[[openai:error.invalid-key]]');
	}
	if (err && err.status === 429) {
		return new Error('[[openai:error.provider-rate-limited]]');
	}
	if (err && err.message && err.message.startsWith('[[')) {
		return err;
	}
	console.error('[openai] request failed:', err && err.stack);
	return new Error('[[openai:error.request-failed]]');
}

// Running requests, so the user can stop one (and stop paying for it). A job belongs to the socket's user.
const jobs = new Map();

function startJob(socket, jobId) {
	if (typeof jobId !== 'string' || !/^[\w-]{1,64}$/.test(jobId)) {
		return { signal: undefined, onProgress: () => {}, end: () => {} };
	}
	const controller = new AbortController();
	jobs.set(jobId, { uid: socket.uid, controller });
	return {
		signal: controller.signal,
		onProgress: data => sockets.server.in(`uid_${socket.uid}`).emit('event:openai.progress', { jobId, ...data }),
		end: () => jobs.delete(jobId),
	};
}

function readHistory(history) {
	if (!Array.isArray(history)) {
		return [];
	}
	return history
		.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
		.slice(-8)
		.map(m => ({ role: m.role, content: m.content.slice(0, 3000) }));
}

async function assertSummaryAccess(socket, tid) {
	if (!(parseInt(socket.uid, 10) > 0) || !await privileges.topics.can('topics:read', tid, socket.uid)) {
		throw new Error('[[error:no-privileges]]');
	}
	const settings = await getSettings();
	if (!await canUseOpenAI(socket.uid, settings)) {
		throw new Error('[[error:no-privileges]]');
	}
	return settings;
}

socketPlugins.openai.summarizeTopic = async function (socket, data) {
	const tid = parseInt(data && data.tid, 10);
	if (!(tid > 0)) {
		throw new Error('[[error:invalid-data]]');
	}
	const settings = await assertSummaryAccess(socket, tid);
	const customPrompt = settings.summaryDisableCustomPrompt === 'on' || typeof data.prompt !== 'string' ?
		'' : data.prompt.trim().slice(0, 4000);
	const { client, own } = pickClient(settings, data.apiKey);
	const renderMarkdown = settings.summaryRenderMarkdown === 'on';

	// the shared summary is only for the plain request on the forum's key
	const shareable = own && !customPrompt;
	if (shareable && !data.force) {
		const cached = await topics.getTopicField(tid, 'openai:summary');
		if (cached) {
			let meta = {};
			try {
				meta = JSON.parse(await db.getObjectField(`topic:${tid}`, 'openai:summaryMeta')) || {};
			} catch (err) { /* cached before meta existed */ }
			return { summary: summary.stripReasoning(cached), fetched: meta.fetched, total: meta.total, cached: true, renderMarkdown };
		}
	}

	if (own) {
		await checkRateLimit(socket.uid, settings);
	}
	const job = startJob(socket, data.jobId);
	let result;
	try {
		result = await summary.summarizeTopic(tid, client, settings, {
			prompt: customPrompt,
			signal: job.signal,
			onProgress: job.onProgress,
		});
	} catch (err) {
		throw translateApiError(err, own);
	} finally {
		job.end();
	}
	if (!result.summary) {
		throw new Error('[[openai:error.empty-topic]]');
	}
	if (shareable) {
		await topics.setTopicField(tid, 'openai:summary', result.summary);
		await db.setObjectField(`topic:${tid}`, 'openai:summaryMeta', JSON.stringify({ fetched: result.fetched, total: result.total }));
	}
	return { ...result, cached: false, renderMarkdown };
};

socketPlugins.openai.askTopic = async function (socket, data) {
	const tid = parseInt(data && data.tid, 10);
	const question = data && typeof data.question === 'string' ? data.question.trim().slice(0, 1000) : '';
	if (!(tid > 0) || !question) {
		throw new Error('[[error:invalid-data]]');
	}
	const settings = await assertSummaryAccess(socket, tid);
	const { client, own } = pickClient(settings, data.apiKey);
	if (own) {
		await checkRateLimit(socket.uid, settings);
	}
	const job = startJob(socket, data.jobId);
	let answer;
	try {
		answer = await summary.askTopic(tid, question, client, settings, {
			history: readHistory(data.history),
			signal: job.signal,
		});
	} catch (err) {
		throw translateApiError(err, own);
	} finally {
		job.end();
	}
	return { answer };
};

socketPlugins.openai.cancel = async function (socket, data) {
	const job = jobs.get(data && data.jobId);
	if (job && job.uid === socket.uid) {
		job.controller.abort();
		jobs.delete(data.jobId);
	}
};
