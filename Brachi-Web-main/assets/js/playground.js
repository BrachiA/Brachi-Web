// Live demo playground: one iframe, five styles, a computer/phone toggle, and a CTA back into the page.
const IDS = ['sport', 'pizza', 'luxury', 'tech', 'clinic'];
const NAMES = { sport: 'כושר ואקסטרים', pizza: 'פיצרייה ומסעדת שף', luxury: 'בוטיק יוקרה ותכשיטים', tech: 'הייטק ו-SaaS', clinic: 'אדריכלות וקליניקה' };

export function initPlayground(root, { onChoose }) {
  const list = root.querySelector('.pg-list');
  const items = [...list.querySelectorAll('[data-style]')];
  const device = root.querySelector('.device');
  const viewport = root.querySelector('.device-viewport');
  const stage = root.querySelector('.pg-stage');
  const iframe = device.querySelector('iframe');
  const openLink = root.querySelector('.pg-open');
  const vpButtons = [...root.querySelectorAll('[data-vp]')].filter((b) => b.tagName === 'BUTTON');
  const chooseBtn = root.querySelector('[data-choose]');
  let current = 'sport';
  let vp = matchMedia('(min-width: 1100px)').matches ? 'desktop' : 'mobile';
  let active = false;

  function fit() {
    const frameW = vp === 'desktop' ? 1280 : 390;
    // Measure the stage, not the frame: the frame's width depends on k, which would be circular
    const avail = Math.max(240, stage.clientWidth - (vp === 'desktop' ? 16 : 20));
    const k = Math.min(1, avail / frameW);
    device.style.setProperty('--k', k.toFixed(4));
    const frameH = vp === 'desktop' ? 760 : Math.min(760, Math.max(560, Math.round(innerHeight * 0.78 / k)));
    device.style.setProperty('--frame-h', frameH + 'px');
  }

  function setVp(next) {
    vp = next;
    device.dataset.vp = vp;
    for (const b of vpButtons) b.setAttribute('aria-pressed', String(b.dataset.vp === vp));
    fit();
  }

  function load(id) {
    if (!IDS.includes(id)) return;
    current = id;
    const src = `/demos/${id}.html`;
    openLink.href = src;
    iframe.title = `דמו: ${NAMES[id]}`;
    for (const li of items) {
      const on = li.dataset.style === id;
      li.setAttribute('aria-selected', String(on));
      li.tabIndex = on ? 0 : -1;
    }
    if (!active) return;
    if (iframe.dataset.src === src) return;
    navigate(src);
  }

  iframe.addEventListener('load', () => device.classList.remove('is-loading'));

  // Changing an iframe's src adds an entry to the tab's history, so "back" would change the demo instead of the page.
  // location.replace inside the frame swaps the document without a history entry.
  function navigate(url) {
    device.classList.add('is-loading');
    iframe.dataset.src = url;
    try {
      const w = iframe.contentWindow;
      if (w && iframe.getAttribute('src')) { w.location.replace(new URL(url, location.href).href); return; }
    } catch { /* fall back to src */ }
    iframe.src = url;
  }

  items.forEach((li) => {
    li.addEventListener('click', () => load(li.dataset.style));
    li.addEventListener('keydown', (e) => {
      const i = items.indexOf(li);
      // Vertical list on desktop, horizontal row on mobile. In RTL, ArrowLeft = next.
      const next = ['ArrowDown', 'ArrowLeft'].includes(e.key) ? 1 : ['ArrowUp', 'ArrowRight'].includes(e.key) ? -1 : 0;
      if (next) {
        e.preventDefault();
        const t = items[(i + next + items.length) % items.length];
        t.focus(); load(t.dataset.style);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); load(li.dataset.style);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault(); const t = items[e.key === 'Home' ? 0 : items.length - 1]; t.focus(); load(t.dataset.style);
      }
    });
  });

  for (const b of vpButtons) b.addEventListener('click', () => setVp(b.dataset.vp));
  chooseBtn.addEventListener('click', () => onChoose(current));

  // CTA from inside the demo. The frame is same-origin, so we check source as well as origin.
  addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.type !== 'bp:choose-style' || !IDS.includes(d.id)) return;
    onChoose(d.id);
  });

  new ResizeObserver(() => fit()).observe(stage);
  setVp(vp);

  return {
    enter() {
      active = true;
      const src = `/demos/${current}.html`;
      if (iframe.dataset.src !== src) navigate(src);
      fit();
    },
    leave() {
      active = false;
      // Unload the demo (timers, audio, animation) while it is out of view
      if (iframe.dataset.src !== 'about:blank') navigate('about:blank');
      device.classList.remove('is-loading');
    },
  };
}
