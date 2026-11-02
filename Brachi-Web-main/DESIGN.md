# DESIGN.md: brachi-web v2

## Subject, audience, primary job
- **Subject:** Brachi Pitosi (Engel). She runs a one-person studio with three crafts: custom websites for businesses, short AI videos, and production-grade systems engineering.
- **Audiences:** (a) a small-business owner on a phone, deciding within 10 seconds whether to message on WhatsApp; (b) a tech recruiter or hiring lead on a laptop, deciding whether the engineering is real.
- **Primary job:** let each audience reach its own room in one tap, and let the work itself prove the claim. That means a demo you can play with, a video you can watch, and a diagram you can poke.

## Concept: "Three rooms, one sentence"
The whole site is one Hebrew sentence that the visitor completes:

> **אני בונה** ‹אתרים› / ‹סרטונים› / ‹מערכות›

The three words are the navigation. They are huge display type that you click or tap. The chosen word expands to full ink. The other two collapse into outlined type, and the page below swaps instantly (0ms, no fade) to that room. This is the one bold move on the page. Everything else stays quiet, typographic, and disciplined.

Each room has its own **lighting** (one accent and one surface), but the same type, grid, and voice:

| Room | Hash | Surface | Accent | Character |
|---|---|---|---|---|
| אתרים | `#web` | porcelain | cobalt | workshop: bright, practical, "try it yourself" |
| סרטונים | `#ai-video` | pine-dark (screening room) | film-amber | cinema: dim lights, phones glowing |
| מערכות | `#engineering` | porcelain | verdigris | lab notebook: diagrams, measured claims |

## Color tokens
| Token | Hex | Use |
|---|---|---|
| `--porcelain` | `#ECEEE9` | page surface (cool grey-green, deliberately *not* warm cream) |
| `--ink` | `#13252B` | text and ink fills (deep pine-blue, not tinted black) |
| `--slate` | `#5D6E68` | secondary text, hairlines at 30% |
| `--cobalt` | `#2448D8` | Web room accent: links, focus, selected demo |
| `--amber` | `#F2A93B` | Video room accent on `--pine` |
| `--pine` | `#0E1F24` | Video room surface |
| `--verdigris` | `#1B7F6A` | Engineering room accent |
| `--paper` | `#F7F8F5` | raised surfaces (demo frame, article body) |

Contrast checks: ink/porcelain is 13.9:1, slate/porcelain is 4.9:1, cobalt/porcelain is 6.4:1, amber/pine is 8.6:1, and verdigris/porcelain is 4.6:1 (used for ≥16px text and UI only).
Per-room accent is a single custom property, `--accent`, set on `<body data-room>`. Components read only `--accent`, never a room-specific token.

## Typography
- **Display:** *Karantina* 700 (Hebrew, condensed poster face). Used only for the sentence dial, room titles, and project names. It is set enormous (clamp 4.5rem→13rem) and tight (line-height .82). The type *is* the navigation, so the treatment is the design.
- **Text:** *IBM Plex Sans Hebrew* 400/500/600. Used for everything else, including UI.
- **Code:** *IBM Plex Mono* is used only inside real code blocks in articles. It is never used for labels or meta.
- **Scale** (1.25, base 17px desktop / 16px mobile): 13.6 · 17 · 21.3 · 26.6 · 33.2 · 41.5 · display clamp.
- Body measure is ≤ 68ch, line-height 1.65. Article body is 1.75.
- **No** all-caps labels (Hebrew has no case anyway, and Latin tags such as `pg_trgm` stay as typed). **No** single-word colour accents in headlines. **No** eyebrows above headings. Meta goes in a sentence, not in `A · B · C` strings.

## Layout & alignment
RTL, right-aligned ragged-left text. The 12-column grid has a 24px gutter (16px under 600px) and a max width of 1240px. Articles use a single 68ch column with a sticky TOC on the inline-end side on desktop.

```
DESKTOP ─────────────────────────────────────────────────────────
 ברכי פיטוסי                                  וואטסאפ  054-756-8966
                                                                  
            אני בונה                                              
            אתרים            ← ink fill, selected                 
            סרטונים          ← outline                           
            מערכות           ← outline                           
  one-line answer for the selected room (≤ 2 lines), right-aligned
─────────────────────────────────────────────────────────────────
 [ROOM CONTENT, swaps instantly]
```

```
MOBILE (360) ─────────────────
 ברכי פיטוסי            [ווטסאפ]
 אני בונה
 אתרים   סרטונים   מערכות   ← one row, scroll-snap if needed, 44px min targets
 one-line answer
 ─────────────────────────────
 [room]
```
On scroll, the dial compresses into a sticky 56px bar with the three words as text tabs (same buttons, `aria-selected`).

### Room: אתרים (Web)
```
 ┌ intro (2 sentences, first person) ─────────────────────────┐
 ├ STYLE PLAYGROUND ──────────────────────────────────────────┤
 │ styles list (5 names + 3-swatch strip) │  device frame      │
 │  ○ כושר ואקסטרים                        │  ┌──────────────┐  │
 │  ● פיצרייה                              │  │ iframe demo  │  │
 │  ○ בוטיק יוקרה                          │  │              │  │
 │  ○ הייטק / SaaS                         │  └──────────────┘  │
 │  ○ אדריכלות / קליניקה                   │  [מחשב|נייד]  CTA  │
 ├ live client work (2 projects, asymmetric: 7/5 columns) ────┤
 ├ how pricing works: 3 rows, typographic table, no cards ────┤
 └ contact (form + WhatsApp), prefilled by the chosen style ──┘
```
On mobile, the list becomes a horizontal chip row above the frame. The frame defaults to "נייד", and "מחשב" is shown scaled to fit.

### Room: סרטונים (Video), pine surface
```
 ┌ VIDEO WALL: horizontal river of 9:16 phones (scroll-snap) ┐
 │ ▯ ▯ ▯ ▯ ▯ ▯   each phone has 22px radius, 1px bezel line,    │
 │               badge appears on hover/focus                 │
 ├ three services as three paragraphs in a right-aligned     ┤
 │  column, each a short heading + 2–3 sentences             │
 └ CTA: "שלחו לי בוואטסאפ מה אתם צריכים"                      ┘
```
The phones are the only rounded objects in this room. Their radius matches a real phone, so it carries meaning and is not a kit default.

### Room: מערכות (Engineering)
```
 Tier 1  Who I am: a 3-sentence paragraph + 2 facts set in body text
 Tier 2  Three flagships. Each is a full-width band, not a card:
         ┌ name (display) ──────────── one-sentence what-it-does ┐
         │ interactive SVG diagram (full width, ~420px tall)      │
         │ 3 measured facts in a sentence │ [לקריאת המאמר המלא]   │
         └───────────────────────────────────────────────────────┘
 Tier 3  CV: skills matrix (filter chips) + timeline (real sequence → numbered OK) + print
 Tier 4  Smaller projects: asymmetric bento (1 wide + 2 narrow), then personal note, contact
```

## Radius, borders, depth (hierarchy, not decoration)
- **Radius 0** on structural bands and tables. **Radius 22px** only on phones and the device frame (physical objects). **Radius 999px** only on chips and toggles (controls).
- **No drop shadows** except a single deep shadow under the device frame and the open lightbox, both physical objects.
- Dividers are 1px `color-mix(var(--ink) 18%)` hairlines, used only between tiers.

## Motion
- **Signature:** in the dial, the selected word fills with ink from right to left (`clip-path` 280ms, `cubic-bezier(.2,.7,.2,1)`). The room content swaps with **no transition**, so it is instant.
- **Answering motion only:** demo switching (frame cross-fade 160ms), viewport toggle (width animates 240ms), phone hover lift (scale 1.04), diagram nodes pulse along edges when you hover or tap a node, and the lightbox opens from the card rect (FLIP).
- **No** scroll-triggered fade-ups. `prefers-reduced-motion` turns off every transition and pauses video autoplay.

## Copy voice
- First person singular, active verbs: "בניתי", "תכננתי", "כתבתי בדיקות".
- Concrete nouns and numbers drawn **only** from the Git repos (see PLAN.md §facts).
- Banned: "בעידן המודרני", "פתרונות חכמים ומתקדמים", "ללא פשרות", "מהפכני", "המקום שבו טכנולוגיה פוגשת יצירתיות", "חוויית משתמש בלתי נשכחת", "לקחת את העסק שלך לשלב הבא".
- Buttons say what happens: "פתחו את הדמו", "שלחו בוואטסאפ", "לקריאת המאמר המלא", "הדפיסו קורות חיים".
- Errors give direction: "הסרטון לא נטען. נסו שוב או פתחו אותו בחלון מלא."

## Self-review against calibration tells (pass 1 → revisions)
1. *First idea was* a near-black site with an acid-lime accent ("engineer vibe"). That is tell #2. **Revised** to a porcelain surface with per-room lighting, and only the video room goes dark, because a screening room is dark for a reason.
2. *First idea was* project cards in a 3-up grid. That is tell #4. **Revised** to full-width bands, with the diagram as the hero of each band.
3. *First idea was* Heebo, which the old site used and which is the generic Hebrew default. **Revised** to Karantina + Plex Hebrew.
4. Monospace data labels (tell #5) are removed. Mono appears only inside code blocks.
5. The timeline is the one place with numbered order, because it is genuinely chronological.

## Checkpoint #1 revisions (independent reviewer)
- The **dial** is inline on desktop and capped at `clamp(3.25rem, 9vw, 8rem)`, so room content shows on a 1366×768 laptop. On ≤600px it is stacked under "אני בונה" at 3.4rem, with flat slate fill instead of outline and 48px targets. It never scrolls horizontally.
- **Contrast** recomputed: verdigris was darkened to `#156A58` (≈5.1:1) and slate to `#56675F`. The video room gets its own full token set (`--surface/--text/--muted/--accent/--hairline/--raised`, with muted `#9FB0AA` on pine).
- **Touch:** video badges and buttons are always visible. Diagram nodes respond to tap/focus, not only hover, and each diagram has a "הקישו על רכיב" caption line.
- **Fonts** are self-hosted (Hebrew + Latin subsets, about 6KB each for Hebrew). The two critical files are preloaded, and metric-adjusted fallbacks reduce CLS.
- **Conversion:** WhatsApp CTA + "אהבתי את הסגנון" sit directly under the device frame, prefilled with the selected style. Prices are shown as real numbers in the table. A persistent WhatsApp button stays in the sticky bar.
- **Recruiter path:** "קורות חיים להדפסה" + GitHub are in the engineering answer line.
- **Bento was dropped** and replaced by a typographic ledger. The engineering room gets a physical anchor (the "instrument" frame around each diagram).
- Body min size is 15px, and "וואטסאפ" is spelled the same everywhere.
