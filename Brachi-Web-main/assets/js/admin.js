// ═══ In-place video slot editor ═══════════════════════════════════════════
// Loaded only after clicking the lock or Ctrl/Cmd+Shift+A. Regular visitors never download it.
//
// A word on security, plainly:
// This is a static site with no server. The password lock is a lock on the editing interface, but anyone
// with DevTools can get past it. The real line of defence is write permission on the Google Cloud Storage bucket:
// publishing to everyone requires an OAuth access token that only the owner has. It is not stored in code
// or in localStorage (sessionStorage only, for the life of the tab). Someone who gets past the lock edits only their own browser.

import { loadPublicList, sanitizeList, sanitizeSlot, safeUrl, gcsManifestUrl } from './video-store.js';
import { mediaConfig } from './media-manifest.js';
import { esc, categoryLabel } from './video-wall.js';

const DEFAULT_PASSWORD = 'brachi2026!';           // used only until the first password change
const K_CRED = 'bp-admin-cred';                     // { v, salt, hash, iter }
const K_FAILS = 'bp-admin-fails';                   // { n, until }
const K_SESSION = 'bp-admin-session';               // sessionStorage: expiry time
const K_DRAFT = 'bp-admin-draft';                   // the edited list (without local files)
const K_CLOUD = 'bp-admin-cloud';                   // { bucket, prefix }; no token
const K_TOKEN = 'bp-admin-token';                   // sessionStorage only
const ITER = 210000;
const SESSION_MS = 2 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const TOOLS = ['Kling AI', 'Google Flow', 'Runway'];

const $ = (s, r = document) => r.querySelector(s);
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* */ } },
};

// ── Crypto: salted PBKDF2-SHA-256 ─────────────────────────────────────────
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(password, salt, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
function equal(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function setPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pw, salt);
  ls.set(K_CRED, { v: 1, salt: b64(salt), hash: b64(hash), iter: ITER });
}
/** @returns {'ok'|'ok-default'|'bad'|'locked'} */
async function verify(pw) {
  const fails = ls.get(K_FAILS, { n: 0, until: 0 });
  if (Date.now() < fails.until) return 'locked';
  const cred = ls.get(K_CRED);
  let ok = false, isDefault = false;
  if (cred && cred.salt && cred.hash) {
    ok = equal(await derive(pw, unb64(cred.salt), cred.iter || ITER), unb64(cred.hash));
  } else {
    // No password saved yet: compare against the default password in the same way (constant-time on the hash)
    const salt = new TextEncoder().encode('bp-default-salt');
    ok = equal(await derive(pw, salt), await derive(DEFAULT_PASSWORD, salt));
    isDefault = ok;
  }
  if (ok) { ls.del(K_FAILS); return isDefault ? 'ok-default' : 'ok'; }
  const n = fails.n + 1;
  const wait = n >= 5 ? Math.min(15 * 60, 30 * 2 ** (n - 5)) * 1000 : 0;
  ls.set(K_FAILS, { n, until: Date.now() + wait });
  return n >= 5 ? 'locked' : 'bad';
}
const lockSecondsLeft = () => Math.max(0, Math.ceil(((ls.get(K_FAILS, { until: 0 }).until || 0) - Date.now()) / 1000));

const sessionValid = () => Number(ss.get(K_SESSION) || 0) > Date.now();
const touchSession = () => ss.set(K_SESSION, String(Date.now() + SESSION_MS));

// ── Small dialog helper ────────────────────────────────────────────────────
function dialog(html, { cls = '', label = '' } = {}) {
  const d = document.createElement('dialog');
  d.className = 'adm-dialog ' + cls;
  if (label) d.setAttribute('aria-label', label);
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  return d;
}

function ensureCss() {
  if (document.querySelector('link[data-admin-css]')) return Promise.resolve();
  return new Promise((res) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/assets/css/admin.css'; l.dataset.adminCss = '';
    l.onload = l.onerror = () => res();
    document.head.appendChild(l);
  });
}

// ── Login and password change ────────────────────────────────────────────
function loginDialog() {
  return new Promise((resolve) => {
    if (!window.isSecureContext || !crypto.subtle) {
      alert('מצב עריכה זמין רק בחיבור מאובטח (https).');
      resolve(null); return;
    }
    const d = dialog(`
      <form method="dialog" class="adm-form" novalidate>
        <h2>כניסת מנהל</h2>
        <p class="adm-note">עריכת משבצות הווידאו באתר.</p>
        <label>סיסמה<input type="password" name="pw" autocomplete="current-password" required></label>
        <p class="adm-err" role="alert" aria-live="assertive"></p>
        <div class="adm-actions">
          <button type="submit" class="btn btn-ink" value="login">כניסה</button>
          <button type="button" class="btn btn-line" data-cancel>ביטול</button>
        </div>
      </form>`, { label: 'כניסת מנהל' });
    const form = d.querySelector('form'), err = d.querySelector('.adm-err'), input = d.querySelector('input');
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    d.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    d.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const left = lockSecondsLeft();
      if (left) { err.textContent = `יותר מדי ניסיונות. נסו שוב בעוד ${left} שניות.`; return; }
      if (!input.value) { err.textContent = 'הקלידו סיסמה.'; input.focus(); return; }
      form.querySelector('[type=submit]').disabled = true;
      err.textContent = 'בודקת...';
      const r = await verify(input.value);
      form.querySelector('[type=submit]').disabled = false;
      if (r === 'ok' || r === 'ok-default') { finish(r); return; }
      input.value = ''; input.focus();
      err.textContent = r === 'locked' ? `יותר מדי ניסיונות. נסו שוב בעוד ${lockSecondsLeft()} שניות.` : 'הסיסמה שגויה.';
    });
    d.showModal();
    input.focus();
  });
}

function changePasswordDialog({ forced = false } = {}) {
  return new Promise((resolve) => {
    const d = dialog(`
      <form method="dialog" class="adm-form" novalidate>
        <h2>החלפת סיסמת מנהל</h2>
        ${forced ? '<p class="adm-note adm-warn">נכנסת עם סיסמת ברירת המחדל, שמופיעה בקוד הציבורי. צריך להחליף אותה לפני שממשיכים.</p>' : ''}
        ${forced ? '' : '<label>הסיסמה הנוכחית<input type="password" name="cur" autocomplete="current-password" required></label>'}
        <label>סיסמה חדשה (לפחות 10 תווים)<input type="password" name="pw1" autocomplete="new-password" minlength="10" required></label>
        <label>הסיסמה החדשה שוב<input type="password" name="pw2" autocomplete="new-password" required></label>
        <p class="adm-note">הסיסמה נשמרת כגיבוב PBKDF2 עם salt בדפדפן הזה בלבד. במכשיר אחר תתבקשי להגדיר אותה מחדש.</p>
        <p class="adm-err" role="alert" aria-live="assertive"></p>
        <div class="adm-actions">
          <button type="submit" class="btn btn-ink">שמירת הסיסמה</button>
          <button type="button" class="btn btn-line" data-cancel>${forced ? 'יציאה' : 'ביטול'}</button>
        </div>
      </form>`, { label: 'החלפת סיסמת מנהל' });
    const form = d.querySelector('form'), err = d.querySelector('.adm-err');
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    d.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const cur = f.get('cur'), pw1 = String(f.get('pw1') || ''), pw2 = String(f.get('pw2') || '');
      if (!forced) {
        const r = await verify(String(cur || ''));
        if (r === 'locked') { err.textContent = `יותר מדי ניסיונות. נסו שוב בעוד ${lockSecondsLeft()} שניות.`; return; }
        if (r === 'bad') { err.textContent = 'הסיסמה הנוכחית שגויה.'; return; }
      }
      if (pw1.length < 10) { err.textContent = 'הסיסמה החדשה קצרה מדי: לפחות 10 תווים.'; return; }
      if (pw1 === DEFAULT_PASSWORD) { err.textContent = 'זו סיסמת ברירת המחדל. בחרי סיסמה אחרת.'; return; }
      if (pw1 !== pw2) { err.textContent = 'שתי הסיסמאות לא זהות.'; return; }
      await setPassword(pw1);
      finish(true);
    });
    d.showModal();
    form.querySelector('input').focus();
  });
}

// ── Poster from the first frame ──────────────────────────────────────────
export function makePoster(file, width = 360) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    let t = setTimeout(() => cleanup(null), 8000);
    function cleanup(result) { clearTimeout(t); t = 0; v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(result); }
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); }, { once: true });
    v.addEventListener('seeked', () => {
      if (!t) return;
      const h = Math.round(width * (v.videoHeight / v.videoWidth || 16 / 9));
      const c = document.createElement('canvas');
      c.width = width; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, width, h);
      c.toBlob((blob) => cleanup(blob), 'image/webp', 0.72);
    }, { once: true });
    v.addEventListener('error', () => cleanup(null), { once: true });
  });
}

// ── GCS upload (JSON API, multipart) ──────────────────────────────────────
export async function gcsUpload({ bucket, token, name, blob, contentType, cacheControl }) {
  const boundary = 'bp' + crypto.getRandomValues(new Uint32Array(2)).join('');
  const meta = JSON.stringify({ name, contentType, cacheControl });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`, blob, `\r\n--${boundary}--`,
  ]);
  let res;
  try {
    res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  } catch {
    throw new Error('הדפדפן חסם את הבקשה. בדרך כלל זה אומר שלדלי לא הוגדר CORS (ההוראות למטה).');
  }
  if (res.status === 401) throw new Error('הטוקן לא תקף או שפג תוקפו (טוקן תקף כשעה). הפיקי טוקן חדש.');
  if (res.status === 403) throw new Error('לחשבון של הטוקן אין הרשאת כתיבה לדלי הזה.');
  if (res.status === 404) throw new Error(`הדלי "${bucket}" לא נמצא.`);
  if (!res.ok) throw new Error(`ההעלאה נכשלה (${res.status}).`);
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;
}

// ═══ The editor ═════════════════════════════════════════════════════════
let state = null; // { draft, pending: Map, wallP, publicList, root, editorEl, bar, idleT }

export async function openAdmin(hooks) {
  if (state) { focusEditor(); return; }
  await ensureCss();
  if (!sessionValid()) {
    const r = await loginDialog();
    if (!r) return;
    if (r === 'ok-default') {
      const changed = await changePasswordDialog({ forced: true });
      if (!changed) return;
    }
  }
  touchSession();
  await startEditor(hooks);
}

/** On page load: if this tab is already logged in, return to editing mode */
export async function resumeIfActive(hooks) {
  if (!sessionValid()) return false;
  await ensureCss();
  await startEditor(hooks);
  return true;
}

async function startEditor(hooks) {
  hooks.go('ai-video');
  const wall = await hooks.getWall();
  const publicList = await loadPublicList();
  const saved = sanitizeList(ls.get(K_DRAFT));
  const root = document.querySelector('[data-room-panel="ai-video"]');
  state = {
    hooks, wall, root,
    publicList: publicList.map((s) => ({ ...s })),
    draft: (saved && saved.length ? saved : publicList).map((s) => ({ ...s })),
    pending: new Map(),
    dirty: false,
  };
  document.body.classList.add('is-admin');
  if (wall.leave) wall.leave();                // stop playback on the public wall
  root.querySelector('.wall-river').hidden = true;
  const ed = document.createElement('div');
  ed.className = 'wall-editor';
  ed.setAttribute('role', 'list');
  ed.setAttribute('aria-label', 'משבצות וידאו, מצב עריכה');
  root.querySelector('.wall').insertBefore(ed, root.querySelector('.wall-river'));
  state.editorEl = ed;
  buildBar();
  renderEditor();
  bindIdle();
  addEventListener('beforeunload', beforeUnload);
  focusEditor();
}

function focusEditor() {
  if (!state) return;
  state.hooks.go('ai-video');
  requestAnimationFrame(() => state.editorEl.scrollIntoView({ block: 'start' }));
}

function beforeUnload(e) {
  if (state && state.pending.size) { e.preventDefault(); e.returnValue = ''; }
}

function bindIdle() {
  const bump = () => {
    touchSession();
    clearTimeout(state && state.idleT);
    if (state) state.idleT = setTimeout(() => logout('הנעילה הופעלה אחרי 30 דקות בלי פעילות.'), IDLE_MS);
  };
  state.bump = bump;
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, bump, { passive: true });
  bump();
}

export function logout(msg) {
  if (!state) return;
  const { wall, root, editorEl, bar, pending } = state;
  for (const p of pending.values()) { URL.revokeObjectURL(p.videoUrl); if (p.posterUrl) URL.revokeObjectURL(p.posterUrl); }
  for (const ev of ['pointerdown', 'keydown']) removeEventListener(ev, state.bump);
  clearTimeout(state.idleT);
  removeEventListener('beforeunload', beforeUnload);
  editorEl.remove();
  bar.remove();
  root.querySelector('.wall-river').hidden = false;
  wall.setList(state.publicList);               // the public view shows only what has been published
  if (document.body.dataset.room === 'ai-video' && wall.enter) wall.enter();
  document.body.classList.remove('is-admin');
  ss.del(K_SESSION);
  ss.del(K_TOKEN);
  state = null;
  const lock = document.querySelector('[data-admin-lock]');
  if (lock) lock.focus();
  if (msg) toast(msg);
}

function toast(msg) {
  const t = document.querySelector('.toast');
  if (!t) return;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 5000);
}

// ── Bottom bar ───────────────────────────────────────────────────────────
function buildBar() {
  const bar = document.createElement('div');
  bar.className = 'adm-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'סרגל מנהל');
  bar.innerHTML = `
    <p class="adm-status"><b>מצב עריכה:</b> <span data-count></span></p>
    <div class="adm-bar-actions">
      <button type="button" class="btn btn-accent" data-publish>שמור ופרסם לענן</button>
      <button type="button" class="btn btn-line" data-cloud>הגדרות ענן</button>
      <button type="button" class="btn btn-line" data-download>הורדת videos-manifest.json</button>
      <button type="button" class="btn btn-line" data-pw>החלפת סיסמת מנהל</button>
      <button type="button" class="btn btn-ink" data-logout>יציאה ממצב עריכה</button>
    </div>`;
  document.body.appendChild(bar);
  state.bar = bar;
  bar.querySelector('[data-logout]').addEventListener('click', () => {
    if (state.pending.size && !confirm('יש סרטונים מקומיים שעוד לא פורסמו לענן. הם יאבדו ביציאה. לצאת בכל זאת?')) return;
    logout('יצאת ממצב עריכה. האתר מוצג כמו שמבקרים רואים אותו.');
  });
  bar.querySelector('[data-pw]').addEventListener('click', async () => {
    if (await changePasswordDialog()) toast('הסיסמה הוחלפה.');
  });
  bar.querySelector('[data-cloud]').addEventListener('click', () => cloudDrawer());
  bar.querySelector('[data-publish]').addEventListener('click', () => publish());
  bar.querySelector('[data-download]').addEventListener('click', downloadManifest);
  updateBar();
}

function updateBar() {
  if (!state) return;
  const n = state.draft.length, p = state.pending.size;
  const local = p === 1 ? 'סרטון מקומי אחד ממתין לפרסום' : `${p} סרטונים מקומיים ממתינים לפרסום`;
  state.bar.querySelector('[data-count]').textContent = `${n} משבצות` + (p ? `, ${local}` : state.dirty ? ', יש שינויים שלא פורסמו' : '');
}

function saveDraft() {
  state.dirty = true;
  ls.set(K_DRAFT, state.draft);
  updateBar();
}

// ── Rendering the editor grid ───────────────────────────────────────────
function renderEditor() {
  const ed = state.editorEl;
  ed.innerHTML = '';
  state.draft.forEach((slot, i) => ed.appendChild(slotCard(slot, i)));
  const add = document.createElement('div');
  add.setAttribute('role', 'listitem');
  add.className = 'ed-add-wrap';
  add.innerHTML = '<button type="button" class="ed-add"><span aria-hidden="true">+</span>הוספת משבצת סרטון חדשה</button>';
  add.querySelector('button').addEventListener('click', () => {
    state.draft.push(sanitizeSlot({ id: 'slot-' + Date.now().toString(36), title: 'משבצת חדשה', category: 'רילס לעסק', tool: 'Kling AI' }));
    saveDraft();
    renderEditor();
    const cards = ed.querySelectorAll('.ed-card');
    const last = cards[cards.length - 1];
    last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    last.querySelector('[data-k="title"]').focus();
  });
  ed.appendChild(add);
  updateBar();
}

function mediaHtml(slot) {
  const p = state.pending.get(slot.id);
  const vsrc = p ? p.videoUrl : slot.src;
  const poster = p ? p.posterUrl : slot.poster;
  if (vsrc) return `<video class="ed-video" muted loop playsinline autoplay preload="metadata" src="${esc(vsrc)}" ${poster ? `poster="${esc(poster)}"` : ''}></video>`;
  return '<span class="pending-glow" aria-hidden="true"></span>';
}

function slotCard(slot, i) {
  const n = i + 1;
  const p = state.pending.get(slot.id);
  const status = p ? 'קובץ מקומי, ממתין לפרסום' : slot.src ? 'מפורסם' : 'ריק';
  const card = document.createElement('figure');
  card.className = 'phone ed-card' + (p ? ' is-local' : '');
  card.setAttribute('role', 'listitem');
  card.dataset.id = slot.id;
  card.innerHTML = `
    <div class="ed-top">
      <span class="ed-num">משבצת #${n}</span>
      <span class="ed-tools">
        <button type="button" class="ed-ico ed-handle" draggable="true" aria-label="גררו כדי לשנות את המיקום של משבצת #${n}" title="גררו לשינוי הסדר">⠿</button>
        <button type="button" class="ed-ico" data-move="-1" aria-label="הזזת משבצת #${n} מקום אחד קדימה" ${i === 0 ? 'disabled' : ''}>→</button>
        <button type="button" class="ed-ico" data-move="1" aria-label="הזזת משבצת #${n} מקום אחד אחורה" ${i === state.draft.length - 1 ? 'disabled' : ''}>←</button>
        <button type="button" class="ed-del" aria-label="מחיקת משבצת #${n}">🗑️ מחיקת משבצת</button>
      </span>
    </div>
    <div class="phone-screen ed-drop" tabindex="0" role="button" aria-label="העלאת קובץ וידאו למשבצת #${n}: גררו לכאן או הקישו לבחירה">
      ${mediaHtml(slot)}
      <span class="ed-drop-hint">${slot.src || p ? 'גררו קובץ אחר להחלפה' : 'גררו לכאן קובץ וידאו<br>או הקישו לבחירה'}</span>
      <input type="file" accept="video/*" hidden>
    </div>
    <figcaption class="ed-caption">
      <span class="phone-badge ed-field" data-k="tool" data-ph="כלי AI">${esc(slot.tool)}</span>
      <span class="ed-chips" role="group" aria-label="בחירת כלי">${TOOLS.map((t) => `<button type="button" class="ed-chip" data-tool="${t}" aria-pressed="${slot.tool === t}">${t}</button>`).join('')}</span>
      <span class="phone-title ed-field" data-k="title" data-ph="כותרת">${esc(slot.title)}</span>
      <span class="phone-sub ed-field" data-k="subtitle" data-ph="תיאור קצר (לא חובה)">${esc(slot.subtitle)}</span>
      <span class="phone-cat ed-field" data-k="category" data-ph="קטגוריה">${esc(categoryLabel(slot.category))}</span>
      <label class="ed-src">מקור הווידאו
        <input type="url" dir="ltr" data-k="src" value="${esc(p ? '' : slot.src)}" placeholder="${p ? esc(p.file.name) + ' (מקומי)' : 'https://storage.googleapis.com/...'}">
      </label>
      <span class="ed-state" data-state="${p ? 'local' : slot.src ? 'live' : 'empty'}">${status}</span>
    </figcaption>`;

  // Editable text fields
  for (const f of card.querySelectorAll('.ed-field')) {
    try { f.contentEditable = 'plaintext-only'; } catch { f.contentEditable = 'true'; }
    if (f.contentEditable !== 'plaintext-only') f.contentEditable = 'true';
    f.setAttribute('role', 'textbox');
    f.setAttribute('aria-label', `${f.dataset.ph}, משבצת #${n}`);
    f.spellcheck = true;
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.blur(); } });
    f.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    f.addEventListener('input', () => {
      slot[f.dataset.k] = f.textContent.replace(/\s+/g, ' ').trim().slice(0, f.dataset.k === 'subtitle' ? 240 : 160);
      if (f.dataset.k === 'tool') syncChips();
      saveDraft();
    });
  }
  const syncChips = () => card.querySelectorAll('.ed-chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tool === slot.tool)));
  card.querySelectorAll('.ed-chip').forEach((c) => c.addEventListener('click', () => {
    slot.tool = c.dataset.tool;
    card.querySelector('[data-k="tool"]').textContent = slot.tool;
    syncChips(); saveDraft();
  }));

  // Source URL
  const srcInput = card.querySelector('input[data-k="src"]');
  srcInput.addEventListener('change', () => {
    const val = srcInput.value.trim();
    const safe = safeUrl(val);
    if (val && !safe) { srcInput.setCustomValidity('כתובת לא תקינה: רק https://'); srcInput.reportValidity(); return; }
    srcInput.setCustomValidity('');
    dropPending(slot.id);
    slot.src = safe;
    if (!safe) slot.poster = '';
    saveDraft(); renderEditor();
  });

  // Delete
  card.querySelector('.ed-del').addEventListener('click', () => {
    if (!confirm(`למחוק את משבצת #${n} ("${slot.title}")? אפשר לבטל רק אם לא פרסמת אחר כך.`)) return;
    dropPending(slot.id);
    state.draft.splice(state.draft.indexOf(slot), 1);
    saveDraft(); renderEditor();
    const cards = state.editorEl.querySelectorAll('.ed-card');
    (cards[Math.min(i, cards.length - 1)] || state.editorEl.querySelector('.ed-add')).focus();
  });

  // Move buttons
  card.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    const to = i + Number(b.dataset.move);
    move(i, to);
    const btn = state.editorEl.querySelectorAll('.ed-card')[to]?.querySelector(`[data-move="${b.dataset.move}"]`);
    (btn && !btn.disabled ? btn : state.editorEl.querySelectorAll('.ed-card')[to]?.querySelector('.ed-handle'))?.focus();
  }));

  // Drag to reorder (handle) + drop a file (anywhere on the screen)
  const handle = card.querySelector('.ed-handle');
  handle.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-bp-slot', slot.id);
    e.dataTransfer.setDragImage(card, 40, 40);
    card.classList.add('is-dragging');
  });
  handle.addEventListener('dragend', () => { card.classList.remove('is-dragging'); clearDropMarks(); });
  card.addEventListener('dragover', (e) => {
    const types = [...e.dataTransfer.types];
    if (types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; card.classList.add('is-file-over'); return; }
    if (types.includes('text/x-bp-slot')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; clearDropMarks(); card.classList.add('is-drop-target'); }
  });
  card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('is-file-over', 'is-drop-target'); });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('is-file-over', 'is-drop-target');
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith('video/'));
    if (file) { attachFile(slot, file); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) { toast('אפשר לגרור לכאן רק קובץ וידאו.'); return; }
    const id = e.dataTransfer.getData('text/x-bp-slot');
    const from = state.draft.findIndex((s) => s.id === id);
    if (from >= 0 && from !== i) move(from, i);
  });

  // Click/keyboard to choose a file
  const drop = card.querySelector('.ed-drop');
  const fileInput = drop.querySelector('input[type=file]');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) attachFile(slot, fileInput.files[0]); });
  return card;
}

function clearDropMarks() { state && state.editorEl.querySelectorAll('.is-drop-target').forEach((c) => c.classList.remove('is-drop-target')); }

function move(from, to) {
  if (to < 0 || to >= state.draft.length || from === to) return;
  const [s] = state.draft.splice(from, 1);
  state.draft.splice(to, 0, s);
  saveDraft(); renderEditor();
}

function dropPending(id) {
  const p = state.pending.get(id);
  if (!p) return;
  URL.revokeObjectURL(p.videoUrl);
  if (p.posterUrl) URL.revokeObjectURL(p.posterUrl);
  state.pending.delete(id);
}

async function attachFile(slot, file) {
  if (!file.type.startsWith('video/')) { toast('הקובץ אינו וידאו.'); return; }
  if (file.size > 500 * 1024 * 1024) { toast('הקובץ גדול מ-500MB. כדאי לדחוס אותו לפני העלאה.'); return; }
  dropPending(slot.id);
  const entry = { file, videoUrl: URL.createObjectURL(file), posterBlob: null, posterUrl: '' };
  state.pending.set(slot.id, entry);
  renderEditor();                       // the video starts playing in the slot immediately
  const blob = await makePoster(file);
  if (blob && state && state.pending.get(slot.id) === entry) {
    entry.posterBlob = blob;
    entry.posterUrl = URL.createObjectURL(blob);
    const card = state.editorEl.querySelector(`.ed-card[data-id="${CSS.escape(slot.id)}"] .ed-video`);
    if (card) card.poster = entry.posterUrl;
    toast(`הסרטון נטען למשבצת, ונוצרה תמונה מקדימה (${Math.round(blob.size / 1024)}KB).`);
  }
  updateBar();
}

// ── Manifest: download and publish ───────────────────────────────────────
function manifestJson(slots) {
  return JSON.stringify({ version: 1, updated: new Date().toISOString(), slots }, null, 2);
}

function downloadManifest() {
  if (state.pending.size) toast('שימי לב: סרטונים מקומיים לא נכללים בקובץ. כדי לכלול אותם צריך לפרסם לענן.');
  const slots = state.draft.map((s) => (state.pending.has(s.id) ? { ...s, src: '', poster: '' } : s));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([manifestJson(slots)], { type: 'application/json' }));
  a.download = 'videos-manifest.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const CORS_JSON = '[{"origin":["https://brachi-web.vercel.app"],"method":["GET","POST"],"responseHeader":["Content-Type","Authorization"],"maxAgeSeconds":3600}]';

function cloudDrawer() {
  const cfg = ls.get(K_CLOUD, { bucket: mediaConfig.gcsBucket || '', prefix: mediaConfig.gcsPrefix || 'brachi-web/' });
  const d = dialog(`
    <form method="dialog" class="adm-form adm-drawer-in" novalidate>
      <h2>הגדרות ענן: Google Cloud Storage</h2>
      <label>שם הדלי (Bucket)<input name="bucket" dir="ltr" required pattern="[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]" value="${esc(cfg.bucket)}" placeholder="brachi-videos"></label>
      <label>תיקייה בתוך הדלי<input name="prefix" dir="ltr" value="${esc(cfg.prefix)}" placeholder="brachi-web/"></label>
      <label>Access token (נשמר רק בלשונית הזו, לא בקוד ולא בדפדפן אחרי סגירה)
        <input name="token" type="password" dir="ltr" autocomplete="off" value="${esc(ss.get(K_TOKEN) || '')}" placeholder="ya29...."></label>
      <details class="adm-help">
        <summary>איך מגדירים את זה (פעם אחת)</summary>
        <ol>
          <li>יוצרים דלי ב-Google Cloud Console, ונותנים ל-<code>allUsers</code> הרשאת <code>Storage Object Viewer</code> כדי שהסרטונים יהיו ציבוריים.</li>
          <li>מגדירים CORS לדלי, כדי שהדפדפן יוכל להעלות אליו:
            <pre dir="ltr">echo '${esc(CORS_JSON)}' &gt; cors.json
gcloud storage buckets update gs://BUCKET --cors-file=cors.json</pre></li>
          <li>בכל פעם שמפרסמים, מפיקים טוקן (תקף כשעה) ומדביקים אותו כאן:
            <pre dir="ltr">gcloud auth print-access-token</pre></li>
          <li>כדי שהאתר הציבורי יקרא את הרשימה מהדלי, שם הדלי צריך להופיע פעם אחת ב-<code>assets/js/media-manifest.js</code> (<code>gcsBucket</code>).</li>
        </ol>
      </details>
      ${cfg.bucket && cfg.bucket !== mediaConfig.gcsBucket ? `<p class="adm-note adm-warn">האתר הציבורי עוד לא קורא מהדלי "${esc(cfg.bucket)}". אחרי הפרסום הראשון צריך לכתוב את שמו ב-media-manifest.js.</p>` : ''}
      <p class="adm-err" role="alert"></p>
      <div class="adm-actions">
        <button type="submit" class="btn btn-ink">שמירה</button>
        <button type="button" class="btn btn-line" data-cancel>סגירה</button>
      </div>
    </form>`, { cls: 'adm-drawer', label: 'הגדרות ענן' });
  d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const bucket = String(f.get('bucket') || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) { d.querySelector('.adm-err').textContent = 'שם דלי לא תקין: אותיות קטנות באנגלית, ספרות, נקודה, מקף.'; return; }
    let prefix = String(f.get('prefix') || '').trim().replace(/^\/+/, '');
    if (prefix && !prefix.endsWith('/')) prefix += '/';
    ls.set(K_CLOUD, { bucket, prefix });
    const token = String(f.get('token') || '').trim();
    if (token) ss.set(K_TOKEN, token); else ss.del(K_TOKEN);
    d.close();
    toast('ההגדרות נשמרו.');
  });
  d.showModal();
  d.querySelector('input').focus();
}

async function publish() {
  const cfg = ls.get(K_CLOUD);
  const token = ss.get(K_TOKEN);
  if (!cfg || !cfg.bucket || !token) { toast('קודם צריך להגדיר דלי וטוקן.'); cloudDrawer(); return; }
  const d = dialog(`
    <div class="adm-form">
      <h2>פרסום לענן</h2>
      <ol class="adm-progress" aria-live="polite"></ol>
      <p class="adm-err" role="alert"></p>
      <div class="adm-actions"><button type="button" class="btn btn-ink" data-close disabled>סגירה</button></div>
    </div>`, { label: 'פרסום לענן' });
  const log = d.querySelector('.adm-progress'), err = d.querySelector('.adm-err'), close = d.querySelector('[data-close]');
  close.addEventListener('click', () => d.close());
  d.showModal();
  const step = (t) => { const li = document.createElement('li'); li.textContent = t; log.appendChild(li); return li; };
  const stamp = Date.now().toString(36);
  try {
    for (const slot of state.draft) {
      const p = state.pending.get(slot.id);
      if (!p) continue;
      const ext = (p.file.name.match(/\.(\w{2,5})$/) || [, 'mp4'])[1].toLowerCase();
      const li = step(`מעלה את "${slot.title}" (${Math.round(p.file.size / 1048576)}MB)...`);
      slot.src = await gcsUpload({ bucket: cfg.bucket, token, name: `${cfg.prefix}videos/${slot.id}-${stamp}.${ext}`, blob: p.file, contentType: p.file.type || 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' });
      if (p.posterBlob) {
        slot.poster = await gcsUpload({ bucket: cfg.bucket, token, name: `${cfg.prefix}posters/${slot.id}-${stamp}.webp`, blob: p.posterBlob, contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
      }
      li.textContent += ' הועלה.';
      dropPending(slot.id);
      ls.set(K_DRAFT, state.draft);
    }
    const li = step('מפרסם את רשימת המשבצות (videos-manifest.json)...');
    await gcsUpload({ bucket: cfg.bucket, token, name: `${cfg.prefix}videos-manifest.json`, blob: new Blob([manifestJson(state.draft)], { type: 'application/json' }), contentType: 'application/json', cacheControl: 'no-cache, max-age=0' });
    li.textContent += ' פורסם.';
    state.publicList = state.draft.map((s) => ({ ...s }));
    state.dirty = false;
    step(cfg.bucket === mediaConfig.gcsBucket
      ? 'סיום. המבקרים יראו את השינויים בטעינה הבאה של הדף.'
      : `סיום. הקבצים בדלי. כדי שהאתר הציבורי יקרא מהם, צריך לכתוב פעם אחת gcsBucket: '${cfg.bucket}' ב-media-manifest.js. הכתובת: ${gcsManifestUrl(cfg.bucket, cfg.prefix)}`);
  } catch (e) {
    err.textContent = e.message || 'הפרסום נכשל.';
  } finally {
    close.disabled = false;
    close.focus();
    renderEditor();
  }
}
