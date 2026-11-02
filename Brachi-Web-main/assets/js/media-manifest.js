// ─────────────────────────────────────────────────────────────────────────────
// The video manifest. This is the only file you edit to add videos.
//
// Add a video in one of three ways (one per entry):
//   1. Cloudinary: set mediaConfig.cloudinaryCloud once, then put the public ID in cloudinaryId.
//      The address is built automatically with f_auto,q_auto,vc_auto (the best format and codec for each device).
//   2. Cloudflare R2 / any CDN: set mediaConfig.r2Base once, then put the file path in src.
//   3. A full URL: put the full address in src (https://...).
//
// poster: a light preview image (AVIF/WebP, about 360px wide). With Cloudinary it is generated automatically.
// blurhash: an optional short string (https://blurha.sh) painted instantly before the poster loads.
// An entry with no video (no src and no cloudinaryId) is shown as "בהכנה" and is never loaded.
// ─────────────────────────────────────────────────────────────────────────────

export const mediaConfig = {
  cloudinaryCloud: '',   // e.g. 'brachi-studio'
  r2Base: '',            // e.g. 'https://media.brachi.dev/'
};

/** @type {import('./video-wall.js').AiVideo[]} */
export const aiVideos = [
  // Empty slots: each one is waiting for a video. Add src or cloudinaryId and it starts playing on the wall.
  { id: 'slot-reel-1',  title: 'רילס אנכי לעסק',            category: 'reel',  tool: 'Kling AI' },
  { id: 'slot-story-1', title: 'קליפ אנימציה לשיר או למותג', category: 'story', tool: 'Runway' },
  { id: 'slot-deck-1',  title: 'פתיח ויזואלי למצגת',         category: 'deck',  tool: 'Google Flow' },
  { id: 'slot-reel-2',  title: 'סרטון השקה למוצר',           category: 'reel',  tool: 'Google Flow' },
  { id: 'slot-story-2', title: 'סיפור מותג קצר',             category: 'story', tool: 'Kling AI' },
  { id: 'slot-reel-3',  title: 'הזמנה לאירוע',               category: 'reel',  tool: 'Runway' },
];

export const CATEGORY_LABEL = {
  reel: 'רילס לעסק',
  story: 'אנימציה וסיפור',
  deck: 'פתיח למצגת',
};
