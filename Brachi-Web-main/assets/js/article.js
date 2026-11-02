// Shared article page script: reading time, table of contents with scroll-spy, offline (SW) registration.
(() => {
  const body = document.querySelector('.article-body');
  if (!body) return;

  // Reading time: words / 200, rounded up
  const words = (body.innerText || body.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  document.querySelectorAll('[data-reading-time]').forEach((el) => { el.textContent = String(minutes); });

  // Table of contents, built from the h2 headings
  const toc = document.querySelector('.toc');
  const list = toc && toc.querySelector('ol');
  const heads = [...body.querySelectorAll('h2[id]')];
  const links = new Map();
  if (list) {
    heads.forEach((h, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + h.id;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = (i + 1) + '.';
      a.append(n, document.createTextNode(h.textContent.trim()));
      li.appendChild(a);
      list.appendChild(li);
      links.set(h, a);
    });

    // Wide screens: always open (sticky side column). Narrow: closed, with a summary that opens it.
    const wide = matchMedia('(min-width: 1100px)');
    const sync = () => { toc.open = wide.matches; };
    sync();
    wide.addEventListener('change', sync);
    list.addEventListener('click', (e) => {
      if (e.target.closest('a') && !wide.matches) toc.open = false;
    });
  }

  // Scroll-spy: the active chapter is the last one whose heading has crossed the top third of the screen
  if ('IntersectionObserver' in window && heads.length) {
    const visible = new Set();
    const setCurrent = (h) => {
      links.forEach((a, head) => {
        if (head === h) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
      // Chapter = the h2's parent section. Pick the first one in document order that is currently on screen.
      const current = heads.find((h) => visible.has(h.closest('section') || h));
      if (current) setCurrent(current);
    }, { rootMargin: '-30% 0px -60% 0px' });
    heads.forEach((h) => io.observe(h.closest('section') || h));
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
