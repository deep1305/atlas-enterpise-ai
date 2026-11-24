/* Atlas Enterprise AI: front end for the FastAPI app in app/main.py */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const ALLOWED = ['.pdf', '.docx', '.txt', '.md'];
  const MAX_BYTES = 10 * 1024 * 1024;   // matches max_upload_bytes in config.py
  const CONV_KEY = 'atlas.conversation';

  const ICONS = {
    up: '<svg viewBox="0 0 24 24"><path d="M7 10v10H4V10zM7 10l4-7c1.5 0 2.5 1 2.2 2.5L12.5 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M17 14V4h3v10zM17 14l-4 7c-1.5 0-2.5-1-2.2-2.5l.7-3.5H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 4H17"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  };

  // ---------- Small helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };

  function timeAgo(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return '';
    const s = Math.round((Date.now() - d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function banner(msg) {
    const b = $('#banner');
    b.textContent = msg || '';
    b.hidden = !msg;
  }

  // ---------- API ----------
  async function api(path, options = {}) {
    const opts = { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new Error('Cannot reach the server. Is it running?');
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) {
      let detail = data && data.detail;
      if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join('; ');
      const err = new Error(detail || `Request failed (${res.status})`);
      err.status = res.status;
      if (res.status === 401) banner('Sign-in is not configured. For local demos set DEMO_MODE=true in .env and restart the server.');
      throw err;
    }
    return data;
  }

  // ---------- Navigation ----------
  const loaders = {};
  function show(view) {
    if (!$('#view-' + view)) view = 'chat';
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-item').forEach((n) => {
      const on = n.dataset.view === view;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    if (location.hash !== '#' + view) history.replaceState(null, '', view === 'chat' ? location.pathname : '#' + view);
    if (loaders[view]) loaders[view]();
    if (view === 'chat') $('#question').focus();
  }
  $$('.nav-item').forEach((n) => n.addEventListener('click', () => show(n.dataset.view)));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // ---------- Health ----------
  async function checkHealth() {
    const dot = $('#healthDot');
    const text = $('#healthText');
    try {
      await api('/health/ready');
      dot.className = 'dot ok';
      text.textContent = 'All systems ready';
    } catch {
      dot.className = 'dot bad';
      text.textContent = 'Database unavailable';
    }
  }

  // ---------- Answer formatting ----------
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[(\d{1,2})\]/g, '<button type="button" class="cite" data-cite="$1" aria-label="Show source $1">$1</button>');
  }

  function formatAnswer(text) {
    const lines = esc(text).split(/\r?\n/);
    let html = '';
    let list = null;
    let para = [];
    const flushPara = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
    const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      const ul = line.match(/^[-*•]\s+(.*)/);
      const ol = line.match(/^\d+[.)]\s+(.*)/);
      if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        if (list !== type) { flushList(); html += `<${type}>`; list = type; }
        html += `<li>${inline((ul || ol)[1])}</li>`;
      } else if (!line) {
        flushPara(); flushList();
      } else {
        flushList(); para.push(line);
      }
    }
    flushPara(); flushList();
    return html || '<p></p>';
  }

  // ---------- Chat ----------
  const messagesEl = $('#messages');
  const form = $('#chatForm');
  const input = $('#question');
  const sendBtn = $('#sendBtn');
  let conversationId = store.get(CONV_KEY);
  let busy = false;

  const STATUS_LABELS = {
    no_evidence: 'No matching evidence',
    pending_approval: 'Needs admin approval',
    guardrail_blocked: 'Blocked by guardrail',
    error: 'Request blocked',
  };

  function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function hideEmpty() { const e = $('#emptyChat'); if (e) e.hidden = true; }

  function addUser(text) {
    hideEmpty();
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `<div class="bubble">${esc(text)}</div>`;
    messagesEl.appendChild(el);
    scrollDown();
  }

  function addTyping() {
    hideEmpty();
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = '<div class="avatar">A</div><div class="body"><div class="bubble"><div class="typing" aria-label="Atlas is thinking"><span></span><span></span><span></span></div></div></div>';
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  // "novacore_company_information.pdf" -> { name: "Novacore Company Information", type: "PDF" }
  function prettyTitle(title) {
    const raw = String(title || 'Document');
    const m = raw.match(/\.([a-z0-9]{2,5})$/i);
    const base = (m ? raw.slice(0, -m[0].length) : raw).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const name = base.replace(/\b[a-z]/g, (c) => c.toUpperCase()) || 'Document';
    return { name, type: m ? m[1].toUpperCase() : '' };
  }

  // Tidy a chunk excerpt: drop a repeated page header, partial words at the edges.
  function cleanExcerpt(text) {
    const original = String(text || '');
    const truncated = original.length >= 300;   // the API cuts excerpts at 320 chars
    let t = original.replace(/\s+/g, ' ').trim();
    const header = t.match(/^.{0,90}?\bPage \d+\s+/i);   // e.g. "Acme - Internal Handbook Page 2 "
    if (header) t = t.slice(header[0].length);
    let lead = '';
    if (/^[a-z]/.test(t) && t.includes(' ')) { t = t.slice(t.indexOf(' ') + 1); lead = '…'; }
    let tail = '';
    if (truncated && t.lastIndexOf(' ') > 40) {
      t = t.slice(0, t.lastIndexOf(' ')).replace(/[,;:\-–]+$/, '');
      if (!/[.!?]$/.test(t)) tail = '…';
    }
    return lead + t + tail;
  }

  function citedNumbers(answer) {
    return new Set([...String(answer || '').matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  }

  function renderSources(sources, answer) {
    if (!sources || !sources.length) return '';
    const nums = citedNumbers(answer);
    let used = sources.filter((s) => nums.has(Number(s.index)));
    let other = sources.filter((s) => !nums.has(Number(s.index)));
    if (!used.length) { used = sources; other = []; }   // answer had no citations: show everything

    // One card per document, listing the cited passages inside it.
    const groups = new Map();
    for (const s of used) {
      const key = s.document_id || s.title;
      if (!groups.has(key)) groups.set(key, { title: s.title, passages: [] });
      groups.get(key).passages.push(s);
    }
    const cards = [...groups.values()].map((g) => {
      const { name, type } = prettyTitle(g.title);
      const pages = [...new Set(g.passages.map((p) => p.page ?? 1))].sort((a, b) => a - b);
      return `
      <div class="doc-source">
        <div class="doc-head">
          <span class="doc-icon">${ICONS.file}</span>
          <span class="doc-title" title="${esc(g.title)}">${esc(name)}</span>
          ${type ? `<span class="doc-type">${esc(type)}</span>` : ''}
          <span class="doc-pages">${pages.length > 1 ? 'pp.' : 'p.'} ${esc(pages.join(', '))}</span>
        </div>
        ${g.passages.map((p) => `
          <div class="passage" data-source="${esc(p.index)}">
            <span class="cite">${esc(p.index)}</span>
            <p class="passage-text">${esc(cleanExcerpt(p.excerpt))}</p>
          </div>`).join('')}
      </div>`;
    }).join('');

    const more = other.length ? `
      <details class="more-sources">
        <summary>${other.length} other passage${other.length > 1 ? 's' : ''} searched <span class="muted">· not used in this answer</span></summary>
        ${other.map((p) => `
          <div class="passage other" data-source="${esc(p.index)}">
            <span class="cite">${esc(p.index)}</span>
            <div>
              <div class="passage-meta">${esc(prettyTitle(p.title).name)} · p. ${esc(p.page ?? 1)}</div>
              <p class="passage-text">${esc(cleanExcerpt(p.excerpt))}</p>
            </div>
          </div>`).join('')}
      </details>` : '';

    return `<div class="sources-block">
      <div class="sources-label">Source${groups.size > 1 ? 's' : ''}</div>
      ${cards}${more}
    </div>`;
  }

  function addBot(result, el = null, withActions = true) {
    hideEmpty();
    if (!el) {
      el = document.createElement('div');
      el.className = 'msg bot';
      messagesEl.appendChild(el);
    }
    const status = result.status || 'answered';
    const tag = STATUS_LABELS[status] ? `<div class="status-tag ${esc(status)}">${esc(STATUS_LABELS[status])}</div>` : '';
    const actions = withActions && status === 'answered' ? `
      <div class="msg-actions">
        <span class="actions-label">Was this helpful?</span>
        <button type="button" class="icon-btn" data-rate="1" title="Helpful" aria-label="Helpful">${ICONS.up}</button>
        <button type="button" class="icon-btn" data-rate="-1" title="Not helpful" aria-label="Not helpful">${ICONS.down}</button>
        <button type="button" class="icon-btn" data-copy title="Copy answer" aria-label="Copy answer">${ICONS.copy}</button>
      </div>` : '';
    el.innerHTML = `<div class="avatar">A</div>
      <div class="body">
        <div class="bubble">${tag}${formatAnswer(result.answer)}</div>
        ${renderSources(result.sources, result.answer)}
        ${actions}
      </div>`;
    el._result = result;
    scrollDown();
    return el;
  }

  async function send(question) {
    question = question.trim();
    if (busy || !question) return;
    if (question.length < 3) { toast('Please ask a longer question.'); return; }
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    autosize();
    addUser(question);
    const pending = addTyping();
    try {
      const body = { question };
      if (conversationId) body.conversation_id = conversationId;
      const result = await api('/api/chat', { method: 'POST', body });
      if (result.conversation_id) {
        conversationId = result.conversation_id;
        store.set(CONV_KEY, conversationId);
      }
      addBot(result, pending);
      if (result.status === 'pending_approval') refreshApprovalBadge();
    } catch (err) {
      addBot({ answer: err.message, status: 'error', sources: [] }, pending, false);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  async function loadConversation() {
    if (!conversationId) return;
    try {
      const data = await api(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
      const msgs = (data && data.messages) || [];
      if (!msgs.length) return;
      for (const m of msgs) {
        if (m.role === 'user') addUser(m.content);
        else addBot({ answer: m.content, status: 'history', sources: [] }, null, false);
      }
    } catch (err) {
      if (err.status !== 401) { store.del(CONV_KEY); conversationId = null; }
    }
  }

  function newChat() {
    conversationId = null;
    store.del(CONV_KEY);
    $$('.msg', messagesEl).forEach((m) => m.remove());
    $('#emptyChat').hidden = false;
    input.focus();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden';
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  $('#newChatBtn').addEventListener('click', newChat);
  $$('.suggestions .chip').forEach((c) => c.addEventListener('click', () => send(c.textContent)));

  messagesEl.addEventListener('click', async (e) => {
    const cite = e.target.closest('.bubble .cite');
    if (cite) {
      const msg = cite.closest('.msg');
      const src = $(`.passage[data-source="${cite.dataset.cite}"]`, msg);
      if (src) {
        const details = src.closest('details');
        if (details) details.open = true;
        src.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        src.classList.add('flash');
        setTimeout(() => src.classList.remove('flash'), 1400);
      }
      return;
    }
    const rate = e.target.closest('[data-rate]');
    if (rate) {
      const msg = rate.closest('.msg');
      if (msg.dataset.rated) return;
      const sources = (msg._result && msg._result.sources) || [];
      try {
        await api('/api/feedback', {
          method: 'POST',
          body: { rating: Number(rate.dataset.rate), document_id: sources[0] ? sources[0].document_id : null, note: '' },
        });
        msg.dataset.rated = '1';
        rate.classList.add('on');
        $$('[data-rate]', msg).forEach((b) => { b.disabled = true; });
        toast('Thanks for the feedback');
      } catch (err) { toast(err.message); }
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const text = copy.closest('.msg')._result.answer;
      try {
        await navigator.clipboard.writeText(text);
        copy.innerHTML = ICONS.check;
        setTimeout(() => { copy.innerHTML = ICONS.copy; }, 1500);
      } catch { toast('Copy failed'); }
    }
  });

  // ---------- Documents ----------
  const STEP_LABELS = { request: 'Preparing…', upload: 'Uploading to S3…', index: 'Chunking & embedding…' };

  async function loadDocuments() {
    const tbody = $('#docRows');
    try {
      const { documents = [] } = await api('/api/documents');
      if (!documents.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No documents yet. Upload one above to get started.</div></td></tr>`;
        return;
      }
      tbody.innerHTML = documents.map((d) => `
        <tr>
          <td>${esc(d.title)}</td>
          <td><span class="pill ${esc(d.status)}">${esc(d.status)}</span></td>
          <td class="hide-sm">v${esc(d.current_version)}</td>
          <td class="hide-sm muted" title="${esc(d.created_at)}">${esc(timeAgo(d.created_at))}</td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted center">${esc(err.message)}</td></tr>`;
    }
  }
  loaders.documents = loadDocuments;

  function uploadRow(name) {
    const li = document.createElement('li');
    li.className = 'upload';
    li.innerHTML = `<div class="spinner"></div><span class="upload-name"></span><span class="upload-step"></span>`;
    $('.upload-name', li).textContent = name;
    $('#uploads').prepend(li);
    return {
      step(label) { $('.upload-step', li).textContent = label; },
      done(ok, label) {
        $('.spinner', li).outerHTML = `<span class="pill ${ok ? 'ready' : 'failed'}">${ok ? 'ready' : 'failed'}</span>`;
        $('.upload-step', li).textContent = label;
        if (ok) setTimeout(() => li.remove(), 4000);
      },
    };
  }

  async function uploadFile(file) {
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const row = uploadRow(file.name);
    if (!ALLOWED.includes(ext)) return row.done(false, 'Only PDF, DOCX, TXT or MD');
    if (file.size > MAX_BYTES) return row.done(false, 'Larger than 10 MB');
    if (file.size === 0) return row.done(false, 'File is empty');
    let docId = null;
    try {
      row.step(STEP_LABELS.request);
      const slot = await api('/api/documents/uploads', { method: 'POST', body: { filename: file.name } });
      docId = slot.document_id;

      row.step(STEP_LABELS.upload);
      let put;
      try {
        put = await fetch(slot.upload_url, { method: 'PUT', headers: slot.headers || {}, body: file });
      } catch {
        throw new Error('S3 upload blocked. Check the bucket CORS settings.');
      }
      if (!put.ok) throw new Error(`S3 upload failed (${put.status})`);

      row.step(STEP_LABELS.index);
      await api('/api/documents/complete', { method: 'POST', body: { document_id: docId } });
      row.done(true, 'Indexed and searchable');
    } catch (err) {
      row.done(false, err.message);
    } finally {
      if (docId) loadDocuments();
    }
  }

  async function handleFiles(files) {
    const list = [...files];
    if (!list.length) return;
    for (const f of list) await uploadFile(f);   // one at a time: ingestion is synchronous
  }

  const dz = $('#dropzone');
  $('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  $('#refreshDocsBtn').addEventListener('click', loadDocuments);

  // ---------- Approvals ----------
  function setBadge(n) {
    const b = $('#approvalBadge');
    b.textContent = n;
    b.hidden = !n;
  }

  async function refreshApprovalBadge() {
    try {
      const { approvals = [] } = await api('/api/approvals');
      setBadge(approvals.filter((a) => a.status === 'pending').length);
      return approvals;
    } catch { return null; }
  }

  async function loadApprovals() {
    const box = $('#approvalList');
    try {
      const { approvals = [] } = await api('/api/approvals');
      setBadge(approvals.filter((a) => a.status === 'pending').length);
      if (!approvals.length) {
        box.innerHTML = `<div class="card empty-state"><div class="empty-icon">${ICONS.shield}</div>No approval requests yet.</div>`;
        return;
      }
      box.innerHTML = approvals.map((a) => `
        <div class="card approval">
          <div class="approval-main">
            <p class="approval-q">${esc(a.question)}</p>
            <div class="approval-meta">
              <span>From ${esc(a.requester)}</span>
              <span>${esc(timeAgo(a.created_at))}</span>
              ${a.reviewer ? `<span>Reviewed by ${esc(a.reviewer)} · ${esc(timeAgo(a.reviewed_at))}</span>` : ''}
            </div>
          </div>
          <div class="approval-actions">
            ${a.status === 'pending'
              ? `<button class="btn sm ok" data-decide="${esc(a.id)}" data-approve="true">Approve</button>
                 <button class="btn sm bad" data-decide="${esc(a.id)}" data-approve="false">Reject</button>`
              : `<span class="pill ${esc(a.status)}">${esc(a.status)}</span>`}
          </div>
        </div>`).join('');
    } catch (err) {
      box.innerHTML = `<div class="card empty-state">${esc(err.status === 403 ? 'Only admins can review approvals.' : err.message)}</div>`;
    }
  }
  loaders.approvals = loadApprovals;

  $('#approvalList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-decide]');
    if (!btn) return;
    $$('[data-decide]', btn.parentElement).forEach((b) => { b.disabled = true; });
    try {
      const r = await api(`/api/approvals/${encodeURIComponent(btn.dataset.decide)}/decision`, {
        method: 'POST', body: { approve: btn.dataset.approve === 'true' },
      });
      toast(`Request ${r.status}. No action was executed automatically.`);
    } catch (err) { toast(err.message); }
    loadApprovals();
  });
  $('#refreshApprovalsBtn').addEventListener('click', loadApprovals);

  // ---------- Insights ----------
  function bars(rows, total, classFor = () => '') {
    if (!rows.length) return '<p class="muted small">No data yet.</p>';
    return rows.map((r) => {
      const pct = total ? Math.round((r.value / total) * 100) : 0;
      return `<div class="bar-row">
        <span class="bar-label">${esc(r.label)}</span>
        <div class="bar-track"><div class="bar-fill ${esc(classFor(r))}" style="width:${pct}%"></div></div>
        <span class="bar-num">${esc(r.value)}</span>
      </div>`;
    }).join('');
  }

  async function loadInsights() {
    const statsEl = $('#stats');
    try {
      const [m, g] = await Promise.all([
        api('/api/admin/metrics'),
        api('/api/admin/guardrails').catch(() => ({ events: [], mode: '' })),
      ]);
      const docs = (m.documents || []).map((d) => ({ label: d.status, value: Number(d.total) }));
      const totalDocs = docs.reduce((s, d) => s + d.value, 0);
      const ready = (docs.find((d) => d.label === 'ready') || { value: 0 }).value;
      const fb = m.feedback || [];
      const up = Number((fb.find((f) => Number(f.rating) === 1) || { total: 0 }).total);
      const down = Number((fb.find((f) => Number(f.rating) === -1) || { total: 0 }).total);
      const helpful = up + down ? Math.round((up / (up + down)) * 100) + '%' : '—';
      const events = (g.events || []).map((e) => ({
        label: e.action === 'guardrail_input_blocked' ? 'Input blocked' : 'Output blocked',
        value: Number(e.total),
      }));
      const blocks = events.reduce((s, e) => s + e.value, 0);

      statsEl.innerHTML = [
        ['Documents', totalDocs, `${ready} ready to search`],
        ['Helpful answers', helpful, `${up} up · ${down} down`],
        ['Guardrail blocks', blocks, 'input + output'],
      ].map(([label, value, note]) => `
        <div class="card stat">
          <div class="stat-label">${esc(label)}</div>
          <div class="stat-value">${esc(value)}</div>
          <div class="stat-note">${esc(note)}</div>
        </div>`).join('');

      $('#docBars').innerHTML = bars(docs, totalDocs, (r) => r.label);
      $('#guardBars').innerHTML = bars(events, blocks, () => 'bad');
      $('#guardMode').textContent = g.mode
        ? `Mode: ${g.mode.replace(/_/g, ' ')} · Managed Bedrock Guardrails ${g.managed_bedrock_guardrails ? 'on' : 'off'}`
        : '';
    } catch (err) {
      statsEl.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      $('#docBars').innerHTML = '';
      $('#guardBars').innerHTML = '';
    }
  }
  loaders.insights = loadInsights;
  $('#refreshInsightsBtn').addEventListener('click', loadInsights);

  // ---------- Start ----------
  checkHealth();
  loadConversation();
  refreshApprovalBadge();
  show(location.hash.slice(1) || 'chat');
})();
