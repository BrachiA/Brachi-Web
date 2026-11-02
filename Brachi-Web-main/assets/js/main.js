import { createRouter } from './router.js';

const WA = 'https://wa.me/972547568966';
const THEME = { web: '#ECEEE9', 'ai-video': '#0E1F24', engineering: '#ECEEE9' };

export const STYLES = {
  sport:  { name: 'כושר ואקסטרים' },
  pizza:  { name: 'פיצרייה ומסעדת שף' },
  luxury: { name: 'בוטיק יוקרה ותכשיטים' },
  tech:   { name: 'הייטק ו-SaaS' },
  clinic: { name: 'אדריכלות וקליניקה' },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const waLink = (text) => `${WA}?text=${encodeURIComponent(text)}`;

// ── Rooms: lazy initialisation, done once ───────────────────────────────
const rooms = {
  web: {
    async init(panel) {
      const { initPlayground } = await import('./playground.js');
      return initPlayground(panel, { onChoose: chooseStyle });
    },
  },
  'ai-video': {
    async init(panel) {
      const [{ initVideoWall }, { aiVideos, mediaConfig }] = await Promise.all([
        import('./video-wall.js'), import('./media-manifest.js'),
      ]);
      return initVideoWall(panel, aiVideos, mediaConfig);
    },
  },
  engineering: {
    async init(panel) {
      const [{ mountDiagrams }, { initCv }] = await Promise.all([import('./diagrams.js'), import('./cv.js')]);
      const d = mountDiagrams(panel);
      initCv(panel);
      return d;
    },
  },
};
const ctrl = {};       // room → Promise<{enter?, leave?}>
let lastPointer = 0;   // was the last navigation started with a pointer (as opposed to the keyboard)?
addEventListener('pointerdown', () => { lastPointer = performance.now(); }, { capture: true, passive: true });

function ensure(room) {
  if (!ctrl[room]) {
    const panel = $(`[data-room-panel="${room}"]`);
    ctrl[room] = rooms[room].init(panel).catch((err) => { console.warn('room init failed', room, err); return {}; });
  }
  return ctrl[room];
}

function render({ room, prev, anchor, changed, cause }) {
  let sub = anchor, query = '';
  if (sub && sub.includes('?')) [sub, query] = sub.split('?');

  if (changed) {
    document.body.dataset.room = room;
    for (const p of $$('[data-room-panel]')) p.hidden = p.dataset.roomPanel !== room;
    for (const a of $$('[data-room-link]')) {
      if (a.dataset.roomLink === room) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    for (const p of $$('[data-answer]')) p.hidden = p.dataset.answer !== room;
    $('meta[name="theme-color"]').setAttribute('content', THEME[room]);
    if (prev && ctrl[prev]) ctrl[prev].then((c) => c.leave && c.leave());
    ensure(room).then((c) => { if (document.body.dataset.room === room && c.enter) c.enter(); });
  }

  if (query) {
    const style = new URLSearchParams(query).get('style');
    if (style && STYLES[style]) chooseStyle(style, { scroll: false });
  }

  requestAnimationFrame(() => {
    const target = sub ? document.getElementById(sub) : null;
    if (target) {
      target.scrollIntoView({ block: 'start' });
      if (cause !== 'init' && target.matches('[tabindex="-1"], h2, h3')) target.focus({ preventScroll: true });
      else if (cause !== 'init') { const h = target.querySelector('[tabindex="-1"]'); if (h) h.focus({ preventScroll: true }); }
      return;
    }
    if (!changed || cause === 'init') return;
    // A room change from the sticky bar: return to the top of the room
    const dial = $('.dial');
    if (dial.getBoundingClientRect().bottom < 0) $(`[data-room-panel="${room}"]`).scrollIntoView({ block: 'start' });
    // Move focus only on keyboard navigation (a pointer would jump the page)
    if (cause === 'nav' && performance.now() - lastPointer > 600) {
      const h = $(`[data-room-panel="${room}"] [tabindex="-1"]`);
      if (h) h.focus({ preventScroll: true });
    }
  });
}

// ── Choosing a style from the playground → contact form ─────────────────
export function chooseStyle(id, { scroll = true } = {}) {
  const st = STYLES[id];
  if (!st) return;
  const sel = $('#contact select[name="style"]');
  if (sel) sel.value = st.name;
  const msg = `היי ברכי, אהבתי את סגנון "${st.name}" באתר שלך. אשמח לשמוע איך בונים לי אתר כזה.`;
  for (const a of $$('[data-wa-style]')) a.href = waLink(msg);
  if (!scroll) return;
  if (document.body.dataset.room !== 'web') { router.go('web', 'contact'); }
  const form = $('#contact .form');
  $('#contact').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  form.classList.remove('is-flash'); void form.offsetWidth; form.classList.add('is-flash');
  setTimeout(() => $('#contact input[name="name"]').focus({ preventScroll: true }), 400);
}

// ── Compact bar: a fixed-size sentinel above the dial, so the bar does not flicker ──
const io = new IntersectionObserver(([e]) => {
  document.body.classList.toggle('dial-compact', !e.isIntersecting && e.boundingClientRect.top < 0);
}, { rootMargin: '-56px 0px 0px 0px' });
const dialEnd = document.createElement('div');
dialEnd.setAttribute('aria-hidden', 'true');
$('.dial').appendChild(dialEnd);
io.observe(dialEnd);

// ── Fixed WhatsApp links ─────────────────────────────────────────────────
$('[data-wa]').href = waLink('היי ברכי, הגעתי מהאתר שלך.');
for (const a of $$('[data-wa-style]')) a.href = waLink('היי ברכי, אשמח לשמוע על בניית אתר.');
const waVideo = $('[data-wa-video]');
if (waVideo) waVideo.href = waLink('היי ברכי, אני מעוניין/ת בסרטון AI. הנה מה שאני צריך/ה:');

// ── Start ───────────────────────────────────────────────────────────────
const router = createRouter(render);
router.start();

// Prefetch the next rooms when the browser is idle (code only, no media)
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
idle(() => { import('./diagrams.js'); import('./video-wall.js'); import('./playground.js'); });

// Offline + Service Worker
import('./offline.js').then((m) => m.initOffline()).catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
