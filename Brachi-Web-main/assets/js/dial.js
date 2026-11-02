// Dial behaviour: thumb on the rail, preview pill, first-entry tour, and one nudge.
// Everything is in addition to the plain links: without JS the dial is still three working links.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return '1'; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* */ } },
};

export function initDial({ onFirstSwitch } = {}) {
  const dial = document.querySelector('.dial');
  const track = dial.querySelector('[data-dial]');
  const words = [...track.querySelectorAll('.dial-word')];
  const rail = track.querySelector('.dial-rail');
  const ticks = [...rail.querySelectorAll('.dial-tick')];
  const thumb = track.querySelector('.dial-thumb');
  const pill = track.querySelector('.dial-pill');
  let focusWord = null;      // a word the thumb is temporarily on (tour)
  let touring = false;
  let switched = false;
  let nudgeT = 0;

  const glyphRect = (w) => {
    const g = w.querySelector('.w-glyph').getBoundingClientRect();
    const t = track.getBoundingClientRect();
    return { x: g.left - t.left, y: g.top - t.top, w: g.width, h: g.height, cx: g.left - t.left + g.width / 2 };
  };

  function placeThumb(word) {
    if (!word) return;
    const r = glyphRect(word);
    track.style.setProperty('--tx', r.x + 'px');
    track.style.setProperty('--ty', (r.y + r.h + track.clientHeight * 0 + 2) + 'px');
    track.style.setProperty('--tw', r.w + 'px');
  }

  function measure() {
    const rects = words.map(glyphRect);
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const y = Math.max(...rects.map((r) => r.y + r.h)) + 2;
    track.style.setProperty('--rail-l', left + 'px');
    track.style.setProperty('--rail-w', (right - left) + 'px');
    track.style.setProperty('--rail-y', y + 'px');
    ticks.forEach((t, i) => { t.style.left = (rects[i].cx - left) + 'px'; });
    track.style.setProperty('--py', y + 'px');
    placeThumb(focusWord || current());
    dial.classList.add('is-measured');
  }

  const current = () => words.find((w) => w.getAttribute('aria-current') === 'page') || words[0];

  function showPill(word) {
    if (!word || !fine.matches) return;
    const r = glyphRect(word);
    pill.textContent = word.dataset.peek;
    // Centre the pill under the word, clamped inside the screen
    const pw = pill.offsetWidth;
    const t = track.getBoundingClientRect();
    let x = r.cx - pw / 2;
    x = Math.max(-t.left + 12, Math.min(x, innerWidth - t.left - pw - 12));
    track.style.setProperty('--px', x + 'px');
    pill.classList.add('is-on');
  }
  const hidePill = () => pill.classList.remove('is-on');

  for (const w of words) {
    w.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !touring) { showPill(w); cancelNudge(); } });
    w.addEventListener('pointerleave', () => { if (!touring) hidePill(); });
    w.addEventListener('focus', () => { if (!touring && w.matches(':focus-visible')) showPill(w); });
    w.addEventListener('blur', hidePill);
    w.addEventListener('click', () => { switched = true; cancelNudge(); stopTour(); hidePill(); });
  }

  // ── First-entry tour: מערכות → סרטונים → אתרים → the active room ──
  let tourTimers = [];
  function stopTour() {
    if (!touring) return;
    tourTimers.forEach(clearTimeout); tourTimers = [];
    touring = false; focusWord = null;
    words.forEach((w) => w.classList.remove('is-tour'));
    dial.classList.remove('is-touring');
    hidePill();
    placeThumb(current());
  }
  function tour() {
    if (reduced() || ss.get('bp-dial-tour')) return false;
    const r = dial.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return false;
    ss.set('bp-dial-tour', '1');
    touring = true;
    dial.classList.add('is-touring');
    const order = [...words].reverse(); // visual order in RTL: from the leftmost word to the rightmost
    const STEP = 430;
    order.forEach((w, i) => tourTimers.push(setTimeout(() => {
      words.forEach((x) => x.classList.toggle('is-tour', x === w));
      focusWord = w; placeThumb(w); showPill(w);
    }, 120 + i * STEP)));
    tourTimers.push(setTimeout(stopTour, 120 + order.length * STEP + 120));
    const cancel = () => { stopTour(); removeEventListener('pointerdown', cancel, true); removeEventListener('keydown', cancel, true); removeEventListener('wheel', cancel, true); };
    addEventListener('pointerdown', cancel, true);
    addEventListener('keydown', cancel, true);
    addEventListener('wheel', cancel, { capture: true, passive: true });
    return true;
  }

  // ── One nudge, 4 seconds without choosing a room ──
  function scheduleNudge(delay) {
    if (reduced() || ss.get('bp-dial-nudge')) return;
    nudgeT = setTimeout(() => {
      const r = dial.getBoundingClientRect();
      if (switched || r.bottom < 0 || document.visibilityState !== 'visible') return;
      ss.set('bp-dial-nudge', '1');
      dial.classList.add('is-nudge');
      setTimeout(() => dial.classList.remove('is-nudge'), 1700);
    }, delay);
  }
  function cancelNudge() { clearTimeout(nudgeT); }

  new ResizeObserver(() => measure()).observe(track);
  addEventListener('resize', measure, { passive: true });
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    measure();
    const toured = tour();
    scheduleNudge(toured ? 4000 + 1600 : 4000);
  });

  return {
    /** Called after every room change */
    update(room, { userInitiated } = {}) {
      if (userInitiated) { switched = true; cancelNudge(); }
      if (!touring) placeThumb(current());
      if (onFirstSwitch && userInitiated) onFirstSwitch(room);
    },
    setCount(room, n) {
      const el = track.querySelector(`[data-room-link="${room}"] .w-count`);
      if (el) el.textContent = String(n);
    },
    measure,
  };
}
