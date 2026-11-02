// Hash router for the three rooms. The source of truth is location.hash.
// Every route change goes through a single handler (hashchange), so there is no double-firing between pushState and hashchange.
// The panels' ids (room-web...) deliberately differ from the hash values, so the browser never scrolls on its own.

export const ROOMS = ['web', 'ai-video', 'engineering'];

/** '#engineering/cv' → { room: 'engineering', anchor: 'cv' }. Unknown → web. */
export function parseHash(hash) {
  const raw = decodeURIComponent(String(hash || '').replace(/^#\/?/, ''));
  const [head, ...rest] = raw.split('/');
  if (ROOMS.includes(head)) return { room: head, anchor: rest.join('/') || undefined };
  // Legacy anchors from the old site (#contact, #pricing...) and anchors inside rooms
  const legacy = { contact: 'web', pricing: 'web', works: 'web', templates: 'web', faq: 'web', about: 'engineering', cv: 'engineering' };
  if (legacy[head]) return { room: legacy[head], anchor: head };
  return { room: 'web', anchor: undefined };
}

export function createRouter(onChange) {
  let current = null;
  let currentAnchor;
  let first = true;
  let programmatic = false;

  function handle() {
    const { room, anchor } = parseHash(location.hash);
    const cause = first ? 'init' : programmatic ? 'nav' : 'pop';
    first = false;
    programmatic = false;
    const changed = room !== current;
    const prev = current;
    current = room;
    currentAnchor = anchor;
    onChange({ room, prev, anchor, changed, cause });
  }

  window.addEventListener('hashchange', handle);

  return {
    start: handle,
    current: () => current,
    anchor: () => currentAnchor,
    /** Navigate. Assigning location.hash adds a history entry and fires hashchange, which is the only render path. */
    go(room, anchor) {
      const target = '#' + room + (anchor ? '/' + anchor : '');
      programmatic = true;
      if (location.hash === target) { handle(); return; }
      location.hash = target;
    },
  };
}
