// Where the video list comes from, in priority order:
//   1. Cloudflare R2: <r2PublicBase>/<r2Prefix>videos-manifest.json (when r2PublicBase is set in media-manifest.js)
//   2. /videos-manifest.json in the repo
//   3. The built-in list in media-manifest.js
// Everything is validated: only https or site-relative addresses, length limits, and no HTML.
import { aiVideos, mediaConfig } from './media-manifest.js';

const MAX_SLOTS = 60;
const str = (v, max = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Accepts only https: or a site-relative path. Rejects javascript:, data:, blob: and the like. */
export function safeUrl(u) {
  const s = str(u, 600);
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' ? url.href : '';   // http would be blocked as mixed content on an https page
  } catch { return ''; }
}

export function sanitizeSlot(raw, i = 0) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = str(r.id, 60).replace(/[^\w-]/g, '') || `slot-${Date.now().toString(36)}-${i}`;
  return {
    id,
    title: str(r.title) || 'משבצת חדשה',
    subtitle: str(r.subtitle, 240),
    category: str(r.category, 40),
    tool: str(r.tool, 40),
    src: safeUrl(r.src),
    poster: safeUrl(r.poster),
    cloudinaryId: str(r.cloudinaryId, 200),
    blurhash: str(r.blurhash, 120),
  };
}

export function sanitizeList(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  return list.slice(0, MAX_SLOTS).map(sanitizeSlot).map((s) => {
    while (seen.has(s.id)) s.id += '-b';
    seen.add(s.id);
    return s;
  });
}

/** Joins a base address and a key, encoding each path segment (a file name may contain spaces or Hebrew) */
export function joinUrl(base, key) {
  return String(base || '').replace(/\/+$/, '') + '/' + String(key).split('/').map(encodeURIComponent).join('/');
}

export function r2ManifestUrl(base = mediaConfig.r2PublicBase, prefix = mediaConfig.r2Prefix || '') {
  if (!base) return '';
  return joinUrl(base, `${prefix}videos-manifest.json`);
}

let meta = null;   // the fields of the manifest that loaded, besides the slots (e.g. siteContent)
async function fetchJson(url, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const list = sanitizeList(Array.isArray(data) ? data : data && data.slots);
    if (list && data && !Array.isArray(data)) meta = { siteContent: typeof data.siteContent === 'string' ? data.siteContent.slice(0, 40) : '' };
    return list;
  } catch { return null; } finally { clearTimeout(t); }
}

let cached = null;
/** The public list. Loaded once per page load. */
export function loadPublicList() {
  if (!cached) {
    cached = (async () => {
      const remote = mediaConfig.r2PublicBase ? await fetchJson(r2ManifestUrl()) : null;
      if (remote) return remote;
      const local = await fetchJson('/videos-manifest.json');
      if (local) return local;
      return sanitizeList(aiVideos);
    })();
  }
  return cached;
}

/** Whether page changes (site-content.json) have been published, according to the video list in R2 */
export async function loadManifestMeta() {
  await loadPublicList();
  return meta;
}
