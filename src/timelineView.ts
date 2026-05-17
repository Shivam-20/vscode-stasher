import * as vscode from 'vscode';
import { listStashes, type StashEntry } from './gitHelper';
import { isStashPinned, getStashNote, getStashLabel, LABEL_EMOJI } from './stashNotes';
import { relativeTime, isStale } from './stashAge';
import { logger } from './logger';

// ─── Panel singleton ──────────────────────────────────────────────────────────

let _panel: vscode.WebviewPanel | undefined;

export function openTimeline(context: vscode.ExtensionContext): void {
  if (_panel) {
    _panel.reveal();
    _sendStashes(context);
    return;
  }

  _panel = vscode.window.createWebviewPanel(
    'stasherTimeline',
    'Stash Timeline',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  _panel.webview.html = _buildHtml();

  _panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'ready') { _sendStashes(context); }
    if (msg.type === 'focus') {
      void vscode.commands.executeCommand('stasher.stashList.focus');
    }
  });

  _panel.onDidDispose(() => { _panel = undefined; });
  context.subscriptions.push(_panel);
  logger.info('openTimeline');
}

/** Re-send stash data to the open panel (called after any refresh). */
export function refreshTimeline(context: vscode.ExtensionContext): void {
  if (_panel) { _sendStashes(context); }
}

function _sendStashes(context: vscode.ExtensionContext): void {
  if (!_panel) { return; }
  const stashes = listStashes().map((s) => ({
    ...s,
    pinned: isStashPinned(context, s.hash),
    note:   getStashNote(context, s.hash),
    label:  getStashLabel(context, s.hash),
    labelEmoji: getStashLabel(context, s.hash) ? LABEL_EMOJI[getStashLabel(context, s.hash)!] : '',
    age:    relativeTime(s.date),
    stale:  isStale(s.date),
  }));
  _panel.webview.postMessage({ type: 'stashes', data: stashes });
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function _buildHtml(): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root{--card-radius:6px;--gap:10px;}
*{box-sizing:border-box;margin:0;padding:0;}
body{
  background:var(--vscode-editor-background);
  color:var(--vscode-editor-foreground);
  font-family:var(--vscode-font-family,system-ui,sans-serif);
  font-size:var(--vscode-font-size,13px);
  display:flex;flex-direction:column;height:100vh;overflow:hidden;
}

/* ── Header ── */
.header{
  padding:14px 18px 12px;
  border-bottom:1px solid var(--vscode-panel-border);
  flex-shrink:0;display:flex;flex-direction:column;gap:10px;
  background:var(--vscode-sideBar-background,var(--vscode-editor-background));
}
.header-row{display:flex;align-items:center;gap:12px;}
h1{font-size:15px;font-weight:700;letter-spacing:.3px;display:flex;align-items:center;gap:7px;}
.stats{display:flex;gap:14px;margin-left:auto;font-size:11px;color:var(--vscode-descriptionForeground);}
.stat{display:flex;align-items:center;gap:4px;}

/* ── Search ── */
.search-row{display:flex;gap:8px;}
.search-input{
  flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);padding:5px 10px;
  border-radius:4px;outline:none;font-size:12px;
}
.search-input:focus{border-color:var(--vscode-focusBorder);}
.icon-btn{
  background:none;border:none;color:var(--vscode-descriptionForeground);
  cursor:pointer;padding:4px 8px;border-radius:4px;font-size:13px;
}
.icon-btn:hover{background:var(--vscode-list-hoverBackground);}

/* ── Branch chips ── */
.chips{display:flex;flex-wrap:wrap;gap:5px;}
.chip{
  display:inline-flex;align-items:center;gap:4px;
  padding:2px 9px;border-radius:10px;font-size:11px;
  cursor:pointer;opacity:.55;transition:opacity .15s,transform .1s;
  color:#fff;font-weight:500;border:1px solid transparent;
}
.chip.active{opacity:1;border-color:rgba(255,255,255,.35);}
.chip:hover{opacity:.85;transform:scale(1.03);}
.chip-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.75);}

/* ── Content ── */
.content{flex:1;overflow-y:auto;padding:18px;}

/* ── Date group ── */
.date-group{margin-bottom:28px;}
.date-header{
  font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;
  color:var(--vscode-descriptionForeground);margin-bottom:10px;
  display:flex;align-items:center;gap:8px;
}
.date-header .line{flex:1;height:1px;background:var(--vscode-panel-border);margin-left:4px;}

/* ── Stash card ── */
.card{
  background:var(--vscode-editorWidget-background,var(--vscode-editor-background));
  border:1px solid var(--vscode-panel-border);
  border-left:4px solid var(--bc,#607d8b);
  border-radius:var(--card-radius);
  padding:11px 14px;margin-bottom:8px;cursor:pointer;
  transition:background .12s,transform .1s,border-left-width .1s;
  display:flex;flex-direction:column;gap:7px;
  animation:fadeUp .18s ease forwards;
}
.card:hover{
  background:var(--vscode-list-hoverBackground);
  border-left-width:5px;transform:translateX(2px);
}
.card.pinned{border-left-color:#f0c040!important;}
.card.stale{opacity:.7;}

@keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}

/* ── Card internals ── */
.card-top{display:flex;align-items:flex-start;gap:8px;}
.ref-badge{
  font-size:10px;font-family:var(--vscode-editor-font-family,monospace);
  background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);
  padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;margin-top:1px;
}
.card-msg{font-size:13px;font-weight:600;flex:1;word-break:break-word;line-height:1.45;}
.icons{display:flex;align-items:center;gap:4px;flex-shrink:0;font-size:13px;}

.card-meta{display:flex;flex-wrap:wrap;gap:7px;align-items:center;}
.branch-tag{
  font-size:10px;padding:1px 7px;border-radius:3px;
  color:#fff;font-weight:600;letter-spacing:.2px;
}
.age{font-size:11px;color:var(--vscode-descriptionForeground);}
.hash{font-size:10px;font-family:monospace;color:var(--vscode-descriptionForeground);opacity:.7;}
.stale-warn{font-size:10px;color:var(--vscode-editorWarning-foreground);}

.note{
  font-size:11px;color:var(--vscode-descriptionForeground);font-style:italic;
  border-left:2px solid var(--vscode-panel-border);padding-left:7px;
}

/* ── Empty ── */
.empty{text-align:center;padding:60px 24px;color:var(--vscode-descriptionForeground);}
.empty-icon{font-size:52px;margin-bottom:14px;}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;}
::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:3px;}
</style>
</head>
<body>
<div class="header">
  <div class="header-row">
    <h1>📦 Stash Timeline</h1>
    <div class="stats">
      <span class="stat">📚 <b id="s-total">0</b> stashes</span>
      <span class="stat">📌 <b id="s-pinned">0</b> pinned</span>
      <span class="stat">⚠️ <b id="s-stale">0</b> stale</span>
      <span class="stat">🌿 <b id="s-branches">0</b> branches</span>
    </div>
  </div>
  <div class="search-row">
    <input class="search-input" id="search" placeholder="Filter by message, branch or ref…" />
    <button class="icon-btn" id="clear-btn" title="Clear">✕</button>
  </div>
  <div class="chips" id="chips"></div>
</div>

<div class="content">
  <div class="empty" id="empty" style="display:none">
    <div class="empty-icon">📭</div>
    <div>No stashes match the current filter</div>
  </div>
  <div id="timeline"></div>
</div>

<script>
const vscode = acquireVsCodeApi();
let allStashes = [];
let activeBranches = new Set();
let searchQ = '';

const PALETTE = [
  '#4fc3f7','#81c784','#ffb74d','#f06292','#ce93d8',
  '#4db6ac','#fff176','#80cbc4','#ef9a9a','#a5d6a7',
];
const colorCache = new Map();
function getBranchColor(b) {
  if (!colorCache.has(b)) {
    let h = 0;
    for (const c of b) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    colorCache.set(b, PALETTE[Math.abs(h) % PALETTE.length]);
  }
  return colorCache.get(b);
}

function groupByDate(stashes) {
  const now = Date.now(), D = 86400000;
  const g = { Today:[], Yesterday:[], 'This Week':[], 'This Month':[], Older:[] };
  for (const s of stashes) {
    const age = now - new Date(s.date).getTime();
    if      (age < D)      g.Today.push(s);
    else if (age < 2*D)    g.Yesterday.push(s);
    else if (age < 7*D)    g['This Week'].push(s);
    else if (age < 30*D)   g['This Month'].push(s);
    else                   g.Older.push(s);
  }
  return g;
}

function renderChips() {
  const branches = [...new Set(allStashes.map(s => s.branch))];
  document.getElementById('s-branches').textContent = branches.length;
  const el = document.getElementById('chips');
  el.innerHTML = '';
  for (const b of branches) {
    const c = document.createElement('span');
    c.className = 'chip' + (activeBranches.size === 0 || activeBranches.has(b) ? ' active' : '');
    c.style.background = getBranchColor(b);
    c.innerHTML = '<span class="chip-dot"></span>' + escHtml(b);
    c.onclick = () => {
      if (activeBranches.has(b)) activeBranches.delete(b);
      else activeBranches.add(b);
      render();
    };
    el.appendChild(c);
  }
}

function filterStashes() {
  return allStashes.filter(s => {
    if (activeBranches.size > 0 && !activeBranches.has(s.branch)) return false;
    if (!searchQ) return true;
    return s.message.toLowerCase().includes(searchQ) ||
           s.branch.toLowerCase().includes(searchQ)  ||
           s.ref.toLowerCase().includes(searchQ)     ||
           (s.note||'').toLowerCase().includes(searchQ);
  });
}

function cardHtml(s) {
  const bc = getBranchColor(s.branch);
  const icons = [s.pinned ? '📌' : '', s.labelEmoji || '', s.stale ? '⚠️' : ''].filter(Boolean).join(' ');
  const note  = s.note ? '<div class="note">' + escHtml(s.note) + '</div>' : '';
  const staleW = s.stale ? '<span class="stale-warn">⚠️ Stale</span>' : '';
  return \`<div class="card\${s.pinned?' pinned':''}\${s.stale?' stale':''}" style="--bc:\${bc}" data-ref="\${escHtml(s.ref)}" onclick="focus('\${escHtml(s.ref)}')">
  <div class="card-top">
    <span class="ref-badge">\${escHtml(s.ref)}</span>
    <span class="card-msg">\${escHtml(s.message)}</span>
    <span class="icons">\${icons}</span>
  </div>
  <div class="card-meta">
    <span class="branch-tag" style="background:\${bc}">\${escHtml(s.branch)}</span>
    <span class="age">\${escHtml(s.age)}</span>
    <span class="hash">\${s.hash.substring(0,8)}</span>
    \${staleW}
  </div>
  \${note}
</div>\`;
}

function render() {
  const filtered = filterStashes();
  const tl = document.getElementById('timeline');
  const empty = document.getElementById('empty');
  document.getElementById('s-total').textContent   = allStashes.length;
  document.getElementById('s-pinned').textContent  = allStashes.filter(s=>s.pinned).length;
  document.getElementById('s-stale').textContent   = allStashes.filter(s=>s.stale).length;

  // Update chip active states
  document.querySelectorAll('.chip').forEach(c => {
    const b = c.textContent.trim();
    c.classList.toggle('active', activeBranches.size === 0 || activeBranches.has(b));
  });

  if (filtered.length === 0) {
    tl.innerHTML = ''; empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const groups = groupByDate(filtered);
  let html = '';
  for (const [label, stashes] of Object.entries(groups)) {
    if (!stashes.length) continue;
    html += \`<div class="date-group">
      <div class="date-header">\${label}<span class="line"></span></div>
      \${stashes.map(cardHtml).join('')}
    </div>\`;
  }
  tl.innerHTML = html;
}

function focus(ref) {
  vscode.postMessage({ type: 'focus', ref });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Events ──
document.getElementById('search').addEventListener('input', e => {
  searchQ = e.target.value.toLowerCase();
  render();
});
document.getElementById('clear-btn').addEventListener('click', () => {
  document.getElementById('search').value = '';
  searchQ = ''; activeBranches.clear(); render(); renderChips();
});

// ── Messages from extension ──
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'stashes') {
    allStashes = msg.data;
    renderChips();
    render();
  }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
