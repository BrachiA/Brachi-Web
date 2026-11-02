// Filter the skills matrix by domain
export function initCv(root) {
  const chips = [...root.querySelectorAll('.chips .chip')];
  const skills = [...root.querySelectorAll('.skills li')];
  const apply = (f) => {
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.filter === f));
    for (const s of skills) {
      const on = f === 'all' || s.dataset.cat === f;
      s.classList.toggle('is-dim', !on);
      s.classList.toggle('is-on', on && f !== 'all');
    }
  };
  for (const c of chips) c.addEventListener('click', () => apply(c.dataset.filter));
}
