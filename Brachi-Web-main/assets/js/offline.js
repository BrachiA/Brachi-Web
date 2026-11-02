// What happens when the internet goes down: a toast, a mini-game, and an offline CV and articles (via sw.js).

const CODE = [
  'function addToCart(cart, item) {',
  '  const qty = item.qty ?? 1;',
  '  if (qty <= 0) return cart;',
  '  const line = cart.find(l => l.id === item.id);',
  '  if (line) line.qty += qty;',
  '  else cart.push({ ...item, qty });',
  '  cart.total = cart.reduce((s, l) => s + l.price * l.qty, 0);',
  '  saveCart(cart);',
  '  return cart;',
];
const BUG = '<svg class="bug" viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="18" rx="7" ry="9" fill="#F2A93B"/><circle cx="16" cy="8" r="4" fill="#13252B"/><path d="M16 9v18" stroke="#13252B" stroke-width="1.5"/><path d="M9 14l-5-3M9 19H3M9 24l-5 3M23 14l5-3M23 19h6M23 24l5 3M14 5l-3-3M18 5l3-3" stroke="#13252B" stroke-width="1.6" stroke-linecap="round"/></svg>';

function store(key, val) {
  try { if (val === undefined) return Number(localStorage.getItem(key) || 0); localStorage.setItem(key, String(val)); } catch { return 0; }
  return val;
}

export function initOffline() {
  const toast = document.querySelector('.toast');
  const dialog = document.querySelector('dialog.game');
  if (!toast || !dialog) return;
  let toastTimer = 0;

  function showToast(html, { sticky = false } = {}) {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
    const play = toast.querySelector('[data-play]');
    if (play) play.addEventListener('click', () => { toast.hidden = true; openGame(); });
    const close = toast.querySelector('[data-close]');
    if (close) close.addEventListener('click', () => { toast.hidden = true; });
  }

  function onOffline(simulated) {
    showToast(`<span>${simulated ? 'ככה זה נראה כשהאינטרנט נופל:' : 'האינטרנט נפל.'} קורות החיים והמאמרים זמינים גם עכשיו. בינתיים, אפשר לדבג באג.</span>
      <button type="button" class="primary" data-play>לדבג באג</button><button type="button" data-close>סגירה</button>`, { sticky: true });
  }
  addEventListener('offline', () => onOffline(false));
  addEventListener('online', () => showToast('<span>חזרנו לאוויר.</span>'));
  const test = document.querySelector('[data-offline-test]');
  if (test) test.addEventListener('click', () => onOffline(true));

  // ── Game ──
  const list = dialog.querySelector('.game-code');
  const scoreEl = dialog.querySelector('[data-score]');
  const timeEl = dialog.querySelector('[data-time]');
  const bestEl = dialog.querySelector('[data-best]');
  const msg = dialog.querySelector('.game-msg');
  const startBtn = dialog.querySelector('[data-game-start]');
  list.innerHTML = CODE.map((l) => `<li tabindex="-1"><span>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></li>`).join('');
  const lines = [...list.children];
  let score = 0, timeLeft = 30, bugLine = -1, cursor = 0, tick = 0, spawnT = 0, running = false, lifetime = 1500;

  bestEl.textContent = store('bp-bug-best');

  function placeBug() {
    clearBug();
    let n;
    do { n = Math.floor(Math.random() * lines.length); } while (n === bugLine && lines.length > 1);
    bugLine = n;
    lines[n].insertAdjacentHTML('beforeend', BUG);
    clearTimeout(spawnT);
    spawnT = setTimeout(() => { if (running) { msg.textContent = 'ברח. הבא בתור:'; placeBug(); } }, lifetime);
  }
  function clearBug() {
    lines.forEach((l) => { const b = l.querySelector('.bug'); if (b) b.remove(); });
  }
  function squash(i) {
    if (!running) return;
    if (i === bugLine) {
      score++;
      scoreEl.textContent = score;
      lines[i].classList.add('is-squashed');
      setTimeout(() => lines[i].classList.remove('is-squashed'), 220);
      msg.textContent = ['נתפס.', 'עוד אחד.', 'ה-build ירוק.', 'יפה, בלי regression.'][score % 4];
      lifetime = Math.max(650, 1500 - score * 60);
      placeBug();
    } else {
      msg.textContent = 'השורה הזו תקינה. הבאג במקום אחר.';
    }
  }
  function setCursor(i) {
    cursor = (i + lines.length) % lines.length;
    lines.forEach((l, k) => l.classList.toggle('is-cursor', k === cursor));
    lines[cursor].focus();
  }
  lines.forEach((l, i) => l.addEventListener('click', () => { setCursor(i); squash(i); }));
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(cursor - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); squash(cursor); }
  });

  function start() {
    score = 0; timeLeft = 30; lifetime = 1500; running = true;
    scoreEl.textContent = '0'; timeEl.textContent = '30'; msg.textContent = 'קדימה.';
    startBtn.textContent = 'התחלה מחדש';
    setCursor(0);
    placeBug();
    clearInterval(tick);
    tick = setInterval(() => {
      timeLeft--;
      timeEl.textContent = timeLeft;
      if (timeLeft <= 0) end();
    }, 1000);
  }
  function end() {
    running = false;
    clearInterval(tick); clearTimeout(spawnT); clearBug();
    const best = store('bp-bug-best');
    if (score > best) { store('bp-bug-best', score); bestEl.textContent = score; }
    msg.textContent = score >= 15 ? `${score} באגים. אפשר לקבל אותך לצוות.` : score >= 7 ? `${score} באגים. ה-CI מרוצה.` : `${score} באגים. גם זה code review.`;
  }
  function openGame() {
    if (!dialog.open) dialog.showModal();
    startBtn.focus();
  }
  startBtn.addEventListener('click', start);
  dialog.querySelector('[data-game-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (running) end(); });
}
