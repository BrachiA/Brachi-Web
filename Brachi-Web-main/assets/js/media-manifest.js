// ─────────────────────────────────────────────────────────────────────────────
// The default video manifest. Since v2.1 videos are managed through the on-site editor (lock icon in the footer),
// which publishes videos-manifest.json to Cloudflare R2. This file is the fallback when nothing has been published.
//
// Add a video in one of three ways (one per entry):
//   1. Cloudinary: set mediaConfig.cloudinaryCloud once, then put the public ID in cloudinaryId.
//      The address is built automatically with f_auto,q_auto,vc_auto (the best format and codec for each device).
//   2. Cloudflare R2: set mediaConfig.r2PublicBase once, then put the file path (key) in src.
//   3. A full URL: put the full address in src (https://...).
//
// poster: a light preview image (AVIF/WebP, about 360px wide). With Cloudinary it is generated automatically.
// blurhash: an optional short string (https://blurha.sh) painted instantly before the poster loads.
// An entry with no video (no src and no cloudinaryId) is shown as "בהכנה" and is never loaded.
// ─────────────────────────────────────────────────────────────────────────────

export const mediaConfig = {
  cloudinaryCloud: '',   // e.g. 'brachi-studio'
  // Cloudflare R2: once r2PublicBase is set, the site reads the video list published from the editor
  // at <r2PublicBase>/<r2Prefix>videos-manifest.json (the bucket needs CORS GET for the site's origin).
  r2AccountId: '4191fa0f115c567f9f99b64d9a7be0d6',   // S3 endpoint: https://<id>.r2.cloudflarestorage.com/<bucket>
  r2Bucket: 'brachi2026',
  r2PublicBase: 'https://pub-c26cb8afb1234f4ca8ee24441c393752.r2.dev',
  r2Prefix: '',
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
