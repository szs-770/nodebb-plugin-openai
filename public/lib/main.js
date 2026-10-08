'use strict';

/*
 * "Summarize topic" button in the topic toolbar, with a dialog that shows the summary, keeps the
 * last versions and a history in the browser, answers questions about the discussion, and can
 * publish the summary as a reply. Whether the forum's API key or the user's own key is used is a
 * setting (ajaxify.data.openaiSummary.mode, added by the filter:topic.get hook); a user's key stays
 * in this browser and is sent with each request.
 */
$(document).ready(function () {
	const KEY = 'openai-summary:key';
	const PROMPT = 'openai-summary:prompt';
	const HISTORY = 'openai-summary:history';
	const versionsKey = tid => `openai-summary:versions:${tid}`;
	const MAX_VERSIONS = 5;
	const MAX_HISTORY = 20;

	let lastConfig = null;

	function store(key, value) {
		try {
			if (value === undefined) {
				return localStorage.getItem(key);
			}
			if (value === null) {
				localStorage.removeItem(key);
			} else {
				localStorage.setItem(key, value);
			}
		} catch (err) { /* private mode or blocked storage: the feature still works, nothing is remembered */ }
		return null;
	}

	function readJson(key, fallback) {
		try {
			const value = JSON.parse(store(key) || 'null');
			return Array.isArray(fallback) && !Array.isArray(value) ? fallback : (value || fallback);
		} catch (err) {
			return fallback;
		}
	}

	function config() {
		const data = ajaxify.data && ajaxify.data.openaiSummary;
		if (data) {
			lastConfig = data;
		}
		return lastConfig || { mode: 'owner', customPrompt: true, defaultPrompt: '' };
	}

	// NodeBB bundles client scripts with webpack, so every require() needs a literal module list
	function modules() {
		return new Promise((resolve) => {
			require(['bootbox', 'alerts', 'translator'], function (bootbox, alerts, translator) {
				resolve({ bootbox, alerts, translator });
			});
		});
	}

	// core's modals.dialog only translates plain keys as button labels, so the strings are translated here
	async function openDialog(opts) {
		const { bootbox, translator } = await modules();
		const buttons = {};
		await Promise.all(Object.keys(opts.buttons || {}).map(async (name) => {
			buttons[name] = { ...opts.buttons[name], label: await translator.translate(opts.buttons[name].label) };
		}));
		const [title, message] = await Promise.all([translator.translate(opts.title || ''), translator.translate(opts.message || '')]);
		return bootbox.dialog({ ...opts, title, message, buttons });
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	// ---- markdown (escaped first, then a small safe subset) ----

	function renderInline(s) {
		return s
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/__([^_]+)__/g, '<strong>$1</strong>')
			.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
			.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
			.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
	}

	function renderMarkdownSafe(md) {
		const lines = escapeHtml(md).split(/\r?\n/);
		const out = [];
		let list = null;
		let inCode = false;
		let para = [];
		const flushPara = () => {
			if (para.length) {
				out.push(`<p class="mb-2">${renderInline(para.join(' '))}</p>`);
				para = [];
			}
		};
		const closeList = () => {
			if (list) {
				out.push(`</${list}>`);
				list = null;
			}
		};
		const openList = (type) => {
			if (list !== type) {
				closeList();
				out.push(`<${type} class="mb-2">`);
				list = type;
			}
		};
		for (const raw of lines) {
			if (/^```/.test(raw)) {
				flushPara();
				closeList();
				out.push(inCode ? '</code></pre>' : '<pre class="p-2 rounded bg-body-secondary" dir="ltr"><code>');
				inCode = !inCode;
				continue;
			}
			if (inCode) {
				out.push(raw);
				continue;
			}
			const heading = raw.match(/^(#{1,6})\s+(.*)$/);
			if (heading) {
				flushPara();
				closeList();
				out.push(`<h${heading[1].length < 3 ? 5 : 6} class="fw-semibold mt-3 mb-2">${renderInline(heading[2])}</h${heading[1].length < 3 ? 5 : 6}>`);
				continue;
			}
			const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
			if (ul) {
				flushPara();
				openList('ul');
				out.push(`<li>${renderInline(ul[1])}</li>`);
				continue;
			}
			const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
			if (ol) {
				flushPara();
				openList('ol');
				out.push(`<li>${renderInline(ol[1])}</li>`);
				continue;
			}
			if (!raw.trim()) {
				flushPara();
				closeList();
				continue;
			}
			closeList();
			para.push(raw);
		}
		flushPara();
		closeList();
		if (inCode) {
			out.push('</code></pre>');
		}
		return out.join('\n');
	}

	// ---- saved versions and history (this browser only) ----

	function getVersions(tid) {
		return readJson(versionsKey(tid), []);
	}

	function saveVersion(tid, version) {
		const versions = getVersions(tid);
		const last = versions[versions.length - 1];
		if (!last || last.text !== version.text) {
			versions.push(version);
		}
		while (versions.length > MAX_VERSIONS) {
			versions.shift();
		}
		store(versionsKey(tid), JSON.stringify(versions));
		return versions;
	}

	function addHistory(tid, title) {
		let history = readJson(HISTORY, []).filter(h => String(h.tid) !== String(tid));
		history.unshift({ tid, title, date: Date.now() });
		history.slice(MAX_HISTORY).forEach(h => store(versionsKey(h.tid), null));
		history = history.slice(0, MAX_HISTORY);
		store(HISTORY, JSON.stringify(history));
	}

	function titleOf(tid) {
		if (ajaxify.data && String(ajaxify.data.tid) === String(tid)) {
			return ajaxify.data.titleRaw || ajaxify.data.title || '';
		}
		const entry = readJson(HISTORY, []).find(h => String(h.tid) === String(tid));
		return entry ? entry.title : '';
	}

	// ---- helpers over the NodeBB modules ----

	async function translateHtml(html) {
		const { translator } = await modules();
		return translator.translate(html);
	}

	async function setHtml($el, html) {
		$el.html(await translateHtml(html));
	}

	function request(event, data) {
		return new Promise((resolve, reject) => {
			socket.emit(event, data, (err, res) => (err ? reject(err) : resolve(res)));
		});
	}

	// progress of a running request, pushed by the server (event:openai.progress) and matched by job id
	const progressHandlers = {};
	let progressListening = false;

	function newJobId() {
		return `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	}

	function listenForProgress() {
		if (!progressListening) {
			progressListening = true;
			socket.on('event:openai.progress', (data) => {
				if (data && progressHandlers[data.jobId]) {
					progressHandlers[data.jobId](data);
				}
			});
		}
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text);
		}
		return new Promise((resolve) => {
			const area = document.createElement('textarea');
			area.value = text;
			document.body.appendChild(area);
			area.select();
			document.execCommand('copy');
			area.remove();
			resolve();
		});
	}

	// ---- the user's own API key ----

	async function promptKey(onSaved) {
				const hasKey = !!store(KEY);
		const buttons = {
			save: {
				label: '[[openai:btn-save]]',
				className: 'btn-primary openai-key-save',
				callback: function () {
					const value = (this.find('.openai-key-input').val() || '').trim();
					if (!value) {
						return false;
					}
					store(KEY, value);
					if (onSaved) {
						onSaved();
					}
					return true;
				},
			},
			cancel: { label: '[[openai:btn-cancel]]', className: 'btn-ghost' },
		};
		if (hasKey) {
			buttons.remove = {
				label: '[[openai:btn-remove-key]]',
				className: 'btn-ghost text-danger',
				callback: function () {
					store(KEY, null);
					return true;
				},
			};
		}
		const dialog = await openDialog({
			title: '[[openai:key-title]]',
			message: '<p>[[openai:key-help]]</p>' +
				'<input type="password" class="form-control openai-key-input" autocomplete="off" spellcheck="false" dir="ltr" placeholder="API key">' +
				'<p class="form-text mt-2 mb-0">[[openai:key-privacy]]</p>',
			buttons,
		});
		dialog.on('keydown', '.openai-key-input', function (e) {
			if (e.key === 'Enter') {
				dialog.find('.openai-key-save').trigger('click');
			}
		});
		dialog.on('shown.bs.modal', () => dialog.find('.openai-key-input').trigger('focus'));
	}

	// ---- custom prompt ----

	async function promptEditor(reopen, startOver) {
				const current = store(PROMPT) || config().defaultPrompt || '';
		await openDialog({
			title: '[[openai:prompt-title]]',
			message: '<p class="text-sm text-muted">[[openai:prompt-help]]</p>' +
				`<textarea class="form-control openai-prompt-input" rows="12" style="resize:vertical">${escapeHtml(current)}</textarea>`,
			size: 'large',
			buttons: {
				save: {
					label: '[[openai:btn-save-resummarize]]',
					className: 'btn-primary',
					callback: function () {
						const value = (this.find('.openai-prompt-input').val() || '').trim();
						// text equal to the forum's default is not stored, so later changes of the default apply
						store(PROMPT, value && value !== config().defaultPrompt ? value : null);
						startOver();
						return true;
					},
				},
				cancel: { label: '[[openai:btn-cancel]]', className: 'btn-ghost', callback: () => reopen() },
			},
		});
	}

	// ---- history list ----

	async function showHistory() {
				const history = readJson(HISTORY, []);
		const items = history.map(h => `<a href="#" class="list-group-item list-group-item-action openai-history-item" data-tid="${parseInt(h.tid, 10)}">
				<div class="fw-semibold">${escapeHtml(h.title || h.tid)}</div>
				<small class="text-muted">${escapeHtml(new Date(h.date).toLocaleString())}</small>
			</a>`).join('');
		const dialog = await openDialog({
			title: '[[openai:history-title, ' + MAX_HISTORY + ']]',
			message: history.length ?
				`<div class="list-group" style="max-height:60vh;overflow-y:auto">${items}</div>` :
				'<p class="mb-0">[[openai:history-empty]]</p>',
			buttons: { close: { label: '[[openai:btn-close]]', className: 'btn-primary' } },
		});
		dialog.on('click', '.openai-history-item', function (e) {
			e.preventDefault();
			const tid = parseInt($(this).attr('data-tid'), 10);
			dialog.modal('hide');
			openSummary(tid);
		});
	}

	// ---- summarizing in the background: a small toast, and the dialog opens when the summary is ready ----

	const running = {};

	function toastEl() {
		let $toast = $('#openai-toast');
		if (!$toast.length) {
			$toast = $('<div id="openai-toast" class="openai-toast" role="status" aria-live="polite"></div>').appendTo('body');
		}
		return $toast;
	}

	function showToast(html) {
		const $toast = toastEl();
		translateHtml(html).then((translated) => {
			$toast.html(translated);
			requestAnimationFrame(() => $toast.addClass('show'));
		});
	}

	function hideToast() {
		$('#openai-toast').removeClass('show');
	}

	function progressText(data) {
		if (data.stage === 'read') {
			return `[[openai:progress-read, ${parseInt(data.fetched, 10) || 0}]]`;
		}
		if (data.stage === 'summarize') {
			return data.total > 1 ? `[[openai:progress-part, ${data.done + 1}, ${data.total}]]` : '[[openai:progress-summarizing]]';
		}
		return data.stage === 'merge' ? '[[openai:progress-merge]]' : '';
	}

	function toastHtml(text, percent) {
		return `<i class="fa fa-spinner fa-spin text-primary"></i>
			<span class="openai-toast-text">${text}</span>
			${percent === null ? '' : `<span class="openai-toast-bar"><span style="width:${percent}%"></span></span>`}
			<button type="button" class="btn btn-ghost btn-sm openai-toast-stop" aria-label="[[openai:btn-stop]]"><i class="fa fa-xmark"></i></button>`;
	}

	function handleSummaryError(err, tid, force) {
		const message = (err && err.message) || '[[openai:error.request-failed]]';
		require(['alerts'], function (alerts) {
			alerts.error(message);
		});
		if (/api-key-required|invalid-key/.test(message)) {
			if (/invalid-key/.test(message)) {
				store(KEY, null);
			}
			promptKey(() => startSummary(tid, force));
		}
	}

	async function startSummary(tid, force) {
		if (running[tid]) {
			return;
		}
		listenForProgress();
		const job = { id: newJobId(), cancelled: false };
		running[tid] = job;
		const title = titleOf(tid);
		progressHandlers[job.id] = (data) => {
			const text = progressText(data);
			if (text) {
				showToast(toastHtml(text, data.stage === 'merge' ? 100 : (data.total > 1 ? Math.round((data.done / data.total) * 100) : null)));
			}
		};
		showToast(toastHtml('[[openai:progress-start]]', null));
		try {
			const res = await request('plugins.openai.summarizeTopic', {
				tid,
				jobId: job.id,
				force: !!force,
				apiKey: store(KEY) || '',
				prompt: config().customPrompt ? (store(PROMPT) || '') : '',
			});
			if (job.cancelled) {
				return;
			}
			saveVersion(tid, { text: res.summary, date: Date.now(), fetched: res.fetched, total: res.total });
			addHistory(tid, title);
			if (ajaxify.data && String(ajaxify.data.tid) === String(tid)) {
				hideToast();
				openSummary(tid, { fresh: !res.cached });
			} else {
				// the user has moved on to another topic: don't pop a dialog over it, offer it instead
				showToast(`<i class="fa fa-wand-magic-sparkles text-primary"></i>
					<span class="openai-toast-text">[[openai:summary-ready]]</span>
					<button type="button" class="btn btn-primary btn-sm openai-toast-show">[[openai:btn-show]]</button>
					<button type="button" class="btn btn-ghost btn-sm openai-toast-close" aria-label="[[openai:btn-close]]"><i class="fa fa-xmark"></i></button>`);
				$('#openai-toast').data('tid', tid).data('fresh', !res.cached);
			}
		} catch (err) {
			if (!job.cancelled) {
				hideToast();
				handleSummaryError(err, tid, force);
			}
		} finally {
			delete progressHandlers[job.id];
			delete running[tid];
		}
	}

	$(document).on('click', '.openai-toast-stop', function () {
		Object.keys(running).forEach((tid) => {
			const job = running[tid];
			job.cancelled = true;
			socket.emit('plugins.openai.cancel', { jobId: job.id });
			delete running[tid];
		});
		hideToast();
	});
	$(document).on('click', '.openai-toast-close', hideToast);
	$(document).on('click', '.openai-toast-show', function () {
		const $toast = $('#openai-toast');
		hideToast();
		openSummary($toast.data('tid'), { fresh: !!$toast.data('fresh') });
	});

	// ---- the summary dialog ----

	async function openSummary(tid, options) {
		const { alerts } = await modules();
		const title = titleOf(tid);
		const state = { versions: getVersions(tid), index: 0 };
		if (!state.versions.length) {
			// nothing saved yet: summarize in the background, the dialog opens when the summary is ready
			startSummary(tid, false);
			return;
		}
		state.index = state.versions.length - 1;
		const mode = config().mode;

		const buttons = {
			publish: {
				label: '<i class="fa fa-reply"></i> [[openai:btn-publish]]',
				className: 'btn-success',
				callback: () => publish(),
			},
			copy: {
				label: '<i class="fa fa-clone"></i> [[openai:btn-copy]]',
				className: 'btn-ghost openai-copy-btn',
				callback: () => copy(),
			},
			history: {
				label: '<i class="fa fa-clock-rotate-left"></i> [[openai:btn-history]]',
				className: 'btn-ghost',
				callback: () => {
					showHistory();
					return true;
				},
			},
			refresh: {
				label: '<i class="fa fa-rotate"></i> [[openai:btn-refresh]]',
				className: 'btn-ghost',
				callback: () => {
					startSummary(tid, true);
					return true;
				},
			},
		};
		if (config().customPrompt) {
			buttons.prompt = {
				label: '<i class="fa fa-sliders"></i> [[openai:btn-prompt]]',
				className: 'btn-ghost',
				callback: () => {
					promptEditor(() => openSummary(tid), () => startSummary(tid, true));
					return true;
				},
			};
		}
		if (mode !== 'owner') {
			buttons.key = {
				label: '<i class="fa fa-key"></i> [[openai:btn-key]]',
				className: 'btn-ghost',
				callback: () => {
					promptKey();
					return true;
				},
			};
		}

		buttons.close = { label: '[[openai:btn-close]]', className: 'btn-primary openai-close-btn' };

		const dialog = await openDialog({
			title: '[[openai:topic-summary]]',
			message: `<div class="openai-summary">
				<div class="openai-info text-xs text-muted mb-2"></div>
				<div class="openai-nav d-flex justify-content-between align-items-center border rounded p-2 mb-3 hidden">
					<button type="button" class="btn btn-ghost btn-sm openai-prev"><i class="fa fa-chevron-right"></i> [[openai:version-older]]</button>
					<small class="openai-version-label text-muted"></small>
					<button type="button" class="btn btn-ghost btn-sm openai-next">[[openai:version-newer]] <i class="fa fa-chevron-left"></i></button>
				</div>
				<div class="openai-content"></div>
				<div class="openai-chat mt-4 pt-3 border-top">
					<h6 class="fw-semibold"><i class="fa fa-comments text-primary"></i> [[openai:ask-title]]</h6>
					<div class="openai-chat-log mb-2" style="max-height:220px;overflow-y:auto"></div>
					<div class="input-group">
						<input type="text" class="form-control openai-chat-input" maxlength="1000" placeholder="[[openai:ask-placeholder]]">
						<button type="button" class="btn btn-primary openai-chat-send" aria-label="[[openai:ask-send]]"><i class="fa fa-paper-plane"></i></button>
					</div>
				</div>
			</div>`,
			size: 'large',
			className: 'openai-summary-dialog',
			buttons,
		});

		const $content = dialog.find('.openai-content');
		const $info = dialog.find('.openai-info');
		const $nav = dialog.find('.openai-nav');

		function current() {
			return state.versions[state.index];
		}

		// "from memory": shown while the summary on screen was not generated just now
		state.fromCache = !(options && options.fresh);
		const badgeText = translateHtml('[[openai:from-memory]]');
		async function updateBadge() {
			const $title = dialog.find('.modal-title');
			$title.find('.openai-cached-badge').remove();
			if (state.fromCache) {
				$title.append(` <span class="badge bg-secondary openai-cached-badge">${escapeHtml(await badgeText)}</span>`);
			}
		}

		async function render() {
			const version = current();
			$nav.toggleClass('hidden', state.versions.length < 2);
			dialog.find('.openai-prev').prop('disabled', state.index === 0);
			dialog.find('.openai-next').prop('disabled', state.index === state.versions.length - 1);
			// the summary text is never passed through the translator (it could contain [[...]])
			$content.html(renderMarkdownSafe(version.text));
			// posts added to the topic since this summary was made (known only on the topic's own page)
			const live = ajaxify.data && String(ajaxify.data.tid) === String(tid) ? parseInt(ajaxify.data.postcount, 10) : 0;
			const known = parseInt(version.total, 10) || 0;
			const newer = live > known && known && state.index === state.versions.length - 1 ? live - known : 0;
			await Promise.all([
				setHtml($info, version.fetched ?
					`<i class="fa fa-circle-info"></i> [[openai:read-info, ${parseInt(version.fetched, 10)}, ${parseInt(version.total, 10) || '?'}]]` +
					(newer ? ` <a href="#" class="openai-update ms-2 fw-semibold">[[openai:stale, ${newer}]]</a>` : '') : ''),
				setHtml(dialog.find('.openai-version-label'),
					`[[openai:version-label, ${state.index + 1}, ${state.versions.length}]] · ${escapeHtml(new Date(version.date).toLocaleString())}`),
			]);
		}

		function publish() {
			const version = current();
			if (!version) {
				return false;
			}
			translateHtml('[[openai:summarized-by-ai]]').then((footer) => {
				dialog.modal('hide');
				require(['composer'], function (composer) {
					composer.newReply({ tid, title, body: `${version.text}\n\n> _${footer}_` });
				});
			});
			return false;
		}

		function copy() {
			const version = current();
			if (version) {
				copyText(version.text).then(() => {
					const $btn = dialog.find('.openai-copy-btn');
					const original = $btn.html();
					$btn.html('<i class="fa fa-check"></i>');
					setTimeout(() => $btn.html(original), 1500);
				});
			}
			return false;
		}

		dialog.on('click', '.openai-prev', () => {
			if (state.index > 0) {
				state.index -= 1;
				render();
			}
		});
		dialog.on('click', '.openai-next', () => {
			if (state.index < state.versions.length - 1) {
				state.index += 1;
				render();
			}
		});

		dialog.on('click', '.openai-update', (e) => {
			e.preventDefault();
			dialog.modal('hide');
			startSummary(tid, true);
		});

		// ---- questions about the discussion ----
		state.chat = [];
		const $log = dialog.find('.openai-chat-log');
		const $input = dialog.find('.openai-chat-input');
		const $send = dialog.find('.openai-chat-send');

		const stopLabel = translateHtml('[[openai:btn-stop]]');
		const sendLabel = translateHtml('[[openai:ask-send]]');

		async function setAsking(on) {
			$input.prop('disabled', on);
			$send.toggleClass('btn-primary', !on).toggleClass('btn-outline-danger', on)
				.html(on ? '<i class="fa fa-stop"></i>' : '<i class="fa fa-paper-plane"></i>')
				.attr('aria-label', await (on ? stopLabel : sendLabel));
		}

		function stopAsking() {
			const job = state.chatJob;
			if (!job || job.cancelled) {
				return;
			}
			job.cancelled = true;
			socket.emit('plugins.openai.cancel', { jobId: job.id });
			job.$user.remove();
			job.$pending.remove();
			$input.val(job.question);
			state.chatJob = null;
			setAsking(false);
		}

		async function ask() {
			const question = ($input.val() || '').trim();
			if (!question || state.chatJob) {
				return;
			}
			listenForProgress();
			$input.val('');
			const $user = $(`<div class="openai-chat-row openai-chat-user"><span class="openai-chat-bubble bg-success-subtle text-body">${escapeHtml(question)}</span></div>`);
			const $pending = $('<div class="openai-chat-row openai-chat-ai"><span class="openai-chat-bubble bg-body-secondary text-body"><i class="fa fa-spinner fa-spin"></i></span></div>');
			const job = { id: newJobId(), cancelled: false, question, $user, $pending };
			state.chatJob = job;
			setAsking(true);
			$log.append($user, $pending);
			$log.scrollTop($log[0].scrollHeight);
			try {
				const res = await request('plugins.openai.askTopic', {
					tid,
					question,
					jobId: job.id,
					history: state.chat,
					apiKey: store(KEY) || '',
				});
				if (job.cancelled) {
					return;
				}
				const answer = res.answer || '';
				$pending.html(`<span class="openai-chat-bubble bg-body-secondary text-body">${renderMarkdownSafe(answer)}</span>`);
				state.chat = state.chat.concat([{ role: 'user', content: question }, { role: 'assistant', content: answer }]).slice(-8);
			} catch (err) {
				if (job.cancelled) {
					return;
				}
				$pending.remove();
				$input.val(question);
				const message = (err && err.message) || '[[openai:error.request-failed]]';
				if (/invalid-key/.test(message)) {
					store(KEY, null);
				}
				alerts.error(message);
			} finally {
				if (state.chatJob === job) {
					state.chatJob = null;
					setAsking(false);
					$input.trigger('focus');
					$log.scrollTop($log[0].scrollHeight);
				}
			}
		}

		$send.on('click', () => (state.chatJob ? stopAsking() : ask()));
		$input.on('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				ask();
			}
		});

		// closing the dialog stops a question that is still running, so nobody pays for an answer nobody reads
		dialog.on('hidden.bs.modal', stopAsking);

		render();
		updateBadge();
	}

	// ---- the toolbar button ----

	let buttonLabel = '';

	function buttonHtml() {
		return `<button type="button" class="btn btn-ghost btn-sm ff-secondary d-flex gap-2 align-items-center text-truncate openai-summarize-btn" aria-label="${escapeHtml(buttonLabel)}">
			<i class="fa fa-fw fa-wand-magic-sparkles text-primary"></i>
			<span class="d-none d-md-inline fw-semibold text-truncate text-nowrap">${escapeHtml(buttonLabel)}</span>
		</button>`;
	}

	function setButtonLabel(label) {
		buttonLabel = label;
		$('.openai-summarize-btn').attr('aria-label', label).find('span').text(label);
	}

	// Runs synchronously so the button is there as soon as the page is; the label comes with the topic data
	// (translated on the server), and is only fetched by the translator if that is missing.
	function inject() {
		const data = ajaxify.data;
		const enabled = !!(data && data.openaiSummary && data.template && data.template.topic);
		if (!enabled) {
			$('.openai-summarize-btn').remove();
			return;
		}
		buttonLabel = data.openaiSummary.label || buttonLabel;
		$('.topic-main-buttons > div > div:first-child').each(function () {
			if (!$(this).children('.openai-summarize-btn').length) {
				$(this).append(buttonHtml());
			}
		});
		if (!buttonLabel) {
			translateHtml('[[openai:summarize-topic]]').then(setButtonLabel);
		}
	}

	$(document).on('click', '.openai-summarize-btn', function (e) {
		e.preventDefault();
		if (ajaxify.data && ajaxify.data.tid && !running[ajaxify.data.tid]) {
			openSummary(ajaxify.data.tid);
		}
	});

	$(window).on('action:ajaxify.end action:topic.loaded', inject);
	inject();
});
