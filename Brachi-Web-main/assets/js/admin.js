// ═══ In-place video slot editor ═══════════════════════════════════════════
// Loaded only after clicking the lock or Ctrl/Cmd+Shift+A. Regular visitors never download it.
//
// A word on security, plainly:
// This is a static site with no server. The password lock is a lock on the editing interface, but anyone
// with DevTools can get past it. The real line of defence is write permission on the Cloudflare R2 bucket:
// publishing to everyone requires an R2 Access Key ID + Secret Access Key that only the owner has. They are not stored
// in code or in localStorage (sessionStorage only, for the life of the tab). Someone who gets past the lock edits only their own browser.

import { loadPublicList, sanitizeList, sanitizeSlot, safeUrl, r2ManifestUrl, joinUrl } from './video-store.js';
import { mediaConfig, CATEGORY_LABEL } from './media-manifest.js';
import { esc } from './video-wall.js';

const DEFAULT_PASSWORD = 'brachi2026!';           // used only until the first password change
const K_CRED = 'bp-admin-cred';                     // { v, salt, hash, iter }
const K_FAILS = 'bp-admin-fails';                   // { n, until }
const K_SESSION = 'bp-admin-session';               // sessionStorage: expiry time
const K_DRAFT = 'bp-admin-draft';                   // the edited list (without local files)
const K_CLOUD = 'bp-admin-r2';                      // { accountId, bucket, publicBase, prefix }; no keys
const K_KEYS = 'bp-admin-r2-keys';                  // sessionStorage only: { accessKeyId, secret }
const ITER = 210000;
const IDLE_MS = 30 * 60 * 1000;
const SESSION_MS = IDLE_MS;   // sliding: each action renews it, so a reload after 30 idle minutes asks for the password again
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

// ── Cloudflare R2 upload (S3 API, AWS Signature V4, computed in the browser) ──
// R2 is S3-compatible: PUT https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/<key>, region "auto".
// The payload is not hashed (UNSIGNED-PAYLOAD), so a large video is not read into memory just for a SHA-256.
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const sha256hex = async (str) => hex(await crypto.subtle.digest('SHA-256', enc.encode(str)));
/** RFC 3986 encoding for one path segment, as S3 requires (also ! ' ( ) *) */
const s3seg = (seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export async function r2SignPut({ accountId, bucket, key, accessKeyId, secret, now = new Date() }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${s3seg(bucket)}/${key.split('/').map(s3seg).join('/')}`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261102T120000Z
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const payload = 'UNSIGNED-PAYLOAD';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = ['PUT', path, '', `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${amzDate}\n`, signedHeaders, payload].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256hex(canonical)].join('\n');
  let k = await hmac('AWS4' + secret, day);
  k = await hmac(k, 'auto'); k = await hmac(k, 's3'); k = await hmac(k, 'aws4_request');
  const signature = hex(await hmac(k, toSign));
  return {
    url: `https://${host}${path}`,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payload,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function r2Error(status, bucket) {
  if (status === 401 || status === 403) return new Error('R2 דחה את המפתחות: בדקי את ה-Access Key ID וה-Secret, ושלמפתח יש הרשאת Object Read & Write לדלי הזה.');
  if (status === 404) return new Error(`הדלי "${bucket}" לא נמצא בחשבון הזה. בדקי את שם הדלי ואת ה-Account ID.`);
  return new Error(`ההעלאה נכשלה (${status}).`);
}
const BLOCKED = 'הדפדפן חסם את הבקשה. בדרך כלל זה אומר שלדלי לא הוגדרה מדיניות CORS (ההוראות בהגדרות הענן).';

/** Uploads one file to R2 (XHR, for progress) and returns its public address */
export async function r2Upload({ cfg, keys, key, blob, contentType, cacheControl, onProgress }) {
  const { url, headers } = await r2SignPut({ accountId: cfg.accountId, bucket: cfg.bucket, key, accessKeyId: keys.accessKeyId, secret: keys.secret });
  await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [h, v] of Object.entries(headers)) x.setRequestHeader(h, v);
    x.setRequestHeader('Content-Type', contentType);
    if (cacheControl) x.setRequestHeader('Cache-Control', cacheControl);
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(r2Error(x.status, cfg.bucket)));
    x.onerror = () => reject(new Error(BLOCKED));
    x.send(blob);
  });
  return joinUrl(cfg.publicBase, key);
}

const readCfg = () => ls.get(K_CLOUD, { accountId: '', bucket: mediaConfig.r2Bucket || '', publicBase: mediaConfig.r2PublicBase || '', prefix: mediaConfig.r2Prefix || '' });
const readKeys = () => { try { return JSON.parse(ss.get(K_KEYS) || 'null'); } catch { return null; } };
const hasKeys = () => { const k = readKeys(); const c = readCfg(); return !!(k && k.accessKeyId && k.secret && c.accountId && c.bucket && c.publicBase); };

// ═══ The editor ═════════════════════════════════════════════════════════
let state = null; // { draft, pending: Map, wallP, publicList, root, editorEl, bar, idleT }

let opening = null;
export function openAdmin(hooks) {
  if (state) { focusEditor(); return Promise.resolve(); }
  if (!opening) opening = openAdminInner(hooks).finally(() => { opening = null; });
  return opening;
}
async function openAdminInner(hooks) {
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
export function resumeIfActive(hooks) {
  if (!sessionValid() || state) return Promise.resolve(false);
  if (!opening) opening = (async () => { await ensureCss(); await startEditor(hooks); return true; })().finally(() => { opening = null; });
  return opening;
}

// A draft is saved together with a fingerprint of the published list it was based on
const sig = (list) => JSON.stringify(list.map((s) => [s.id, s.title, s.subtitle, s.category, s.tool, s.src, s.poster]));
function readDraft() {
  const raw = ls.get(K_DRAFT);
  if (!raw) return null;
  const slots = sanitizeList(Array.isArray(raw) ? raw : raw.slots);
  return slots && slots.length ? { slots, base: Array.isArray(raw) ? null : raw.base } : null;
}

async function startEditor(hooks) {
  if (state) return;
  hooks.go('ai-video');
  const wall = await hooks.getWall();
  const publicList = await loadPublicList();
  if (state) return;
  const saved = readDraft();
  const pubSig = sig(publicList);
  // A local draft wins only if it was built on the list that is published now. Otherwise the published list wins, and the draft is offered for restore.
  const staleDraft = saved && saved.base !== pubSig && sig(saved.slots) !== pubSig ? saved : null;
  const useDraft = saved && !staleDraft;
  const root = document.querySelector('[data-room-panel="ai-video"]');
  state = {
    hooks, wall, root, staleDraft, baseSig: pubSig,
    publicList: publicList.map((s) => ({ ...s })),
    draft: (useDraft ? saved.slots : publicList).map((s) => ({ ...s })),
    pending: new Map(),
    dirty: false,
    publishing: false,
  };
  state.dirty = sig(state.draft) !== pubSig;
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
  const st = state;
  st.hooks.go('ai-video');
  requestAnimationFrame(() => { if (state === st) st.editorEl.scrollIntoView({ block: 'start' }); });
}

function beforeUnload(e) {
  if (state && [...state.pending.values()].some((p) => !p.exported)) { e.preventDefault(); e.returnValue = ''; }
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
  ss.del(K_KEYS);
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
      <button type="button" class="btn btn-accent" data-publish>שמור ופרסם ל-R2</button>
      <button type="button" class="btn btn-line" data-cloud>הגדרות ענן</button>
      <button type="button" class="btn btn-line" data-download>הורדת videos-manifest.json</button>
      <button type="button" class="btn btn-line" data-pw>החלפת סיסמת מנהל</button>
      <button type="button" class="btn btn-ink" data-logout>יציאה ממצב עריכה</button>
    </div>`;
  document.body.appendChild(bar);
  state.bar = bar;
  bar.querySelector('[data-logout]').addEventListener('click', () => {
    if ([...state.pending.values()].some((p) => !p.exported) && !confirm('יש סרטונים מקומיים שעוד לא פורסמו לענן. הם יאבדו ביציאה. לצאת בכל זאת?')) return;
    logout('יצאת ממצב עריכה. האתר מוצג כמו שמבקרים רואים אותו.');
  });
  bar.querySelector('[data-pw]').addEventListener('click', async () => {
    if (await changePasswordDialog()) toast('הסיסמה הוחלפה.');
  });
  bar.querySelector('[data-cloud]').addEventListener('click', () => cloudDrawer());
  bar.querySelector('[data-publish]').addEventListener('click', () => publish());
  if (state.staleDraft) {
    const n = document.createElement('p');
    n.className = 'adm-stale';
    n.innerHTML = 'יש טיוטה מקומית ישנה מהרשימה שמפורסמת עכשיו. מוצגת הרשימה המפורסמת. <button type="button" class="link-btn" data-restore>שחזור הטיוטה</button> <button type="button" class="link-btn" data-discard>מחיקת הטיוטה</button>';
    bar.prepend(n);
    n.querySelector('[data-restore]').addEventListener('click', () => {
      state.draft = state.staleDraft.slots.map((x) => ({ ...x })); state.staleDraft = null; n.remove(); saveDraft(); renderEditor();
    });
    n.querySelector('[data-discard]').addEventListener('click', () => { state.staleDraft = null; ls.del(K_DRAFT); n.remove(); });
  }
  bar.querySelector('[data-download]').addEventListener('click', downloadManifest);
  updateBar();
}

function updateBar() {
  if (!state) return;
  // Without keys the primary action is downloading the list for a manual upload in the R2 dashboard
  const keyed = hasKeys();
  state.bar.querySelector('[data-publish]').hidden = !keyed;
  state.bar.querySelector('[data-download]').className = 'btn ' + (keyed ? 'btn-line' : 'btn-accent');
  const n = state.draft.length;
  const all = [...state.pending.values()];
  const p = all.filter((x) => !x.exported).length, ex = all.length - p;
  const parts = [`${n} משבצות`];
  if (p) parts.push(p === 1 ? 'סרטון מקומי אחד ממתין לפרסום' : `${p} סרטונים מקומיים ממתינים לפרסום`);
  if (ex) parts.push(ex === 1 ? 'סרטון אחד ממתין להעלאה ידנית ל-R2' : `${ex} סרטונים ממתינים להעלאה ידנית ל-R2`);
  if (!p && !ex && state.dirty) parts.push('יש שינויים שלא פורסמו');
  state.bar.querySelector('[data-count]').textContent = parts.join(', ');
}

function saveDraft() {
  state.dirty = sig(state.draft) !== sig(state.publicList);
  ls.set(K_DRAFT, { base: state.baseSig, slots: state.draft });
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
    state.draft.push(sanitizeSlot({ id: 'slot-' + Date.now().toString(36), title: 'משבצת חדשה', category: 'reel', tool: 'Kling AI' }));
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
  if (vsrc) return `<video class="ed-video" muted loop playsinline ${p ? 'autoplay preload="auto"' : 'preload="none"'} src="${esc(vsrc)}" ${poster ? `poster="${esc(poster)}"` : ''}></video>`;
  return '<span class="pending-glow" aria-hidden="true"></span>';
}

function slotCard(slot, i) {
  const n = i + 1;
  const p = state.pending.get(slot.id);
  const status = p ? (p.exported ? 'ממתין להעלאה ידנית ל-R2' : 'קובץ מקומי, ממתין לפרסום') : slot.src ? 'מפורסם' : 'ריק';
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
      <span class="ed-chips ed-cats" role="group" aria-label="קטגוריה, משבצת #${n}">${Object.entries(CATEGORY_LABEL).map(([k, l]) => `<button type="button" class="ed-chip" data-cat="${k}" aria-pressed="${slot.category === k}">${esc(l)}</button>`).join('')}</span>
      <label class="ed-src">מקור הווידאו
        <input type="url" dir="ltr" data-k="src" value="${esc(p ? '' : slot.src)}" placeholder="${p ? esc(p.file.name) + ' (מקומי)' : 'https://pub-xxxxxx.r2.dev/videos/...'}">
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
  const syncChips = () => card.querySelectorAll('.ed-chip[data-tool]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tool === slot.tool)));
  card.querySelectorAll('.ed-chip[data-cat]').forEach((c) => c.addEventListener('click', () => {
    slot.category = c.dataset.cat;
    card.querySelectorAll('.ed-chip[data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    saveDraft();
  }));
  card.querySelectorAll('.ed-chip[data-tool]').forEach((c) => c.addEventListener('click', () => {
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
    const next = cards[Math.min(i, cards.length - 1)];
    (next ? next.querySelector('.ed-del') : state.editorEl.querySelector('.ed-add')).focus();
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

  // A remote video plays only on hover/focus, so the editor does not open dozens of decoders at once
  const drop = card.querySelector('.ed-drop');
  const vid = drop.querySelector('.ed-video');
  if (vid && !p) {
    const play = () => { const r = vid.play(); if (r && r.catch) r.catch(() => {}); };
    const pause = () => vid.pause();
    drop.addEventListener('pointerenter', play); drop.addEventListener('pointerleave', pause);
    drop.addEventListener('focus', play); drop.addEventListener('blur', pause);
  }
  // Click/keyboard to choose a file
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

const keyName = (name) => name.replace(/[\\/]/g, '-');       // the name of the file, exactly as it will be uploaded in the R2 dashboard
function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/**
 * No keys? Download videos-manifest.json with the R2 addresses each file *will* have, plus the generated posters.
 * You then upload the videos, the posters and the manifest yourself in the R2 dashboard, under the exact names shown.
 */
async function downloadManifest() {
  const cfg = readCfg();
  const local = state.draft.filter((s) => state.pending.has(s.id));
  if (local.length && !cfg.publicBase) {
    toast('כדי לחשב את הכתובות של הסרטונים צריך קודם כתובת בסיס ציבורית של R2.');
    cloudDrawer();
    return;
  }
  const files = [];
  for (const slot of local) {
    const p = state.pending.get(slot.id);
    const vKey = `${cfg.prefix}videos/${keyName(p.file.name)}`;
    slot.src = joinUrl(cfg.publicBase, vKey);
    files.push({ what: 'סרטון', key: vKey, local: p.file.name });
    if (p.posterBlob) {
      const pKey = `${cfg.prefix}posters/${slot.id}.webp`;
      slot.poster = joinUrl(cfg.publicBase, pKey);
      files.push({ what: 'תמונה מקדימה', key: pKey, local: `${slot.id}.webp`, blob: p.posterBlob });
    } else slot.poster = '';
    p.exported = true;
  }
  saveDraft();
  saveBlob(new Blob([manifestJson(state.draft)], { type: 'application/json' }), 'videos-manifest.json');
  for (const f of files.filter((x) => x.blob)) { await new Promise((r) => setTimeout(r, 350)); saveBlob(f.blob, f.local); }
  renderEditor();
  const d = dialog(`
    <div class="adm-form">
      <h2>העלאה ידנית ל-R2</h2>
      <p class="adm-note">הורדו <b>videos-manifest.json</b>${files.some((x) => x.blob) ? ' והתמונות המקדימות' : ''}. בלוח הבקרה של Cloudflare, בדלי <b dir="ltr">${esc(cfg.bucket || 'brachi2026')}</b>, העלי כל קובץ לנתיב שלו:</p>
      <ul class="adm-files">
        ${files.map((f) => `<li><code dir="ltr"><bdi>${esc(f.key)}</bdi></code><span>${f.what}: <bdi dir="ltr">${esc(f.local)}</bdi></span></li>`).join('')}
        <li><code dir="ltr"><bdi>${esc(cfg.prefix)}videos-manifest.json</bdi></code><span>רשימת המשבצות</span></li>
      </ul>
      <p class="adm-note">שם הקובץ בדלי חייב להיות בדיוק כמו ברשימה, כי הכתובות בקובץ מחושבות ממנו. אחרי ההעלאה המבקרים יראו את הסרטונים בטעינה הבאה${mediaConfig.r2PublicBase ? '' : ', אחרי שכתובת הבסיס תיכתב פעם אחת בקוד (media-manifest.js)'}.</p>
      <div class="adm-actions"><button type="button" class="btn btn-ink" data-close>הבנתי</button></div>
    </div>`, { label: 'העלאה ידנית ל-R2' });
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.showModal();
  d.querySelector('[data-close]').focus();
}

const CORS_JSON = `[
  {
    "AllowedOrigins": ["https://brachi-web.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["authorization", "content-type", "cache-control", "x-amz-date", "x-amz-content-sha256"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]`;

function cloudDrawer() {
  const cfg = readCfg();
  const d = dialog(`
    <form method="dialog" class="adm-form adm-drawer-in" novalidate>
      <h2>הגדרות ענן: Cloudflare R2</h2>
      <div class="adm-grid">
        <label>שם הדלי (Bucket)<input name="bucket" dir="ltr" required value="${esc(cfg.bucket || 'brachi2026')}" placeholder="brachi2026"></label>
        <label>כתובת בסיס ציבורית<input name="publicBase" dir="ltr" type="url" required value="${esc(cfg.publicBase)}" placeholder="https://pub-xxxxxx.r2.dev"></label>
        <label>Account ID (מזהה החשבון, לא סודי)<input name="accountId" dir="ltr" value="${esc(cfg.accountId)}" placeholder="32 תווים, מופיע בלוח הבקרה של R2"></label>
        <label>תיקייה בתוך הדלי (לא חובה)<input name="prefix" dir="ltr" value="${esc(cfg.prefix)}" placeholder="ריק = שורש הדלי"></label>
      </div>
      <fieldset class="adm-keys">
        <legend>מפתחות להעלאה ישירה (לא חובה)</legend>
        <p class="adm-note">בלי מפתחות: גוררים סרטונים למשבצות, לוחצים "הורדת videos-manifest.json" ומעלים את הקבצים בלוח הבקרה של R2. עם מפתחות: כפתור אחד מעלה הכול.</p>
        <label>Access Key ID<input name="accessKeyId" dir="ltr" autocomplete="off" spellcheck="false"></label>
        <label>Secret Access Key<input name="secret" type="password" dir="ltr" autocomplete="off" spellcheck="false"></label>
        <p class="adm-note">המפתחות נשמרים רק בלשונית הזו (sessionStorage), לא בקוד ולא אחרי סגירה. מומלץ ליצור ב-R2 טוקן API מוגבל לדלי הזה בלבד, עם הרשאת Object Read &amp; Write.</p>
      </fieldset>
      <details class="adm-help">
        <summary>איך מגדירים את זה (פעם אחת)</summary>
        <ol>
          <li>בדלי, תחת Settings ← Public access, מפעילים את כתובת <code>r2.dev</code> ומעתיקים אותה לשדה "כתובת בסיס ציבורית". (לאתר בפרודקשן Cloudflare ממליצים לחבר דומיין משלך במקום r2.dev, שמוגבל בקצב.)</li>
          <li>בדלי, תחת Settings ← CORS Policy, מדביקים את המדיניות הזו. היא מאפשרת לאתר לקרוא את רשימת הסרטונים, ולעורך להעלות קבצים:
            <pre dir="ltr">${esc(CORS_JSON)}</pre></li>
          <li>מפתחות (לא חובה): R2 ← Manage R2 API Tokens ← Create API token, הרשאת Object Read &amp; Write, מוגבל לדלי <code>brachi2026</code>. ה-Account ID מופיע באותו עמוד.</li>
          <li>כדי שהאתר הציבורי יקרא את הרשימה מ-R2, כתובת הבסיס צריכה להופיע פעם אחת ב-<code>assets/js/media-manifest.js</code> (<code>r2PublicBase</code>).</li>
        </ol>
      </details>
      ${cfg.publicBase && cfg.publicBase !== mediaConfig.r2PublicBase ? `<p class="adm-note adm-warn">האתר הציבורי עוד לא קורא מ-<span dir="ltr">${esc(cfg.publicBase)}</span>. שלחי לי את הכתובת, או כתבי אותה ב-r2PublicBase שב-media-manifest.js.</p>` : ''}
      <p class="adm-err" role="alert"></p>
      <div class="adm-actions">
        <button type="submit" class="btn btn-ink">שמירה</button>
        <button type="button" class="btn btn-line" data-forget>מחיקת המפתחות מהלשונית</button>
        <button type="button" class="btn btn-line" data-cancel>סגירה</button>
      </div>
    </form>`, { cls: 'adm-drawer', label: 'הגדרות ענן' });
  const keys = readKeys() || {};
  d.querySelector('input[name=accessKeyId]').value = keys.accessKeyId || '';
  d.querySelector('input[name=secret]').value = keys.secret || '';
  d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
  d.querySelector('[data-forget]').addEventListener('click', () => {
    ss.del(K_KEYS);
    d.querySelector('input[name=accessKeyId]').value = ''; d.querySelector('input[name=secret]').value = '';
    updateBar(); toast('המפתחות נמחקו מהלשונית.');
  });
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = d.querySelector('.adm-err');
    const bucket = String(f.get('bucket') || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) { err.textContent = 'שם דלי לא תקין: אותיות קטנות באנגלית, ספרות ומקף.'; return; }
    const publicBase = safeUrl(String(f.get('publicBase') || '').trim()).replace(/\/+$/, '');
    if (!/^https:\/\//.test(publicBase)) { err.textContent = 'כתובת הבסיס צריכה להתחיל ב-https://, למשל https://pub-xxxxxx.r2.dev'; return; }
    const accountId = String(f.get('accountId') || '').trim().toLowerCase();
    if (accountId && !/^[a-f0-9]{32}$/.test(accountId)) { err.textContent = 'Account ID הוא 32 תווים (0-9, a-f).'; return; }
    let prefix = String(f.get('prefix') || '').trim().replace(/^\/+/, '');
    if (prefix && !prefix.endsWith('/')) prefix += '/';
    const accessKeyId = String(f.get('accessKeyId') || '').trim();
    const secret = String(f.get('secret') || '').trim();
    if ((accessKeyId || secret) && !(accessKeyId && secret && accountId)) { err.textContent = 'להעלאה ישירה צריך את שלושתם: Account ID, Access Key ID ו-Secret Access Key.'; return; }
    ls.set(K_CLOUD, { accountId, bucket, publicBase, prefix });
    if (accessKeyId && secret) ss.set(K_KEYS, JSON.stringify({ accessKeyId, secret })); else ss.del(K_KEYS);
    d.close();
    updateBar();
    toast(hasKeys() ? 'ההגדרות נשמרו. אפשר לפרסם ישירות ל-R2.' : 'ההגדרות נשמרו. בלי מפתחות: גררי סרטונים ולחצי "הורדת videos-manifest.json".');
  });
  d.showModal();
  d.querySelector('input').focus();
}

async function publish() {
  if (!state || state.publishing) return;
  const cfg = readCfg();
  const keys = readKeys();
  if (!hasKeys()) { toast('להעלאה ישירה צריך Account ID ומפתחות. בלי מפתחות: "הורדת videos-manifest.json".'); cloudDrawer(); return; }
  const st = state;
  st.publishing = true;
  const pubBtn = st.bar.querySelector('[data-publish]');
  pubBtn.disabled = true;
  const d = dialog(`
    <div class="adm-form">
      <h2>פרסום ל-R2</h2>
      <ol class="adm-progress" aria-live="polite"></ol>
      <p class="adm-err" role="alert"></p>
      <div class="adm-actions"><button type="button" class="btn btn-ink" data-close disabled>סגירה</button></div>
    </div>`, { label: 'פרסום ל-R2' });
  const log = d.querySelector('.adm-progress'), err = d.querySelector('.adm-err'), close = d.querySelector('[data-close]');
  close.addEventListener('click', () => d.close());
  d.addEventListener('cancel', (e) => { if (st.publishing) e.preventDefault(); }); // no closing mid-upload
  d.showModal();
  const step = (t) => { const li = document.createElement('li'); li.textContent = t; log.appendChild(li); return li; };
  const alive = () => state === st;
  const stamp = Date.now().toString(36);
  try {
    for (const slot of st.draft) {
      const p = st.pending.get(slot.id);
      if (!p) continue;
      const ext = (p.file.name.match(/\.(\w{2,5})$/) || [, 'mp4'])[1].toLowerCase();
      const li = step(`מעלה את "${slot.title}" (${Math.max(1, Math.round(p.file.size / 1048576))}MB)...`);
      const src = await r2Upload({ cfg, keys, key: `${cfg.prefix}videos/${slot.id}-${stamp}.${ext}`, blob: p.file, contentType: p.file.type || 'video/mp4', cacheControl: 'public, max-age=31536000, immutable', onProgress: (f) => { li.dataset.pct = Math.round(f * 100) + '%'; } });
      if (!alive()) return;
      const poster = p.posterBlob
        ? await r2Upload({ cfg, keys, key: `${cfg.prefix}posters/${slot.id}-${stamp}.webp`, blob: p.posterBlob, contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' })
        : '';                                   // no new poster: do not keep the poster of the previous video
      if (!alive()) return;
      slot.src = src; slot.poster = poster;
      li.textContent += ' הועלה.';
      dropPending(slot.id);
      saveDraft();
      st.bump && st.bump();
    }
    const li = step('מפרסם את רשימת המשבצות (videos-manifest.json)...');
    await r2Upload({ cfg, keys, key: `${cfg.prefix}videos-manifest.json`, blob: new Blob([manifestJson(st.draft)], { type: 'application/json' }), contentType: 'application/json', cacheControl: 'no-cache, max-age=0' });
    if (!alive()) return;
    li.textContent += ' פורסם.';
    const live = cfg.publicBase === mediaConfig.r2PublicBase && (cfg.prefix || '') === (mediaConfig.r2Prefix || '');
    if (live) {
      // Only when the site actually reads from this bucket does the published list become "public"
      st.publicList = st.draft.map((x) => ({ ...x }));
      st.baseSig = sig(st.publicList);
      saveDraft();
    }
    step(live
      ? 'סיום. המבקרים יראו את השינויים בטעינה הבאה של הדף.'
      : `סיום. הקבצים ב-R2, אבל האתר הציבורי עוד לא קורא מהכתובת הזו. צריך לכתוב פעם אחת r2PublicBase: '${cfg.publicBase}' ב-media-manifest.js. הרשימה: ${r2ManifestUrl(cfg.publicBase, cfg.prefix)}`);
  } catch (e) {
    err.textContent = e.message || 'הפרסום נכשל.';
  } finally {
    st.publishing = false;
    pubBtn.disabled = false;
    if (d.isConnected) { close.disabled = false; close.focus(); }
    if (alive()) { renderEditor(); updateBar(); }
  }
}
