// ===== Cloudflare Worker: Telegram Mini App + secure post relay =====
// Environment variables (Settings -> Variables):
//   BOT_TOKEN  -> your bot token from BotFather (Encrypt this one)
//   CHANNELS   -> JSON list of channels, e.g.
//                 [{"label":"Main","chat_id":"@Postt4k"},{"label":"Backup","chat_id":"@Postt4k2"}]
//   (or, for a single channel, just set CHAT_ID -> @yourchannel)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/api/post' && request.method === 'POST') {
      return handlePost(request, env);
    }

    return new Response(renderPage(env), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function getChannels(env) {
  if (env.CHANNELS) {
    try {
      const parsed = JSON.parse(env.CHANNELS);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (e) { /* fall through */ }
  }
  if (env.CHAT_ID) return [{ label: 'Default', chat_id: env.CHAT_ID }];
  return [];
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatText(raw) {
  if (!raw) return '';
  return raw.split('\n').map(line => {
    let isQuote = false, content = line;
    if (/^\s*>\s?/.test(line)) { isQuote = true; content = line.replace(/^\s*>\s?/, ''); }
    let escaped = escapeHtml(content);
    escaped = escaped.replace(/\*(.+?)\*/g, '<b>$1</b>');
    escaped = escaped.replace(/_(.+?)_/g, '<i>$1</i>');
    escaped = escaped.replace(/~(.+?)~/g, '<tg-spoiler>$1</tg-spoiler>');
    escaped = escaped.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    return isQuote ? `<blockquote>${escaped}</blockquote>` : escaped;
  }).join('\n');
}

function buildMessage(name, tag, caption) {
  let msg = formatText(name);
  if (tag) {
    const tags = tag.split(',').map(t => t.trim()).filter(Boolean).map(t => `#${escapeHtml(t.replace(/\s+/g, ''))}`);
    if (tags.length) msg += `  <i>${tags.join(' ')}</i>`;
  }
  if (caption) msg += `\n\n${formatText(caption)}`;
  return msg;
}

async function handlePost(request, env) {
  try {
    const incoming = await request.formData();
    const name = incoming.get('name') || '';
    const tag = incoming.get('tag') || '';
    const caption = incoming.get('caption') || '';
    const imageUrl = incoming.get('imageUrl') || '';
    const photoFile = incoming.get('photo');
    const requestedChatId = incoming.get('chat_id') || '';
    const btnText = (incoming.get('btnText') || '').trim();
    const btnUrl = (incoming.get('btnUrl') || '').trim();

    const channels = getChannels(env);
    const match = channels.find(c => c.chat_id === requestedChatId);
    const chatId = match ? match.chat_id : (channels[0] && channels[0].chat_id);

    if (!chatId) {
      return new Response(JSON.stringify({ ok: false, description: 'No channel configured on the server.' }), {
        status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const text = buildMessage(name, tag, caption);
    const token = env.BOT_TOKEN;

    let replyMarkup = null;
    if (btnText && btnUrl) {
      replyMarkup = { inline_keyboard: [[{ text: btnText, url: btnUrl }]] };
    }

    let tgResp;
    if (photoFile && typeof photoFile === 'object' && photoFile.size > 0) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', text);
      form.append('parse_mode', 'HTML');
      form.append('photo', photoFile, photoFile.name || 'photo.jpg');
      if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
      tgResp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    } else if (imageUrl) {
      const body = { chat_id: chatId, photo: imageUrl, caption: text, parse_mode: 'HTML' };
      if (replyMarkup) body.reply_markup = replyMarkup;
      tgResp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      const body = { chat_id: chatId, text: text, parse_mode: 'HTML' };
      if (replyMarkup) body.reply_markup = replyMarkup;
      tgResp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    const data = await tgResp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, description: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
}

function renderPage(env) {
  const channels = getChannels(env);
  const channelsJson = JSON.stringify(channels).replace(/</g, '\\u003c');
  return HTML_PAGE.replace('__CHANNELS_JSON__', channelsJson);
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quick Post</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html { background: #0b0b0d; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background:
      radial-gradient(ellipse 900px 500px at 50% -10%, rgba(201,160,92,0.08), transparent 60%),
      #0b0b0d;
    color: #f0ece3;
    min-height: 100vh;
    position: relative;
  }
  body::before {
    content: "";
    position: fixed; inset: 0; pointer-events: none;
    opacity: 0.05; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    z-index: 0;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid #201d20;
    position: relative; z-index: 1;
  }
  .header .brand { display: flex; align-items: center; gap: 9px; }
  .header .dot { width: 8px; height: 8px; border-radius: 50%; background: #c9a05c; box-shadow: 0 0 8px rgba(201,160,92,0.6); }
  .header .brand-name { font-family: Georgia, serif; font-size: 16px; color: #f0ece3; letter-spacing: 0.3px; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 22px 18px 60px; position: relative; z-index: 1; }
  h1 { font-family: Georgia, 'Iowan Old Style', serif; font-size: 24px; font-weight: 400; letter-spacing: 0.2px; margin: 2px 0; color: #f5f0e6; }
  .sub { color: #8a8578; font-size: 13px; margin-bottom: 20px; }
  .tabs { display: flex; gap: 22px; margin-bottom: 20px; border-bottom: 1px solid #232025; }
  .tab { padding: 8px 2px 12px; font-size: 14px; cursor: pointer; color: #746f66; user-select: none; position: relative; letter-spacing: 0.3px; }
  .tab.active { color: #e9e2d3; }
  .tab.active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #c9a05c; border-radius: 2px; }
  .card { background: #131215; border: 1px solid #221f22; border-radius: 14px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.25); }
  label { display: block; font-size: 11px; color: #948e80; margin-bottom: 7px; margin-top: 16px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
  label:first-child { margin-top: 0; }
  input, textarea, select {
    width: 100%; background: #0e0d10; border: 1px solid #26232a;
    border-radius: 10px; padding: 11px 13px; color: #f0ece3; font-size: 15px;
    font-family: inherit; resize: vertical; transition: border-color 0.15s ease;
  }
  select { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='%23948e80'/></svg>"); background-repeat: no-repeat; background-position: right 14px center; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: #c9a05c; box-shadow: 0 0 0 3px rgba(201,160,92,0.12); }
  textarea { min-height: 80px; }
  button { width: 100%; padding: 14px; border-radius: 11px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 18px; letter-spacing: 0.2px; transition: transform 0.1s ease, opacity 0.15s ease; }
  button:active { transform: scale(0.98); }
  .btn-primary { background: linear-gradient(180deg, #d6ac68, #c08f45); color: #1a1408; }
  .btn-secondary { background: #1c1a1e; color: #d8d2c4; border: 1px solid #2c2830; margin-top: 10px; }
  .row { display: flex; gap: 8px; align-items: flex-end; }
  .row > div { flex: 1; }
  .preview { background: #0e0d10; border: 1px dashed #33303a; border-radius: 10px; padding: 14px 16px; font-size: 14px; line-height: 1.65; white-space: pre-wrap; margin-top: 16px; color: #c9c3b6; }
  .status { font-size: 13px; margin-top: 12px; text-align: center; min-height: 18px; }
  .status.ok { color: #7fc98f; }
  .status.err { color: #e58a8a; }
  .hint { font-size: 12px; color: #6b665e; margin-top: 7px; line-height: 1.4; }
  .post-item { background: #131215; border-radius: 12px; padding: 14px; margin-bottom: 10px; border: 1px solid #221f22; border-left: 2px solid #c9a05c; }
  .post-item .name { font-weight: 600; font-size: 14px; color: #f0ece3; }
  .post-item .tag { font-size: 11px; color: #c9a05c; margin-left: 7px; }
  .post-item .cap { font-size: 13px; color: #948e80; margin-top: 5px; }
  .post-item .date { font-size: 11px; color: #524d46; margin-top: 8px; }
  .post-item .actions { display: flex; gap: 8px; margin-top: 10px; }
  .post-item .actions button { margin-top: 0; padding: 8px 12px; font-size: 12px; width: auto; flex: 1; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .chip { background: #1c1a1e; border: 1px solid #2c2830; color: #c9c3b6; font-size: 12px; padding: 6px 10px; border-radius: 999px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .chip .x { color: #6b665e; font-weight: 700; }
  .empty { text-align: center; color: #6b665e; font-size: 14px; padding: 34px 0; }
  .fmt-row { display: flex; gap: 6px; margin-top: 8px; }
  .fmt-btn {
    flex: 0 0 auto; width: auto; padding: 6px 12px; margin-top: 0;
    background: #1c1a1e; border: 1px solid #2c2830; color: #c9c3b6;
    font-size: 13px; font-weight: 600; border-radius: 8px;
  }
  .fmt-btn:active { background: #c9a05c; color: #1a1408; border-color: #c9a05c; }
  .fmt-btn.i-style { font-style: italic; }
  .fmt-btn.s-style { text-decoration: line-through; }
  .link-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: none; align-items: center; justify-content: center; z-index: 50; padding: 20px;
  }
  .link-overlay.show { display: flex; }
  .link-box { width: 100%; max-width: 360px; margin: 0; }
</style>
</head>
<body>
<div class="header">
  <div class="brand"><span class="dot"></span><span class="brand-name">Quick Post</span></div>
</div>
<div class="wrap">
  <div class="sub">Fill in, tap post. Done.</div>

  <div class="tabs">
    <div class="tab active" data-tab="post">Post</div>
    <div class="tab" data-tab="history">History</div>
  </div>

  <div id="tab-post">
    <div class="card">
      <label>Channel</label>
      <select id="f-channel"></select>

      <label>Name</label>
      <input id="f-name" placeholder="e.g. Priya Sharma">
      <div class="fmt-row">
        <button type="button" class="fmt-btn" data-field="f-name" data-wrap="bold"><b>B</b></button>
        <button type="button" class="fmt-btn i-style" data-field="f-name" data-wrap="italic">I</button>
        <button type="button" class="fmt-btn s-style" data-field="f-name" data-wrap="spoiler">S</button>
        <button type="button" class="fmt-btn" data-field="f-name" data-wrap="quote">"</button>
        <button type="button" class="fmt-btn" data-field="f-name" data-wrap="link">🔗</button>
      </div>

      <label>Category / Tag</label>
      <input id="f-tag" placeholder="e.g. Bollywood, Actress, HD">
      <div class="hint">Separate multiple tags with commas.</div>
      <label>Caption / Details</label>
      <textarea id="f-caption" placeholder="Short details..."></textarea>
      <div class="fmt-row">
        <button type="button" class="fmt-btn" data-field="f-caption" data-wrap="bold"><b>B</b></button>
        <button type="button" class="fmt-btn i-style" data-field="f-caption" data-wrap="italic">I</button>
        <button type="button" class="fmt-btn s-style" data-field="f-caption" data-wrap="spoiler">S</button>
        <button type="button" class="fmt-btn" data-field="f-caption" data-wrap="quote">"</button>
        <button type="button" class="fmt-btn" data-field="f-caption" data-wrap="link">🔗</button>
      </div>
      <div class="hint">Select text and tap a button, or tap with nothing selected to insert markers. Quote applies to the whole line. Link asks for a URL after you tap it.</div>

      <label>Structure templates</label>
      <div class="hint">Save your whole layout (name, tags, caption, button) and reuse it — fill in just the changing details each time.</div>
      <div class="row">
        <div><input id="tpl-name" placeholder="Template name, e.g. Daily Post"></div>
      </div>
      <button class="btn-secondary" id="btn-save-tpl" type="button">Save current post as template</button>
      <div class="chip-row" id="tpl-list"></div>

      <label>Image (optional)</label>
      <input type="file" id="f-image-file" accept="image/*">
      <div class="hint">Or paste an image URL instead:</div>
      <input id="f-image-url" placeholder="https://...">

      <label>Button (optional)</label>
      <div class="row">
        <div><input id="f-btn-text" placeholder="Button text, e.g. VIEW CHANNEL"></div>
      </div>
      <input id="f-btn-url" placeholder="https://t.me/yourchannel" style="margin-top:8px;">
      <div class="hint">Adds a tappable link button under the post, like your "VIEW CHANNEL" button.</div>

      <div class="preview" id="preview"></div>
      <button class="btn-primary" id="btn-post">Post to Telegram</button>
      <div class="status" id="status"></div>
    </div>
  </div>

  <div id="tab-history" style="display:none">
    <div class="card">
      <label>Search</label>
      <input id="search-box" placeholder="Search by name, tag, caption...">
    </div>
    <div id="history-list"></div>
  </div>
</div>

<div class="link-overlay" id="link-overlay">
  <div class="card link-box">
    <label>Link URL</label>
    <input id="link-url-input" placeholder="https://t.me/yourchannel">
    <button class="btn-primary" id="link-insert-btn" type="button">Insert Link</button>
    <button class="btn-secondary" id="link-cancel-btn" type="button">Cancel</button>
  </div>
</div>

<script>
const CHANNELS = __CHANNELS_JSON__;
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

const $ = id => document.getElementById(id);

// Populate channel dropdown
const channelSelect = $('f-channel');
if (CHANNELS.length === 0) {
  channelSelect.innerHTML = '<option value="">No channel configured</option>';
} else {
  channelSelect.innerHTML = CHANNELS.map(c => \`<option value="\${c.chat_id}">\${c.label}</option>\`).join('');
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ['post','history'].forEach(t => { $('tab-'+t).style.display = (t === tab.dataset.tab) ? 'block' : 'none'; });
    if (tab.dataset.tab === 'history') loadHistory();
  });
});

function updatePreview() {
  const name = $('f-name').value.trim();
  const tag = $('f-tag').value.trim();
  const caption = $('f-caption').value.trim();
  if (!name && !tag && !caption) { $('preview').textContent = 'Preview will appear here...'; return; }
  let plain = name;
  if (tag) plain += \`  #\${tag.replace(/\\s+/g,'')}\`;
  if (caption) plain += \`\\n\\n\${caption}\`;
  $('preview').textContent = plain;
}
['f-name','f-tag','f-caption'].forEach(id => $(id).addEventListener('input', updatePreview));
updatePreview();

// ---- Tap-to-format toolbar ----
const MARKS = { bold: ['*','*'], italic: ['_','_'], spoiler: ['~','~'] };

function wrapSelection(field, before, after) {
  const start = field.selectionStart;
  const end = field.selectionEnd;
  const val = field.value;
  const selected = val.slice(start, end);
  field.value = val.slice(0, start) + before + selected + after + val.slice(end);
  if (selected.length === 0) {
    field.selectionStart = field.selectionEnd = start + before.length;
  } else {
    field.selectionStart = start;
    field.selectionEnd = end + before.length + after.length;
  }
}

function applyQuote(field) {
  const start = field.selectionStart;
  const end = field.selectionEnd;
  const val = field.value;
  let lineStart = val.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = val.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allQuoted = lines.every(l => /^\s*>\s?/.test(l) || l.trim() === '');
  const newLines = lines.map(l => {
    if (l.trim() === '') return l;
    return allQuoted ? l.replace(/^\s*>\s?/, '') : '> ' + l;
  });
  const newBlock = newLines.join('\n');
  field.value = val.slice(0, lineStart) + newBlock + val.slice(lineEnd);
  field.selectionStart = lineStart;
  field.selectionEnd = lineStart + newBlock.length;
}

let linkTarget = null, linkSelStart = 0, linkSelEnd = 0;

function openLinkOverlay(field) {
  linkTarget = field;
  linkSelStart = field.selectionStart;
  linkSelEnd = field.selectionEnd;
  $('link-url-input').value = '';
  $('link-overlay').classList.add('show');
  setTimeout(() => $('link-url-input').focus(), 50);
}

$('link-cancel-btn').addEventListener('click', () => {
  $('link-overlay').classList.remove('show');
});

$('link-insert-btn').addEventListener('click', () => {
  const url = $('link-url-input').value.trim();
  $('link-overlay').classList.remove('show');
  if (!url || !linkTarget) return;
  const val = linkTarget.value;
  const selected = val.slice(linkSelStart, linkSelEnd) || 'link';
  const inserted = \`[\${selected}](\${url})\`;
  linkTarget.value = val.slice(0, linkSelStart) + inserted + val.slice(linkSelEnd);
  updatePreview();
});

document.querySelectorAll('.fmt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const field = $(btn.dataset.field);
    const type = btn.dataset.wrap;
    if (type === 'quote') {
      applyQuote(field);
    } else if (type === 'link') {
      openLinkOverlay(field);
      return;
    } else {
      wrapSelection(field, MARKS[type][0], MARKS[type][1]);
    }
    field.focus();
    updatePreview();
  });
});

$('f-image-url').addEventListener('input', () => { if ($('f-image-url').value.trim()) $('f-image-file').value = ''; });
$('f-image-file').addEventListener('change', () => { if ($('f-image-file').files.length) $('f-image-url').value = ''; });

function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---- Templates ----
function getTemplates() { return JSON.parse(localStorage.getItem('te
