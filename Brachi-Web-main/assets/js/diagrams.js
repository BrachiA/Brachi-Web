// Three interactive architecture diagrams. Plain SVG, with no library.
// Tap, hover, or focus a node to light up its edges and show an explanation.
// Packet animation is in CSS. The only rAF loop is the AssistIQ waveform, and it runs only while visible.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const h = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (html) n.innerHTML = html;
  return n;
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrowMq = matchMedia('(max-width: 640px)');

// ── Engine ──────────────────────────────────────────────────────────────
function anchor(n, toward) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const tx = toward.x + toward.w / 2, ty = toward.y + toward.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) * n.h > Math.abs(dy) * n.w) return [dx > 0 ? n.x + n.w : n.x, cy];
  return [cx, dy > 0 ? n.y + n.h : n.y];
}

function drawGraph(host, spec, caption) {
  const svg = el('svg', { viewBox: `0 0 ${spec.w} ${spec.h}`, role: 'group', 'aria-label': spec.label });
  el('title', {}, svg).textContent = spec.label;
  const gEdges = el('g', {}, svg);
  const gNodes = el('g', {}, svg);
  const byId = Object.fromEntries(spec.nodes.map((n) => [n.id, n]));
  const edges = spec.edges.map(([a, b, label]) => {
    const A = byId[a], B = byId[b];
    const [x1, y1] = anchor(A, B), [x2, y2] = anchor(B, A);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const horiz = Math.abs(x2 - x1) > Math.abs(y2 - y1);
    const d = horiz ? `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
    const path = el('path', { d, class: 'dg-edge', 'marker-end': 'url(#arrow-' + spec.key + ')' }, gEdges);
    el('path', { d, class: 'dg-packet' }, gEdges);
    if (label) {
      const t = el('text', { x: mx, y: my - 6, 'text-anchor': 'middle', class: 'dg-label' }, gEdges);
      t.textContent = label;
    }
    return { a, b, path };
  });
  const defs = el('defs', {}, svg);
  const m = el('marker', { id: 'arrow-' + spec.key, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'rgb(19 37 43 / .5)' }, m);

  const nodes = spec.nodes.map((n) => {
    const g = el('g', { class: 'dg-node', tabindex: 0, role: 'button', 'aria-label': `${n.label}: ${n.detail.replace(/<[^>]+>/g, '')}` }, gNodes);
    if (n.shape === 'circle') el('circle', { cx: n.x + n.w / 2, cy: n.y + n.h / 2, r: n.w / 2 }, g);
    else el('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: n.rx ?? 6 }, g);
    const t = el('text', { x: n.x + n.w / 2, y: n.y + n.h / 2 + (n.sub ? -4 : 5), 'text-anchor': 'middle' }, g);
    t.textContent = n.label;
    if (/^[\x00-\x7F]+$/.test(n.label)) { t.setAttribute('direction', 'ltr'); t.style.unicodeBidi = 'plaintext'; }
    if (n.sub) { const s = el('text', { x: n.x + n.w / 2, y: n.y + n.h / 2 + 14, 'text-anchor': 'middle', class: 'dg-sub' }, g); s.textContent = n.sub; }
    const activate = () => select(n.id);
    g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') activate(); });
    g.addEventListener('click', activate);
    g.addEventListener('focus', activate);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    return { id: n.id, g };
  });

  function select(id) {
    for (const n of nodes) n.g.classList.toggle('is-active', n.id === id);
    for (const e of edges) e.path.classList.toggle('is-hot', e.a === id || e.b === id);
    caption.innerHTML = `<b>${byId[id].label}.</b> ${byId[id].detail}`;
  }
  if (spec.hint) {
    const t = el('text', { x: spec.w - 8, y: spec.h - 8, 'text-anchor': 'end', class: 'dg-hint' }, svg);
    t.textContent = spec.hint;
  }
  host.appendChild(svg);
  caption.textContent = spec.intro;
  return { svg, select };
}

// ── Multi-AI ────────────────────────────────────────────────────────────
function multiAiSpec(narrow) {
  const N = (id, x, y, w, h, label, sub, detail) => ({ id, x, y, w, h, label, sub, detail });
  const nodes = narrow ? [
    N('user', 110, 10, 140, 54, 'אתם', 'דרישה + אישור', ''),
    N('orch', 70, 104, 220, 62, 'Orchestrator', 'בתוך VS Code', ''),
    N('mgr', 10, 214, 160, 56, 'מנהל', 'Anthropic', ''),
    N('coder', 190, 214, 160, 56, 'מתכנת', 'OpenAI / Gemini', ''),
    N('rev', 10, 322, 160, 56, 'מבקרים', 'QA, אבטחה', ''),
    N('des', 190, 322, 160, 56, 'מעצב', 'אופציונלי', ''),
    N('fs', 70, 430, 220, 56, 'תיקיית הפרויקט', 'edit_file / run_build', ''),
  ] : [
    N('user', 30, 170, 130, 60, 'אתם', 'דרישה + אישור', ''),
    N('orch', 230, 160, 200, 80, 'Orchestrator', 'בתוך VS Code', ''),
    N('mgr', 520, 40, 170, 60, 'מנהל', 'Anthropic', ''),
    N('coder', 520, 170, 170, 60, 'מתכנת', 'OpenAI / Gemini', ''),
    N('rev', 520, 300, 170, 60, 'מבקרים', 'QA, אבטחה', ''),
    N('des', 760, 40, 170, 60, 'מעצב', 'אופציונלי', ''),
    N('fs', 760, 240, 170, 80, 'תיקיית הפרויקט', 'edit_file / run_build', ''),
  ];
  const D = {
    user: 'אתם מתארים מה לבנות ומאשרים את מסמך האיפיון. מכאן הצוות עובד לבד, ואתם רואים כל צעד בלוח.',
    orch: 'מריץ את ה-Pipeline: איפיון, קוד, ביקורת ותיקון. הוא סופר כל קריאה ל-API ב-<code>QuotaLedger</code>, וכשמכסה נגמרת הקריאה פשוט לא יוצאת.',
    mgr: 'מודל ההנהלה כותב את האיפיון ומבקר קוד. ה-system prompt והכלים מסומנים ב-<code>cache_control</code>, כך שהם נקראים מהמטמון של Anthropic בין תורות ולא מעובדים מחדש.',
    coder: 'כותב קוד דרך כלים. קובץ קיים משתנה ב-<code>edit_file</code>, בלוק אחד בכל פעם, ולא נדרס כולו ב-<code>write_file</code>.',
    rev: 'כל מבקר עם תחום משלו (QA, אבטחה, ביצועים). מבקר משני שנופל מקבל retry ברקע והתהליך ממשיך. ל-<code>tests/hidden</code> אין לו גישה.',
    des: 'חבר צוות אופציונלי. אם אין מעצב, שלב ביקורת העיצוב פשוט לא קורה, וזה לא נחשב כשל.',
    fs: 'הקבצים נכתבים ישירות לפרויקט. <code>run_build</code> הורג את כל עץ התהליכים כשיש timeout, ומגביל פלט ל-64KB.',
  };
  nodes.forEach((n) => { n.detail = D[n.id]; });
  return {
    key: 'mai', w: narrow ? 360 : 960, h: narrow ? 500 : 400, nodes,
    label: 'זרימת עבודה: אתם, Orchestrator, מנהל, מתכנת, מבקרים, מעצב ותיקיית הפרויקט',
    edges: [['user', 'orch', 'איפיון'], ['orch', 'mgr'], ['orch', 'coder'], ['orch', 'rev'], ['mgr', 'des'], ['coder', 'fs', narrow ? '' : 'edit_file'], ['rev', 'coder', narrow ? '' : 'הערות']],
    intro: 'הקישו על רכיב בתרשים כדי לראות מה הוא עושה ועם מי הוא מדבר.',
  };
}

function multiAiExtras(host) {
  const LIMIT = 3, LOOP = 3;
  const box = h('div', { class: 'dg-html dg-mai' });
  box.innerHTML = `
    <div class="dg-row">
      <p><b>אכיפת מכסה בשלוש שכבות.</b> סבבי ביקורת קוד: <span data-q>0</span>/${LIMIT}</p>
      <svg viewBox="0 0 300 14" class="dg-meter-svg" aria-hidden="true"><rect class="dg-meter-bg" width="300" height="14" rx="7"/><rect class="dg-meter" width="0" height="14" rx="7"/></svg>
      <ol class="dg-layers">
        <li>שכבה 1: המודל סופר בעצמו כמה סבבים נשארו.</li>
        <li>שכבה 2: המנהל מורה לעצור כשהמכסה קרובה.</li>
        <li>שכבה 3: <code>QuotaLedger</code> בקוד חוסם את הקריאה ל-API עצמה.</li>
      </ol>
      <button type="button" class="btn btn-line" data-round>הריצו סבב ביקורת</button>
      <p class="dg-out" data-q-out aria-live="polite"></p>
    </div>
    <div class="dg-row">
      <p><b>loopGuard.</b> אותה שגיאת build, אחרי נרמול של חותמות זמן, נתיבים וכתובות הקס, ${LOOP} פעמים ברצף, עוצרת את הלולאה.</p>
      <button type="button" class="btn btn-line" data-loop>שלחו את אותה שגיאה שוב</button>
      <pre class="dg-sig" dir="ltr" data-sig></pre>
    </div>`;
  host.appendChild(box);
  let used = 0, loops = 0;
  const meter = box.querySelector('.dg-meter');
  const out = box.querySelector('[data-q-out]');
  box.querySelector('[data-round]').addEventListener('click', (e) => {
    if (used >= LIMIT) { used = 0; meter.classList.remove('is-full'); e.target.textContent = 'הריצו סבב ביקורת'; out.textContent = 'המונה אופס. פרויקט חדש, מכסה חדשה.'; }
    else {
      used++;
      out.textContent = used < LIMIT ? `סבב ${used} עבר. הקריאה יצאה ל-API.` : `מכסת סבבי ביקורת קוד מוצתה (${used}/${LIMIT}). ה-Orchestrator חוסם קריאה נוספת, והיא לא יוצאת לרשת.`;
      if (used >= LIMIT) { meter.classList.add('is-full'); e.target.textContent = 'איפוס'; }
    }
    box.querySelector('[data-q]').textContent = used;
    meter.setAttribute('width', String((used / LIMIT) * 300));
  });
  const sig = box.querySelector('[data-sig]');
  const raw = () => {
    const t = new Date(Date.now() + loops * 7342).toISOString();
    const dir = ['/tmp/run-a81f/', '/tmp/run-c03e/', '/tmp/run-77d1/'][loops % 3];
    return `${t} error TS2345 at ${dir}src/cart.ts(42,7) 0x7ffa1b${(loops * 4111).toString(16)}`;
  };
  const norm = (s) => s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TIME>').replace(/(?:\/[\w.-]+)+\/(?=[\w.-]+\()/g, '<PATH>/').replace(/0x[0-9a-f]+/gi, '<HEX>');
  box.querySelector('[data-loop]').addEventListener('click', (e) => {
    if (loops >= LOOP) { loops = 0; e.target.textContent = 'שלחו את אותה שגיאה שוב'; sig.textContent = ''; return; }
    loops++;
    const r = raw();
    sig.textContent = `raw:  ${r}\nnorm: ${norm(r)}\ncount: ${loops}/${LOOP}${loops >= LOOP ? '  → looping: true, עוצרים ומדווחים' : ''}`;
    if (loops >= LOOP) e.target.textContent = 'התחילו מחדש';
  });
}

// ── Benefits Wallet ─────────────────────────────────────────────────────
function walletSpec(narrow) {
  const N = (id, x, y, w, h, label, sub) => ({ id, x, y, w, h, label, sub });
  const nodes = narrow ? [
    N('web', 6, 10, 110, 58, 'דשבורד', 'React 18 RTL'),
    N('mob', 125, 10, 110, 58, 'מובייל', 'Expo 54'),
    N('ext', 244, 10, 110, 58, 'תוסף', 'Chrome MV3'),
    N('api', 70, 120, 220, 66, 'Backend', 'Express + TS'),
    N('db', 10, 240, 160, 58, 'PostgreSQL', 'Prisma, pg_trgm'),
    N('ai', 190, 240, 160, 58, 'Gemini', 'נכשל בעדינות'),
    N('scr', 10, 350, 160, 58, 'סורק', 'robots.txt'),
    N('gate', 190, 350, 160, 58, 'ציון ביטחון', 'תור בדיקה'),
    N('r2', 110, 450, 140, 46, 'Cloudflare R2', ''),
  ] : [
    N('web', 20, 30, 170, 60, 'דשבורד ניהול', 'React 18, RTL'),
    N('mob', 20, 170, 170, 60, 'אפליקציית מובייל', 'Expo 54, קריאה בלבד'),
    N('ext', 20, 310, 170, 60, 'תוסף Chrome', 'MV3, הזנה ידנית'),
    N('api', 320, 150, 210, 100, 'Backend', 'Express, TypeScript, Zod'),
    N('db', 660, 40, 190, 64, 'PostgreSQL', 'Prisma 6, pg_trgm'),
    N('ai', 660, 168, 190, 64, 'Gemini', 'כפילויות וקטגוריות'),
    N('r2', 660, 296, 190, 56, 'Cloudflare R2', 'תמונות'),
    N('scr', 320, 320, 130, 60, 'סורק', 'robots.txt'),
    N('gate', 470, 320, 150, 60, 'ציון ביטחון', 'סף פרסום'),
  ];
  const D = {
    web: 'ניהול הקטלוג ותור הבדיקה, בעברית מלאה. הכניסה מוגנת ב-session חתום ב-HMAC, בלי טבלת משתמשים מיותרת.',
    mob: 'האפליקציה שהלקוח מחזיק. הבחירות שלו (כרטיסים ומועדונים) נשמרות רק על המכשיר, ובשרת לא נשמר שום מידע אישי.',
    ext: 'מנהל שגולש באתר של מועדון יכול לשלוח הטבה למערכת בלחיצה אחת. היא נכנסת לאותו תור בדיקה כמו הסורק.',
    api: 'מקור האמת היחיד. כלל הנראות של הטבה (<code>BenefitScope</code>: שורה אחת = AND, כמה שורות = OR) ממומש במקום אחד בשרת, כך ששני מסכים לא יכולים לחלוק עליו.',
    db: 'חיפוש מטושטש עם <code>pg_trgm</code>: שגיאת כתיב עדיין מוצאת תוצאה. אם הסינון מסיר את רוב המועמדים, השרת שולף עמוד נוסף כדי לא להחזיר עמוד ריק.',
    ai: 'שופט כפילויות סמנטיות, מאמת תמונות ומסווג. בלי מפתח, השלב פשוט מדולג והמערכת ממשיכה. בבדיקות אין קריאות רשת אמיתיות.',
    scr: 'סורק מונחה-קונפיגורציה (axios + cheerio). הוא בודק robots.txt לפני כל עמוד, מחכה בין בקשות, וכשל של עמוד אחד לא מפיל ריצה שלמה.',
    gate: 'שינוי חריג בערך ההנחה (פי 9, למשל) מוריד את הציון בצורה לוגריתמית. הטבה חדשה לא מתפרסמת אוטומטית לעולם, אלא עוברת לתור בדיקה אנושי.',
    r2: 'אחסון תמונות תואם S3. התמונות לא נשמרות בשרת ולא במסד.',
  };
  nodes.forEach((n) => { n.detail = D[n.id]; });
  return {
    key: 'bw', w: narrow ? 360 : 880, h: narrow ? 506 : 400, nodes,
    label: 'ארבעה לקוחות מול שרת אחד: דשבורד, מובייל, תוסף, Backend, PostgreSQL, Gemini, R2, סורק ושער ציון ביטחון',
    edges: [['web', 'api'], ['mob', 'api'], ['ext', 'api'], ['api', 'db'], ['api', 'ai'], ['api', 'r2'], ['scr', 'gate'], ['gate', 'api', narrow ? '' : 'מעל הסף']],
    intro: 'הקישו על רכיב. כל החצים מגיעים לשרת אחד, וזו בדיוק הנקודה.',
  };
}

// pg_trgm similarity, implemented in JS: words padded with spaces, trigram sets, |A∩B| / |A∪B|
function trigrams(s) {
  const set = new Set();
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const p = '  ' + w + ' ';
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
  }
  return set;
}
export function similarity(a, b) {
  const A = trigrams(a), B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function walletExtras(host) {
  const brands = ['פוקס', 'קסטרו', 'סופר-פארם', 'שופרסל', 'רמי לוי', 'איקאה', 'אמריקן איגל', 'גולף', 'נעמן', 'הום סנטר', 'מקדונלדס', 'ארומה', 'יס פלאנט', 'סינמה סיטי', 'לגו'];
  const box = h('div', { class: 'dg-html' });
  box.innerHTML = `
    <label for="bw-q"><b>נסו בעצמכם:</b> הקלידו שם של רשת, עם שגיאת כתיב. למשל "קסטריו" או "סופר פרם".</label>
    <input id="bw-q" class="dg-search" type="search" autocomplete="off" placeholder="חיפוש רשת" enterkeyhint="search">
    <ul class="dg-results" aria-live="polite"></ul>`;
  host.appendChild(box);
  const input = box.querySelector('input'), out = box.querySelector('ul');
  const run = () => {
    const q = input.value.trim();
    if (!q) { out.innerHTML = ''; return; }
    const res = brands.map((b) => ({ b, s: Math.max(similarity(b, q), b.includes(q) ? 1 : 0) }))
      .filter((r) => r.s >= 0.15).sort((x, y) => y.s - x.s).slice(0, 5);
    out.innerHTML = res.length
      ? res.map((r) => `<li><b>${r.b}</b> (דמיון ${r.s.toFixed(2)})</li>`).join('')
      : '<li>אין תוצאה מעל סף הדמיון 0.15. זה הסף שקבעתי במערכת, אחרי שברירת המחדל של pg_trgm (0.3) פספסה שגיאות כתיב.</li>';
  };
  input.addEventListener('input', run);
}

// ── AssistIQ ────────────────────────────────────────────────────────────
function assistSpec(narrow) {
  const N = (id, x, y, w, h, label, sub) => ({ id, x, y, w, h, label, sub });
  const nodes = narrow ? [
    N('mic', 100, 6, 160, 54, 'מיקרופון', 'בועה בדפדפן'),
    N('proxy', 100, 96, 160, 54, '/ws/deepgram', 'proxy בשרת'),
    N('dg', 100, 186, 160, 54, 'Deepgram', 'תמלול חי'),
    N('hub', 100, 276, 160, 54, 'SuggestionHub', 'SignalR'),
    N('llm', 100, 366, 160, 54, 'Grok', 'stream=true'),
    N('agent', 100, 456, 160, 54, 'הצעה לנציג', 'בועה צפה'),
  ] : [
    N('mic', 10, 150, 130, 64, 'מיקרופון', 'בועה בדפדפן'),
    N('proxy', 175, 150, 150, 64, '/ws/deepgram', 'proxy בשרת .NET 8'),
    N('dg', 360, 40, 140, 60, 'Deepgram', 'תמלול חי'),
    N('hub', 360, 230, 160, 64, 'SuggestionHub', 'SignalR'),
    N('llm', 560, 230, 150, 64, 'Grok', 'stream=true'),
    N('learn', 560, 330, 150, 52, 'learned.txt', 'אחרי אישור'),
    N('agent', 760, 150, 170, 64, 'הצעה לנציג', 'בועה צפה'),
  ];
  const D = {
    mic: 'תוסף Chrome (MV3) מציג בועה שנשארת מעל כל אתר. הוא לוכד את האודיו ושולח אותו לשרת.',
    proxy: 'הדפדפן מתחבר לשרת, והשרת מתחבר ל-Deepgram עם header של Authorization. מפתח ה-API אף פעם לא מגיע לדפדפן. לדפדפן יש גם אפשרות לקבל grant token שתקף ל-30 שניות.',
    dg: 'תמלול סטרימינג. התוצאה חוזרת דרך אותו WebSocket.',
    hub: 'ה-Hub מקבל תמלול, מדלג על שורה כפולה, ומסנן "הד": אם הנציג מקריא את ההצעה בקול, היא לא נשלחת שוב למודל. לכל חיבור יש היסטוריה משלו, חלון של 30 הודעות תחת lock.',
    llm: 'תשובה בסטרימינג (SSE). הטוקנים נאספים ונשלחים לנציג בסוף כל מילה או סימן פיסוק, או אחרי 150ms לכל המאוחר.',
    learn: 'אחרי שהנציג מאשר את השיחה, המודל מסכם אותה ומוסיף את הדפוסים ל-learned.txt. השיחה הבאה כבר מתחילה איתם.',
    agent: 'הנציג רואה את ההצעה נבנית מילה אחרי מילה, ולא מחכה לתשובה שלמה.',
  };
  nodes.forEach((n) => { n.detail = D[n.id]; });
  const edges = [['mic', 'proxy', narrow ? '' : 'אודיו'], ['proxy', 'dg'], ['dg', 'hub', narrow ? '' : 'תמלול'], ['hub', 'llm'], ['llm', 'agent', narrow ? '' : 'טוקנים']];
  if (!narrow) edges.push(['llm', 'learn']);
  return {
    key: 'aiq', w: narrow ? 360 : 940, h: narrow ? 516 : 392, nodes, edges,
    label: 'הצינור של AssistIQ: מיקרופון, proxy, Deepgram, SignalR Hub, Grok וההצעה לנציג',
    intro: 'הקישו על רכיב, או הפעילו את ההדגמה למטה כדי לראות את כלל ה-flush בפעולה.',
  };
}

function assistExtras(host, visibleRef) {
  const box = h('div', { class: 'dg-html dg-aiq' });
  box.innerHTML = `
    <canvas class="dg-wave" height="60" aria-hidden="true"></canvas>
    <div class="dg-stream-row">
      <button type="button" class="btn btn-line" data-stream>הפעילו הדגמה</button>
      <p class="dg-stream-meta" aria-live="polite"></p>
    </div>
    <p class="dg-stream" lang="he"></p>`;
  host.appendChild(box);
  const canvas = box.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const out = box.querySelector('.dg-stream');
  const meta = box.querySelector('.dg-stream-meta');
  const btn = box.querySelector('[data-stream]');
  let raf = 0, t0 = performance.now(), speaking = false;

  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth || 600;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(60 * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(size).observe(canvas);
  size();

  function frame(now) {
    raf = 0;
    const w = canvas.clientWidth, H = 60;
    ctx.clearRect(0, 0, w, H);
    const bars = Math.floor(w / 6);
    const amp = speaking ? 1 : 0.18;
    ctx.fillStyle = '#156A58';
    for (let i = 0; i < bars; i++) {
      const x = i * 6;
      const v = Math.abs(Math.sin((now - t0) / 260 + i * 0.37) * Math.sin(i * 0.11 + (now - t0) / 900));
      const bh = Math.max(2, v * amp * (H - 8));
      ctx.fillRect(w - x - 3, (H - bh) / 2, 3, bh);
    }
    if (visibleRef.on && !reduced()) raf = requestAnimationFrame(frame);
  }

  const sentence = 'אני מבינה שהחבילה לא הגיעה. אני בודקת עכשיו את מספר המשלוח ושולחת לך עדכון ב-SMS תוך חמש דקות.';
  let timer = 0;
  function runStream() {
    clearTimeout(timer);
    out.textContent = '';
    speaking = true;
    // Split into "tokens" roughly the way a model streams: pieces of words
    const tokens = sentence.match(/.{1,3}/gu);
    let i = 0, pending = '', full = '', lastSent = performance.now(), flushes = 0;
    const step = () => {
      if (i >= tokens.length) {
        if (pending) { out.textContent = full; flushes++; }
        speaking = false;
        meta.textContent = `${tokens.length} טוקנים, ${flushes} שליחות לנציג.`;
        btn.textContent = 'הפעילו שוב';
        return;
      }
      const tok = tokens[i++];
      full += tok; pending += tok;
      const boundary = /[ ,.?!:]$/.test(tok);
      const timedOut = performance.now() - lastSent > 150;
      if (boundary || timedOut) {
        out.textContent = full; pending = ''; lastSent = performance.now(); flushes++;
        meta.textContent = boundary ? 'שליחה: סוף מילה' : 'שליחה: עברו 150ms';
      }
      timer = setTimeout(step, 35 + Math.random() * 70);
    };
    step();
    if (!raf && !reduced()) raf = requestAnimationFrame(frame);
  }
  btn.addEventListener('click', runStream);

  return {
    start() { if (!raf && !reduced()) raf = requestAnimationFrame(frame); else if (reduced()) frame(performance.now()); },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (speaking) { out.textContent = ''; meta.textContent = 'ההדגמה נעצרה כשגללתם הלאה.'; btn.textContent = 'הפעילו הדגמה'; }
      clearTimeout(timer); speaking = false;
    },
  };
}

// ── Mounting ────────────────────────────────────────────────────────────
const SPECS = { 'multi-ai': multiAiSpec, wallet: walletSpec, assistiq: assistSpec };

export function mountDiagrams(root) {
  const hosts = [...root.querySelectorAll('[data-diagram]')];
  let roomActive = false;
  const anims = [];

  function build(host) {
    const kind = host.dataset.diagram;
    const caption = host.parentElement.querySelector('.diagram-caption');
    const old = host.__anim;
    if (old) { old.stop(); anims.splice(anims.indexOf(old), 1); }
    host.innerHTML = '';
    drawGraph(host, SPECS[kind](narrowMq.matches), caption);
    if (kind === 'multi-ai') multiAiExtras(host);
    if (kind === 'wallet') walletExtras(host);
    if (kind === 'assistiq') {
      const ref = { on: false };
      const a = assistExtras(host, ref);
      a.ref = ref;
      host.__anim = a;
      anims.push(a);
      a.ref.on = roomActive && host.__visible;
      if (a.ref.on) a.start();
    }
  }
  hosts.forEach(build);
  narrowMq.addEventListener('change', () => hosts.forEach(build));

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      e.target.__visible = e.isIntersecting;
      const a = e.target.__anim;
      if (!a) continue;
      a.ref.on = roomActive && e.isIntersecting && document.visibilityState === 'visible';
      if (a.ref.on) a.start(); else a.stop();
    }
  });
  hosts.forEach((h) => io.observe(h));
  const sync = () => {
    for (const h of hosts) {
      const a = h.__anim; if (!a) continue;
      a.ref.on = roomActive && !!h.__visible && document.visibilityState === 'visible';
      if (a.ref.on) a.start(); else a.stop();
    }
  };
  document.addEventListener('visibilitychange', sync);
  addEventListener('pagehide', () => anims.forEach((a) => a.stop()));

  return {
    enter() { roomActive = true; sync(); },
    leave() { roomActive = false; sync(); },
  };
}
