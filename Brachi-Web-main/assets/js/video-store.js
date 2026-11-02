// Where the video list comes from, in priority order:
//   1. Google Cloud Storage: https://storage.googleapis.com/<bucket>/<prefix>videos-manifest.json (when gcsBucket is set in media-manifest.js)
//   2. /videos-manifest.json in the repo
//   3. The built-in list in media-manifest.js
// Everything is validated: only http(s) or relative addresses, length limits, and no HTML.
import { aiVideos, mediaConfig } from './media-manifest.js';

const MAX_SLOTS = 60;
const str = (v, max = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Accepts only https:/http: or a site-relative path. Rejects javascript:, data:, blob: and the like. */
export function safeUrl(u) {
  const s = str(u, 600);
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
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

export function gcsManifestUrl(bucket = mediaConfig.gcsBucket, prefix = mediaConfig.gcsPrefix || '') {
  if (!bucket) return '';
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${prefix}videos-manifest.json`;
}

async function fetchJson(url, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return sanitizeList(Array.isArray(data) ? data : data && data.slots);
  } catch { return null; } finally { clearTimeout(t); }
}

let cached = null;
/** The public list. Loaded once per page load. */
export function loadPublicList() {
  if (!cached) {
    cached = (async () => {
      const remote = mediaConfig.gcsBucket ? await fetchJson(gcsManifestUrl()) : null;
      if (remote) return remote;
      const local = await fetchJson('/videos-manifest.json');
      if (local) return local;
      return sanitizeList(aiVideos);
    })();
  }
  return cached;
}
