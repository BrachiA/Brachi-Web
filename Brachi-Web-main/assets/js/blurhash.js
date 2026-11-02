// Minimal BlurHash decoder (algorithm: github.com/woltapp/blurhash, MIT).
// Paints a blurred preview onto a small canvas instantly, with no network.

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const decode83 = (s) => { let v = 0; for (const c of s) { const d = CHARS.indexOf(c); if (d < 0) throw new Error('bad blurhash'); v = v * 83 + d; } return v; };
const sRGBToLinear = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const linearToSRGB = (v) => { const x = Math.max(0, Math.min(1, v)); return x <= 0.0031308 ? Math.round(x * 12.92 * 255 + 0.5) : Math.round((1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255 + 0.5); };
const signPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

export function isValidBlurhash(hash) {
  if (typeof hash !== 'string' || hash.length < 6) return false;
  try {
    const size = decode83(hash[0]);
    return hash.length === 4 + 2 * ((size % 9) + 1) * (Math.floor(size / 9) + 1);
  } catch { return false; }
}

export function decodeBlurhash(hash, width, height, punch = 1) {
  const size = decode83(hash[0]);
  const nx = (size % 9) + 1, ny = Math.floor(size / 9) + 1;
  const maxAc = (decode83(hash[1]) + 1) / 166;
  const colors = new Array(nx * ny);
  const dc = decode83(hash.slice(2, 6));
  colors[0] = [sRGBToLinear(dc >> 16), sRGBToLinear((dc >> 8) & 255), sRGBToLinear(dc & 255)];
  for (let i = 1; i < colors.length; i++) {
    const v = decode83(hash.slice(4 + i * 2, 6 + i * 2));
    const q = (n) => signPow((n - 9) / 9, 2) * maxAc * punch;
    colors[i] = [q(Math.floor(v / 361)), q(Math.floor(v / 19) % 19), q(v % 19)];
  }
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
      const c = colors[i + j * nx];
      r += c[0] * basis; g += c[1] * basis; b += c[2] * basis;
    }
    const k = 4 * (x + y * width);
    px[k] = linearToSRGB(r); px[k + 1] = linearToSRGB(g); px[k + 2] = linearToSRGB(b); px[k + 3] = 255;
  }
  return px;
}

/** Paints a hash onto a canvas (32×57 matches a 9:16 ratio). Returns false if the hash is invalid. */
export function paintBlurhash(canvas, hash) {
  if (!isValidBlurhash(hash)) return false;
  const w = canvas.width = 32, h = canvas.height = 57;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.putImageData(new ImageData(decodeBlurhash(hash, w, h), w, h), 0, 0);
  return true;
}
