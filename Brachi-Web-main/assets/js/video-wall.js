// Vertical 9:16 video wall: lazy loading, a concurrency cap, and slow-network protection.
import { paintBlurhash } from './blurhash.js';
import { CATEGORY_LABEL } from './media-manifest.js';

/**
 * @typedef {{ id:string, title:string, category:'reel'|'story'|'deck', tool:string,
 *   src?:string, cloudinaryId?:string, poster?:string, blurhash?:string }} AiVideo
 * @typedef {{ cloudinaryCloud?:string, r2Base?:string }} MediaConfig
 */

export function videoUrl(v, cfg) {
  if (v.cloudinaryId && cfg.cloudinaryCloud) {
    return `https://res.cloudinary.com/${cfg.cloudinaryCloud}/video/upload/f_auto,q_auto,vc_auto/${v.cloudinaryId}`;
  }
  if (!v.src) return null;
  if (/^https?:\/\//.test(v.src) || v.src.startsWith('/')) return v.src;
  return cfg.r2Base ? cfg.r2Base.replace(/\/?$/, '/') + v.src.replace(/^\//, '') : v.src;
}

export function posterUrl(v, cfg) {
  if (v.poster) return v.poster;
  if (v.cloudinaryId && cfg.cloudinaryCloud) {
    return `https://res.cloudinary.com/${cfg.cloudinaryCloud}/video/upload/so_0,f_auto,q_auto,w_360,h_640,c_fill/${v.cloudinaryId}.jpg`;
  }
  return null;
}

const ICON = {
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
};

function slowNetwork() {
  const c = navigator.connection;
  return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {HTMLElement} root  element containing .wall-river
 * @param {AiVideo[]} list
 * @param {MediaConfig} cfg
 */
export function initVideoWall(root, list, cfg) {
  const river = root.querySelector('.wall-river');
  const lightbox = root.querySelector('dialog.lightbox');
  const lbVideo = lightbox.querySelector('video');
  const lbTitle = lightbox.querySelector('.lb-title');
  /** @type {Map<HTMLElement, {v:AiVideo, video:HTMLVideoElement|null, url:string|null, ratio:number, token:number, playing:boolean, failed:number}>} */
  const cards = new Map();
  let active = false;
  let unmutedCard = null;
  let cap = 6;
  const capQuery = matchMedia('(max-width: 760px)');
  const weakDevice = (navigator.hardwareConcurrency || 8) <= 4;
  const setCap = () => { cap = capQuery.matches ? (weakDevice ? 2 : 3) : 6; reconcile(); };

  // Build the cards
  const frag = document.createDocumentFragment();
  for (const v of list) {
    const url = videoUrl(v, cfg);
    const poster = posterUrl(v, cfg);
    const card = document.createElement('figure');
    card.className = 'phone' + (url ? '' : ' phone--pending');
    card.dataset.category = v.category;
    const cat = CATEGORY_LABEL[v.category] || v.category;
    if (url) {
      card.innerHTML = `
        <div class="phone-screen">
          <canvas class="phone-blur" aria-hidden="true"></canvas>
          ${poster ? `<img class="phone-poster" alt="" decoding="async" loading="lazy" fetchpriority="low" src="${poster}">` : ''}
          <video muted loop playsinline preload="none" disablepictureinpicture disableremoteplayback aria-label="${v.title}"></video>
          <div class="phone-shimmer" aria-hidden="true"></div>
          <button class="phone-tap" type="button" hidden aria-label="נגנו את ${v.title}">${ICON.play}</button>
          <p class="phone-error" hidden>הסרטון לא נטען. <button type="button" class="link-btn phone-retry">נסו שוב</button></p>
        </div>
        <figcaption>
          <span class="phone-badge">${v.tool}</span>
          <span class="phone-title">${v.title}</span>
          <span class="phone-cat">${cat}</span>
          <span class="phone-ctrls">
            <button class="icon-btn phone-mute" type="button" aria-pressed="false" aria-label="הפעלת קול">${ICON.mute}</button>
            <button class="icon-btn phone-full" type="button" aria-label="צפייה במסך מלא">${ICON.expand}</button>
          </span>
        </figcaption>`;
      const canvas = card.querySelector('.phone-blur');
      if (!v.blurhash || !paintBlurhash(canvas, v.blurhash)) canvas.remove();
      const img = card.querySelector('.phone-poster');
      if (img) img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
      if (img) img.addEventListener('error', () => img.remove(), { once: true });
      cards.set(card, { v, video: card.querySelector('video'), url, ratio: 0, token: 0, playing: false, manual: false, failed: 0 });
    } else {
      card.innerHTML = `
        <div class="phone-screen phone-screen--pending" aria-hidden="true"><span class="pending-glow"></span></div>
        <figcaption><span class="phone-title">${v.title}</span><span class="phone-cat">${cat}, בהכנה</span></figcaption>`;
    }
    frag.appendChild(card);
  }
  river.appendChild(frag);

  // ── Playback controller ────────────────────────────────────────────────
  function eligible(s) {
    return active && document.visibilityState === 'visible' && !lightbox.open && s.ratio >= 0.6 &&
      !slowNetwork() && !reducedMotion() && s.failed < 2;
  }

  function stop(card, s) {
    s.token++;
    s.manual = false;
    if (s.video && !s.video.paused) s.video.pause();
    s.playing = false;
    card.classList.remove('is-playing');
  }

  function start(card, s) {
    if (s.playing) return;
    const v = s.video;
    if (!v.src) { v.muted = true; v.setAttribute('muted', ''); v.src = s.url; } // the first byte is downloaded only here (iOS needs the muted attribute too)
    const token = ++s.token;
    s.playing = true;
    card.classList.add('is-playing');
    const p = v.play();
    if (p && p.then) {
      p.then(() => {
        if (token !== s.token) return;   // the intent changed: stop() has already paused, and a newer action (tap/sound) must not be paused
      }).catch((err) => {
        if (token !== s.token || (err && err.name === 'AbortError')) return; // a pause/src change during play() is not an error
        s.playing = false;
        card.classList.remove('is-playing');
        if (err && err.name === 'NotAllowedError') card.querySelector('.phone-tap').hidden = false;
      });
    }
  }

  function reconcile() {
    const ranked = [...cards].filter(([, s]) => eligible(s)).sort((a, b) => b[1].ratio - a[1].ratio);
    const allowed = new Set(ranked.slice(0, cap).map(([c]) => c));
    for (const [card, s] of cards) {
      // A card the user started by hand (tap / turning sound on) keeps playing as long as it is still on screen
      if ((card === unmutedCard || s.manual) && s.playing && s.ratio > 0 && active && !lightbox.open && document.visibilityState === 'visible') continue;
      if (allowed.has(card)) start(card, s); else stop(card, s);
    }
    const manual = !active ? false : (slowNetwork() || reducedMotion());
    for (const [card, s] of cards) {
      card.querySelector('.phone-tap').hidden = !(manual && !s.playing);
    }
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = cards.get(e.target);
      if (s) s.ratio = e.isIntersecting ? e.intersectionRatio : 0;
    }
    reconcile();
  }, { root: null, threshold: [0, 0.6, 1] });
  // root: null (viewport). The horizontal river is clipped by overflow, so IO measures intersection
  // against the viewport *after* that clipping. This works the same in RTL and LTR, with no scrollLeft math.
  for (const card of cards.keys()) io.observe(card);

  // ── Card events ───────────────────────────────────────────────────────
  for (const [card, s] of cards) {
    const v = s.video;
    let waitTimer;
    v.addEventListener('waiting', () => { clearTimeout(waitTimer); waitTimer = setTimeout(() => card.classList.add('is-buffering'), 2500); });
    v.addEventListener('playing', () => { clearTimeout(waitTimer); card.classList.remove('is-buffering'); card.classList.add('has-frame'); });
    v.addEventListener('error', () => {
      clearTimeout(waitTimer);
      if (!v.getAttribute('src')) return; // the src was released on purpose
      s.failed++;
      stop(card, s);
      card.querySelector('.phone-error').hidden = false;
    });
    card.querySelector('.phone-retry').addEventListener('click', () => {
      card.querySelector('.phone-error').hidden = true;
      s.failed = 0;
      v.removeAttribute('src'); v.load();
      v.src = s.url;
      start(card, s);
    });
    card.querySelector('.phone-tap').addEventListener('click', () => {
      card.querySelector('.phone-tap').hidden = true;
      if (!v.src) v.src = s.url;
      s.token++;
      s.manual = true;
      const p = v.play();
      s.playing = true; card.classList.add('is-playing');
      if (p && p.catch) p.catch(() => { s.playing = false; s.manual = false; card.classList.remove('is-playing'); });
    });
    const muteBtn = card.querySelector('.phone-mute');
    muteBtn.addEventListener('click', () => {
      const turnOn = v.muted;
      if (unmutedCard && unmutedCard !== card) setMuted(unmutedCard, true);
      setMuted(card, !turnOn);
      if (turnOn) {
        if (!v.src) v.src = s.url;
        s.token++;
        s.manual = true;
        const p = v.play();
        s.playing = true; card.classList.add('is-playing');
        if (p && p.catch) p.catch(() => setMuted(card, true));
      }
      reconcile();
    });
    card.querySelector('.phone-full').addEventListener('click', () => openLightbox(card, s));
  }

  function setMuted(card, muted) {
    const s = cards.get(card);
    s.video.muted = muted;
    const btn = card.querySelector('.phone-mute');
    btn.setAttribute('aria-pressed', String(!muted));
    btn.setAttribute('aria-label', muted ? 'הפעלת קול' : 'השתקה');
    btn.innerHTML = muted ? ICON.mute : ICON.sound;
    unmutedCard = muted ? (unmutedCard === card ? null : unmutedCard) : card;
  }

  // ── Lightbox (FLIP from the card) ──────────────────────────────────────
  let lastOpener = null;
  function openLightbox(card, s) {
    if (lightbox.open) return;
    lastOpener = card.querySelector('.phone-full');
    if (unmutedCard) setMuted(unmutedCard, true);
    lbTitle.textContent = s.v.title;
    lbVideo.src = s.url;
    lbVideo.currentTime = s.video.currentTime || 0;
    lightbox.showModal();
    reconcile(); // pauses the whole wall
    const from = card.getBoundingClientRect();
    const to = lbVideo.getBoundingClientRect();
    if (!reducedMotion() && to.width && lbVideo.animate) {
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      lbVideo.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` },
        { transform: 'none' },
      ], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
    const p = lbVideo.play();
    if (p && p.catch) p.catch(() => {});
  }
  lightbox.addEventListener('close', () => {
    lbVideo.pause();
    lbVideo.removeAttribute('src'); lbVideo.load();
    reconcile();
    if (lastOpener) lastOpener.focus();
  });
  lightbox.querySelector('.lb-close').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });

  // ── Global signals ─────────────────────────────────────────────────────
  document.addEventListener('visibilitychange', reconcile);
  window.addEventListener('pagehide', () => { for (const [card, s] of cards) stop(card, s); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) reconcile(); });
  capQuery.addEventListener('change', setCap);
  if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', reconcile);
  setCap();

  return {
    enter() { active = true; reconcile(); },
    leave() {
      active = false;
      if (unmutedCard) setMuted(unmutedCard, true);
      if (lightbox.open) lightbox.close();
      reconcile();
      // Release decoders: an old phone with several open decoders can crash the tab
      for (const s of cards.values()) { if (s.video.src) { s.video.removeAttribute('src'); s.video.load(); } }
    },
  };
}
