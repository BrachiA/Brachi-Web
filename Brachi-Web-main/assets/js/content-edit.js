// Editing the "אתרים" and "מערכות" rooms in place (editing mode only).
// Texts: click and type. Sections and items: one floating toolbar (up, down, hide) above the section the pointer or focus is on.
// Keyboard: inside a text, Alt+↑ / Alt+↓ moves its section, Alt+H hides or shows it.
import { annotate, apply, editableElements, originalText, originalOrder, childBlocks, reorder, hash, loadPublished, ROOM_SELECTOR } from './site-content.js';

const K_DRAFT = 'bp-admin-content-draft';
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

const LABELS = {
  'web-intro': 'פתיחה', 'web-playground': 'דמואים', 'web-live': 'אתרים באוויר', 'web-pricing': 'מחירים', 'web-faq': 'שאלות נפוצות', 'web-contact': 'טופס פנייה',
  'eng-intro': 'פתיחה', 'flag-multi-ai': 'Multi-AI', 'flag-wallet': 'ארנק הטבות', 'flag-assistiq': 'AssistIQ', 'eng-tail': 'קורות חיים ועוד',
  'eng-cv': 'קורות חיים', 'eng-ledger': 'עוד דברים שבניתי', 'eng-about': 'קצת עליי',
};
const label = (id) => LABELS[id] || (id.startsWith('faq-') ? 'שאלה' : id.startsWith('price-') ? 'חבילה' : id.startsWith('tl-') ? 'שורה בניסיון' : id.startsWith('ledger-') ? 'פרויקט' : id.startsWith('live-') ? 'אתר' : 'פריט');

function normalize(c) {
  const out = { texts: {}, order: {}, hidden: [] };
  if (!c || typeof c !== 'object') return out;
  if (c.texts && typeof c.texts === 'object') for (const [k, v] of Object.entries(c.texts)) if (v && typeof v.t === 'string') out.texts[k] = { t: v.t, o: v.o };
  if (c.order && typeof c.order === 'object') for (const [k, v] of Object.entries(c.order)) if (Array.isArray(v)) out.order[k] = v.map(String);
  if (Array.isArray(c.hidden)) out.hidden = [...new Set(c.hidden.map(String))];
  return out;
}
const sig = (c) => JSON.stringify([Object.entries(c.texts).sort(), Object.entries(c.order).sort(), [...c.hidden].sort()]);

export async function startContentEdit({ onChange }) {
  annotate();
  const loaded = await loadPublished();
  let published = normalize(loaded);
  let stamp = loaded && typeof loaded.updated === 'string' ? loaded.updated : '';
  const saved = ls.get(K_DRAFT);
  // A draft wins only if it was built on the version that is published now
  let draft = saved && saved.base === sig(published) ? normalize(saved.content) : normalize(published);
  apply(draft);
  document.body.classList.add('is-content-admin');

  const rooms = [...document.querySelectorAll(ROOM_SELECTOR)];
  const openedDetails = [];
  for (const r of rooms) for (const d of r.querySelectorAll('details:not([open])')) { d.open = true; openedDetails.push(d); }

  const save = () => { ls.set(K_DRAFT, { base: sig(published), content: draft }); onChange && onChange(); };

  // ── Texts ──
  const els = editableElements();
  for (const el of els) {
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = true;
    el.classList.add('ce-text');
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
  }
  function onInput(e) {
    const el = e.currentTarget, key = el.dataset.ek, orig = originalText(key);
    const t = clean(el.textContent).slice(0, 2000);
    if (t === orig || !t) delete draft.texts[key]; else draft.texts[key] = { t, o: hash(orig) };
    el.classList.toggle('ce-changed', !!draft.texts[key]);
    save();
  }
  function onPaste(e) {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
  }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); return; }
    if (e.key === 'Escape') { e.currentTarget.blur(); return; }
    const b = e.currentTarget.closest('[data-block]');
    if (!b || !e.altKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(b, e.key === 'ArrowUp' ? -1 : 1); e.currentTarget.focus(); }
    if (e.key === 'h' || e.key === 'H' || e.code === 'KeyH') { e.preventDefault(); toggleHidden(b); }
  }
  for (const el of els) el.classList.toggle('ce-changed', !!draft.texts[el.dataset.ek]);

  // In editing mode, links and forms in these rooms do not navigate or submit
  const guard = (e) => {
    const t = e.target.closest && e.target.closest('a[href], summary');
    if (t && t.closest(ROOM_SELECTOR) && !t.closest('.blk-tools')) e.preventDefault();
  };
  const guardSubmit = (e) => { if (e.target.closest(ROOM_SELECTOR)) e.preventDefault(); };
  document.addEventListener('click', guard, true);
  document.addEventListener('submit', guardSubmit, true);

  // ── Sections: one floating toolbar ──
  const tools = document.createElement('div');
  tools.className = 'blk-tools';
  tools.setAttribute('role', 'toolbar');
  tools.hidden = true;
  tools.innerHTML = `
    <span class="blk-name"></span>
    <button type="button" data-act="up" title="Alt+↑">↑ למעלה</button>
    <button type="button" data-act="down" title="Alt+↓">↓ למטה</button>
    <button type="button" data-act="hide" title="Alt+H"></button>
    <button type="button" data-act="parent">המקטע שמעל</button>`;
  document.body.appendChild(tools);
  let current = null;

  function place(b) {
    current = b;
    if (!b) { tools.hidden = true; return; }
    const r = b.getBoundingClientRect();
    tools.hidden = false;
    tools.querySelector('.blk-name').textContent = label(b.dataset.block) + (b.hasAttribute('data-hidden-block') ? ' (מוסתר)' : '');
    tools.querySelector('[data-act="hide"]').textContent = b.hasAttribute('data-hidden-block') ? 'הצגה' : 'הסתרה';
    const sibs = childBlocks(b.parentElement);
    const i = sibs.indexOf(b);
    tools.querySelector('[data-act="up"]').disabled = i <= 0;
    tools.querySelector('[data-act="down"]').disabled = i === sibs.length - 1;
    const parentBlock = b.parentElement.closest('[data-block]');
    tools.querySelector('[data-act="parent"]').hidden = !parentBlock || !parentBlock.closest(ROOM_SELECTOR);
    const top = Math.max(60, r.top - tools.offsetHeight - 4);
    tools.style.top = `${Math.min(top, innerHeight - tools.offsetHeight - 8)}px`;
    tools.style.left = `${Math.max(8, Math.min(r.right - tools.offsetWidth, innerWidth - tools.offsetWidth - 8))}px`;
    document.querySelectorAll('.blk-current').forEach((x) => x.classList.remove('blk-current'));
    b.classList.add('blk-current');
  }
  const blockFrom = (node) => {
    const b = node && node.closest && node.closest('[data-block]');
    return b && b.closest(ROOM_SELECTOR) ? b : null;
  };
  const onMove = (e) => { if (e.pointerType !== 'mouse' || tools.contains(e.target)) return; const b = blockFrom(e.target); if (b && b !== current) place(b); };
  const onFocus = (e) => { if (tools.contains(e.target)) return; const b = blockFrom(e.target); if (b) place(b); };
  const onTap = (e) => { if (e.pointerType !== 'mouse' && !tools.contains(e.target)) { const b = blockFrom(e.target); if (b) place(b); } };
  const onScroll = () => { if (current && document.contains(current)) place(current); };
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', onTap, { passive: true });
  document.addEventListener('focusin', onFocus);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });

  tools.addEventListener('click', (e) => {
    const act = e.target.closest('button') && e.target.closest('button').dataset.act;
    if (!act || !current) return;
    if (act === 'up' || act === 'down') move(current, act === 'up' ? -1 : 1);
    if (act === 'hide') toggleHidden(current);
    if (act === 'parent') place(current.parentElement.closest('[data-block]'));
  });

  function move(b, dir) {
    const container = b.parentElement;
    const id = container.dataset.blocks;
    if (!id) return;
    const ids = childBlocks(container).map((x) => x.dataset.block);
    const i = ids.indexOf(b.dataset.block), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(container, ids);
    if (JSON.stringify(ids) === JSON.stringify(originalOrder(id))) delete draft.order[id]; else draft.order[id] = ids;
    save();
    b.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    requestAnimationFrame(() => place(b));
  }
  function toggleHidden(b) {
    const id = b.dataset.block;
    const off = !b.hasAttribute('data-hidden-block');
    b.toggleAttribute('data-hidden-block', off);
    draft.hidden = off ? [...new Set([...draft.hidden, id])] : draft.hidden.filter((x) => x !== id);
    save();
    place(b);
  }

  return {
    isDirty: () => sig(draft) !== sig(published),
    summary() {
      return { texts: Object.keys(draft.texts).length, moved: Object.keys(draft.order).length, hidden: draft.hidden.length };
    },
    /** What gets published */
    json(at) { return JSON.stringify({ version: 1, updated: at, ...draft }, null, 2); },
    /** Timestamp of the published version (written into videos-manifest.json, so the site knows the file exists) */
    stamp: () => stamp,
    markPublished(at) {
      stamp = at;
      published = normalize(JSON.parse(JSON.stringify(draft)));
      try { localStorage.setItem('bp-site-content', JSON.stringify(published)); } catch { /* */ }
      save();
    },
    revert() {
      draft = normalize(published);
      apply(draft);
      for (const el of els) el.classList.toggle('ce-changed', !!draft.texts[el.dataset.ek]);
      ls.del(K_DRAFT);
      onChange && onChange();
    },
    stop() {
      for (const el of els) {
        el.removeAttribute('contenteditable');
        el.classList.remove('ce-text', 'ce-changed');
        el.removeEventListener('input', onInput);
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('paste', onPaste);
      }
      document.removeEventListener('click', guard, true);
      document.removeEventListener('submit', guardSubmit, true);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onTap);
      document.removeEventListener('focusin', onFocus);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
      tools.remove();
      document.querySelectorAll('.blk-current').forEach((x) => x.classList.remove('blk-current'));
      for (const d of openedDetails) d.open = false;
      document.body.classList.remove('is-content-admin');
      apply(published);          // the public view shows only what has been published
    },
  };
}
