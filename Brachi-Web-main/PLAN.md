# PLAN.md: brachi-web v2 implementation blueprint

Static site, with no build step. Vercel serves `Brachi-Web-main/` as is. Everything is vanilla ES modules, so there is zero framework runtime.

## §facts: Git-verified (audited 2026-11-02)
| Project | Repo | Verified facts used in copy |
|---|---|---|
| Multi-AI Dev Team | `BrachiA/Multi-AI` v3.5.3 | VS Code extension, TypeScript, **no runtime deps**; flexible roster (manager/coder/designers/reviewers across Anthropic, Gemini, OpenAI, xAI); 3-layer quota enforcement (`QuotaLedger` = layer 3, blocks the API call itself); Anthropic prompt caching on system prompt + tools + repeated context (`cache_control: ephemeral`); `loopGuard` normalises build output (timestamps, paths, hex) and stops identical-failure loops; `edit_file` surgical edits instead of overwrite; deterministic Hebrew model descriptions with no network (`modelAutoDescription.ts`); strict webview CSP with crypto nonce; role-based file isolation (`rolePolicy.ts`); flight recorder (`usage_unknown` events); process-tree kill on timeout; 64KB capped output; GitHub Actions CI; **579 passing tests** (PROGRESS.md, latest gate). |
| Benefits Wallet | `BrachiA/benefits-wallet` | 4 apps around one backend (React 18 + Vite RTL dashboard, Expo 54 RN mobile, Chrome MV3 extension, Node/Express/TS backend); Prisma 6 + PostgreSQL with `pg_trgm` fuzzy search; `BenefitScope` (row = AND, rows = OR), visibility rule in exactly one server place; scraper is config-driven (axios+cheerio), with robots.txt + rate limit + legal gate; confidence score with logarithmic penalty on abnormal value change, so a new benefit is never auto-published; Gemini for duplicate judgement/image check/categorisation, fails gracefully; HMAC-signed session; Zod everywhere; **136 tests in 15 files against a real Postgres**, with a guard that refuses DBs whose name lacks `test`; Cloudflare R2. |
| AssistIQ | `BrachiA/AssistIQ` | .NET 8 + ASP.NET Core; SignalR hub (`SuggestionHub`); browser audio goes to a **server-side WebSocket proxy** (`/ws/deepgram`), so the Deepgram key never reaches the browser, plus 30-second grant tokens; Grok (`grok-4-1-fast-non-reasoning`) streaming SSE; partial suggestions flushed to the client on a word boundary **or every 150ms**; per-connection conversation history (`ConcurrentDictionary`, sliding window of 30, locked); duplicate-transcript skip and **echo filter** (ignores the agent reading the suggestion aloud); human-approved learning loop (`ApproveSession` → summarise → `learned.txt`); Twilio outbound call; Chrome MV3 floating bubble (2,100+ lines of content script). |
| Yael Engel official | `BrachiA/yael-music-official` | Next.js 16 + React 19 + TS, Tailwind, Supabase (Postgres + Storage), admin panel, albums/performances/playbacks/studio pages; live at yael-music-official.com |
| ANGEL Diamond Jewelry | `BrachiA/angel-diamond-jewelry` | Next.js 16 + Tailwind 4, RTL black & gold; Supabase with RLS + `is_admin()`; `place_order()` in DB (server-computed prices & stock); Resend emails with Idempotency-Key; accessibility menu; admin panel. Payments are still in progress (do not claim them). |
| This site | `BrachiA/Brachi-Web` | v2 itself. |

**Not in Git → not claimed:** PostgreSQL/Redis/PII scrubbing/multi-tenancy/"<200ms" for AssistIQ; "143 tests" for Multi-AI (the real number is 579); "NadavAI" (the repo name is AssistIQ). The brief also lists `jewelry-shop`; the matching repo is `angel-diamond-jewelry`.

## File map
```
index.html                 shell: header, dial, 3 <section data-room> panels, footer
assets/css/site.css        tokens, base, dial, rooms, components, print
assets/js/main.js          boot: router, dial, lazy room init, offline, sw register
assets/js/router.js        hash ⇄ room state machine
assets/js/playground.js    demo engine (Pillar 1)
assets/js/video-wall.js    video engine (Pillar 2)
assets/js/media-manifest.js mediaConfig + aiVideos (the only file she edits to add videos)
assets/js/blurhash.js      tiny BlurHash decoder → canvas
assets/js/diagrams.js      3 interactive SVG diagrams (Pillar 3)
assets/js/cv.js            skills filter + print
assets/js/offline.js       offline detector + "דבג את הבאג" game
assets/img/*.webp          screenshots
demos/{sport,pizza,luxury,tech,clinic}.html   self-contained demo sites (own CSS/JS inline)
articles/{multi-ai,benefits-wallet,assistiq}.html  case studies (shared article.css)
assets/css/article.css
cv.html                    printable 1-page CV
sw.js                      service worker (offline cache)
404.html
```

## 1. Router: `router.js`
```ts
type Room = 'web' | 'ai-video' | 'engineering';
const ROOMS: Room[];
export function parseHash(hash: string): { room: Room; anchor?: string }
//   '#web' → web; '#engineering/cv' → engineering + anchor 'cv'; anything else → 'web'
export function createRouter(onChange: (room: Room, anchor?: string, cause: 'init'|'nav'|'pop') => void): {
  go(room: Room, anchor?: string): void;   // history.pushState + onChange('nav'); no-op if same room & no anchor
  current(): Room;
}
```
State machine: `IDLE → ACTIVE(room)`. Transitions come from dial click, tab click, `hashchange`/`popstate`, or deep links. The render step sets `body[data-room]` and toggles `hidden` on the three panels, which is 0ms. It calls `rooms[room].enter()` (lazy init, once) and `rooms[prev].leave()`, which pauses videos and unloads the demo iframe audio. On `'nav'` it scrolls to the top of the panel only if the dial is out of view. Focus moves to the panel heading (`tabindex=-1`) for screen readers, but not on `'init'`.

## 2. Dial: in `main.js`
- 3 plain `<a href="#room">` links with `aria-current="page"` (Checkpoint #1: links instead of tabs). Tab/Enter is the keyboard path, so there is no arrow-key handling.
- `IntersectionObserver` on the hero dial toggles `body.dial-compact` → sticky bar.

## 3. Playground: `playground.js`
```ts
interface DemoStyle { id: 'sport'|'pizza'|'luxury'|'tech'|'clinic'; name: string; fit: string; swatch: [string,string,string]; src: string }
export function initPlayground(root: HTMLElement, opts: { onChoose(style: DemoStyle): void }): { leave(): void }
```
- A single `<iframe>` (sandbox `allow-scripts allow-same-origin`, `loading=lazy`) gets its `src` swapped on selection. A `load` handler cross-fades it. The previous src is blanked on `leave()`.
- Viewport toggle: the frame width is `100%` (desktop) or `390px` (mobile). On narrow screens "מחשב" renders a 1280px-wide iframe scaled with `transform: scale(w/1280)` and the frame height adjusted, so the demo's own media queries fire correctly.
- CTA: each demo calls `parent.postMessage({type:'bp:choose-style', id}, location.origin)`. The parent checks `event.origin === location.origin && event.source === iframe.contentWindow`, then prefills the contact form's `style` field, sets the WhatsApp link text, switches to `#web/contact`, and focuses the name field. The same CTA also exists below the frame (keyboard users, and in case the iframe is blocked).
- Demo fonts are loaded inside each demo, so the main page never downloads them.

## 4. Video wall: `video-wall.js`
```ts
interface AiVideo { id: string; title: string; category: 'reel'|'story'|'deck'; tool: 'Kling AI'|'Google Flow'|'Runway'|string;
  src?: string; cloudinaryId?: string; poster?: string; blurhash?: string; durationSec?: number }
interface MediaConfig { cloudinaryCloud?: string; r2Base?: string }
export function videoUrl(v: AiVideo, cfg: MediaConfig): string | null  // f_auto,q_auto,vc_auto / r2Base+src / src
export function posterUrl(v: AiVideo, cfg: MediaConfig): string | null // so_0,f_auto,q_auto,w_360 .jpg
export function initVideoWall(root: HTMLElement, list: AiVideo[], cfg: MediaConfig): { leave(): void; enter(): void }
```
- Every `<video muted loop playsinline preload="none" disablepictureinpicture>`. `src` is **not set** until the card first becomes eligible to play (`data-src`), so zero video bytes are downloaded at load.
- Poster pipeline: BlurHash → 32×57 canvas, painted immediately with no network. The `poster` `<img decoding=async fetchpriority=low>` fades over it on `load`.
- **PlaybackController** (single instance):
  - `cap = matchMedia('(max-width: 760px)').matches ? 3 : 6`, recomputed on resize.
  - IO threshold `[0, .6]`, root = the horizontal river. A card is "eligible" when ratio ≥ .6 **and** the room is active **and** the document is visible.
  - The playing set is ordered by visible ratio. When eligible exceeds cap, the lowest ratio gets paused.
  - `play()` promise rejection (autoplay blocked) → mark the card `needs-tap` and show a play button. It never retries in a loop.
  - **Race guard:** each card has a `token` that increments on every intent change. Async `play()` resolution checks the token and pauses if it is stale.
  - **Slow network:** `navigator.connection.saveData` or `effectiveType ∈ {slow-2g, 2g}` → autoplay is off, and posters plus a tap-to-play button are shown. On a `change` event it re-evaluates.
  - `waiting` longer than 2.5s → shimmer + spinner state. `error` → the card shows "הסרטון לא נטען" + retry (resets src once).
  - `prefers-reduced-motion` → no autoplay.
- Hover/focus: scale 1.04, badge (tool + category), and buttons for mute/unmute (only one card unmuted at a time) and fullscreen.
- Lightbox: `<dialog>` with a large video that has `controls` and sound, opened FLIP-style from the card rect. Esc/close restores focus. Wall playback is paused while it is open.
- Empty manifest entries (no `src`/`cloudinaryId`) render as a **"בהכנה"** phone with the category, and they are never sent to the controller. *Honesty rule: no stock footage presented as her work.*

## 5. Diagrams: `diagrams.js`
```ts
export function mountDiagram(el: SVGSVGElement | HTMLElement, kind: 'multi-ai'|'wallet'|'assistiq'): { destroy(): void }
```
- Inline SVG built from a node/edge spec `{nodes:[{id,x,y,label,detail}], edges:[[from,to,label]]}`, with `viewBox` scaled responsively. On mobile (<640px) a vertical layout spec is used, not a squashed one.
- Nodes are `<button>`-like `<g role="button" tabindex=0>`. Hover/focus/tap highlights connected edges, runs a dash-offset packet along each edge, and fills a caption region (`aria-live=polite`) with the node's `detail`.
- Multi-AI: Manager → Coder → Reviewer(s)/Designer loop; side panel: quota layers 1/2/3 with a meter where tapping "הרץ סבב" increments and layer 3 blocks at the limit; loopGuard: same normalised error twice → stop.
- Wallet: 3 clients → backend → Postgres/pg_trgm, Gemini, R2; scraper → confidence gate → review queue; typing into a mini search box demonstrates trigram tolerance (client-side trigram similarity over a small Hebrew list).
- AssistIQ: mic → WS proxy → Deepgram → SignalR hub → Grok stream → bubble; an animated waveform (canvas, rAF only while visible) and a token stream that flushes on a word boundary or at 150ms, so the flush rule is visible.
- rAF loops run only while the diagram is intersecting and the room is active.

## 6. Articles: `articles/*.html`
Each article has 4 chapters (the challenge; architecture & data flow; trade-offs & edge cases; tests, security, results), reading time computed in JS (words / 200), a TOC built from `h2` with scroll-spy (IO), an inline SVG figure, and real code excerpts adapted from the repo. They are standalone pages so they work offline (SW) and can be linked directly.

## 7. CV: `cv.js` + `cv.html`
Skills matrix chips filter rows across 5 domains (`aria-pressed`). The timeline is an `<ol>` (chronological). "הדפיסו קורות חיים" opens `cv.html`, an A4 print layout with `@page` margins that auto-calls `print()` only when `?print=1`.

## 8. Offline: `offline.js` + `sw.js`
- SW: precache the shell, CSS, JS, `cv.html`, 3 articles, and fonts (runtime cache, stale-while-revalidate). Navigation requests are network-first with a 3s timeout, falling back to cache. Video is **never** cached. The cache version is bumped by a constant.
- `window` `offline` → a non-blocking toast "האינטרנט נפל. קורות החיים והמאמרים זמינים גם עכשיו. בינתיים: דבגו באג?" with buttons. `online` → toast "חזרנו לאוויר".
- Footer button "בדקו מה קורה כשהאינטרנט נופל ⚡" simulates the same state.
- Game "דבג את הבאג": a `<dialog>` with a 9-line code snippet. Bugs (🐞 SVG) appear on random lines for a decreasing time window. Tap or Enter to squash. 30 seconds, score, best score in localStorage (try/catch). The keyboard lets you move between lines with arrows. Respects reduced motion (static rounds).

## 9. Performance budget
- First load is HTML + CSS + main.js ≤ 90KB gzip, plus 2 font families (Hebrew subset via Google Fonts `display=swap`, preconnect).
- Rooms initialise lazily on first `enter()`. Demos and articles are separate documents.
- Images have explicit width/height or aspect-ratio, so CLS is 0.

## 10. Edge cases checklist
- Hash for a removed/unknown room → web. Anchors inside rooms (`#engineering/cv`) scroll after render.
- iframe `postMessage` from a foreign origin is ignored.
- Two rapid room switches during `play()` → the token guard handles it.
- iOS: `playsinline` + `muted` are required for autoplay, and fullscreen falls back to the lightbox (no `requestFullscreen` on iPhone).
- RTL: use logical properties only (`margin-inline-start`, `inset-inline-end`). Horizontal scrollers have `dir=rtl`, so the first card is on the right. Arrow keys are mirrored.
- Breakpoint check at 360 / 390 / 768 / 1024 / 1440.

## Checkpoint #2 revisions (independent reviewer), as implemented
- **Router:** a single render path through `hashchange` (no pushState), with cause `init | nav | pop`. Panel ids are `room-*`, so the browser never jumps to them natively. Anchors scroll in rAF after the panel is un-hidden. Focus moves only on keyboard navigation.
- **Video:** `AbortError` from `play()` is ignored, `muted` is set as an attribute too, and the mobile cap is 2 on devices with ≤4 cores. IO root is the viewport (river clipping is respected). `pagehide`/`visibilitychange` pause everything, and `leave()` releases decoders (`removeAttribute('src'); load()`). Entries without a resolvable URL become "בהכנה" and never create a `<video>`.
- **Playground:** no sandbox attribute (first-party, same origin). The message handler checks `event.source === iframe.contentWindow` and the origin, and validates the id against an allow-list. The iframe navigates with `location.replace`, so it adds no history entries and "back" stays on the page. The scale factor is measured from the stage, not the frame, to avoid a circular width.
- **SW:** `skipWaiting` + `clients.claim`, `Cache-Control: no-cache` on `/sw.js` (vercel.json), per-file `allSettled` precache, no opaque/206/range/video caching, runtime LRU of 40 entries, and an offline navigation fallback to `/404.html`.
- **Compact bar** uses a fixed-size sentinel at the end of the dial with `rootMargin -56px`, so there is no flicker. `overflow-x: clip` instead of `hidden`, so sticky works on iOS.
