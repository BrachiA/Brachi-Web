// Content edits for the "אתרים" and "מערכות" rooms, published from the editor to Cloudflare R2 (site-content.json).
// Format: { version, updated, texts: { key: { t, o } }, order: { container: [blockId…] }, hidden: [blockId…] }
//   t = new text, o = fingerprint of the original text. A change is applied only if the original in the HTML has not
//   changed since (so an edit never lands on the wrong element after the HTML is updated).
// Text only (textContent), never HTML, so the file cannot inject code into the page.
import { mediaConfig } from './media-manifest.js';
import { joinUrl, loadManifestMeta } from './video-store.js';

export const ROOM_SELECTOR = '[data-room-panel="web"], [data-room-panel="engineering"]';
const EDITABLE = 'h2, h3, h4, h5, p, li, summary, th, td, blockquote p, blockquote footer, span.pg-name, span.pg-fit, span.l-name, span.l-desc, a.btn, a.link';
const EXCLUDE = '.diagram, .diagram-caption, .device, .chips, .skills, .form, .sr, [aria-hidden="true"], script, style';
const K_CACHE = 'bp-site-content';

export const hash = (str) => { let h = 5381; for (const c of String(str)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(36); };
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

const originals = new Map();   // key → { el, text }
const blockOrder = new Map();  // container id → [block ids in the original HTML order]
let annotated = false;

/** Called once at load, before any change: gives every editable text a stable key, and records the original order */
export function annotate() {
  if (annotated) return;
  annotated = true;
  for (const room of document.querySelectorAll(ROOM_SELECTOR)) {
    const counters = new Map();
    for (const el of room.querySelectorAll(EDITABLE)) {
      if (el.children.length || el.closest(EXCLUDE)) continue;
      const text = clean(el.textContent);
      if (!text) continue;
      const block = el.closest('[data-block]');
      const scope = block ? block.dataset.block : room.dataset.roomPanel;
      const n = counters.get(scope) || 0;
      counters.set(scope, n + 1);
      const key = `${scope}:${n}`;
      el.dataset.ek = key;
      originals.set(key, { el, text });
    }
  }
  for (const c of document.querySelectorAll('[data-blocks]')) {
    blockOrder.set(c.dataset.blocks, childBlocks(c).map((b) => b.dataset.block));
  }
}

export const childBlocks = (c) => [...c.children].filter((x) => x.dataset && x.dataset.block);
export const editableElements = () => [...originals.values()].map((o) => o.el);
export const originalText = (key) => (originals.get(key) || {}).text;
export const originalOrder = (id) => blockOrder.get(id) || [];

/** Applies a content file to the page. Calling it again with a different file starts from the original */
export function apply(content) {
  annotate();
  const c = content && typeof content === 'object' ? content : {};
  const texts = c.texts && typeof c.texts === 'object' ? c.texts : {};
  for (const [key, o] of originals) {
    const ov = texts[key];
    const next = ov && typeof ov.t === 'string' && ov.o === hash(o.text) ? ov.t.slice(0, 2000) : o.text;
    if (clean(o.el.textContent) !== next) o.el.textContent = next;
  }
  const order = c.order && typeof c.order === 'object' ? c.order : {};
  for (const container of document.querySelectorAll('[data-blocks]')) {
    const id = container.dataset.blocks;
    const wanted = Array.isArray(order[id]) ? order[id] : originalOrder(id);
    reorder(container, wanted);
  }
  const hidden = new Set(Array.isArray(c.hidden) ? c.hidden : []);
  for (const b of document.querySelectorAll('[data-block]')) {
    const off = hidden.has(b.dataset.block);
    b.toggleAttribute('data-hidden-block', off);
  }
}

/** Puts the blocks of a container in the requested order, in the same slots (headings and other non-block elements stay where they are) */
export function reorder(container, ids) {
  const blocks = childBlocks(container);
  const byId = new Map(blocks.map((b) => [b.dataset.block, b]));
  const ordered = [...ids.filter((i) => byId.has(i)).map((i) => byId.get(i)), ...blocks.filter((b) => !ids.includes(b.dataset.block))];
  const slots = blocks.map((b) => { const m = document.createComment('slot'); b.replaceWith(m); return m; });
  slots.forEach((m, i) => m.replaceWith(ordered[i]));
}

export function contentUrl() {
  return mediaConfig.r2PublicBase ? joinUrl(mediaConfig.r2PublicBase, `${mediaConfig.r2Prefix || ''}site-content.json`) : '';
}

let published = null;
/** The published version (from R2), or null if nothing has been published */
export function loadPublished() {
  if (!published) {
    published = (async () => {
      const url = contentUrl();
      if (!url) return null;
      // Ask for the file only if the video list says it was published (no 404 in the console for visitors before that)
      const m = await loadManifestMeta();
      if (!m || !m.siteContent) return null;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      try {
        const res = await fetch(`${url}?v=${encodeURIComponent(m.siteContent)}`, { cache: 'no-store', signal: ctl.signal });
        if (!res.ok) return null;
        const data = await res.json();
        return data && typeof data === 'object' ? data : null;
      } catch { return null; } finally { clearTimeout(t); }
    })();
  }
  return published;
}

/** On page load: apply right away from this browser's cache (no flash for returning visitors), then from R2 */
export function boot() {
  annotate();
  try { const cached = JSON.parse(localStorage.getItem(K_CACHE) || 'null'); if (cached) apply(cached); } catch { /* */ }
  return loadPublished().then((data) => {
    if (document.body.classList.contains('is-admin')) return data;   // in editing mode the editor decides what is shown
    apply(data);
    try { if (data) localStorage.setItem(K_CACHE, JSON.stringify(data)); else localStorage.removeItem(K_CACHE); } catch { /* */ }
    return data;
  });
}
