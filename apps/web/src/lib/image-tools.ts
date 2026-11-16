/**
 * Image clean-up for company branding (logo, signature, stamp/seal, letterhead), done in the
 * browser on a canvas: background removal, ink recolouring, rotation, cropping and trimming.
 * Output is always a transparent PNG, which prints cleanly on every PDF.
 */

export type BackgroundMode = 'none' | 'edges' | 'all';

export interface CleanOptions {
  /** none: keep; edges: remove the background connected to the image border (keeps white areas inside a logo); all: remove every pixel of the paper colour (signatures, stamps). */
  mode: BackgroundMode;
  /** Colour distance (0–200) still counted as background. */
  tolerance: number;
  /** Extra distance over which pixels fade from transparent to opaque (smooth edges). */
  softness: number;
  /** Paint all remaining ink in one colour (e.g. "#1d3a8a"), or null to keep the original colours. */
  inkColor: string | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Longest side kept for uploads: sharp at print size, small enough to upload quickly. */
export const MAX_SIDE = 1600;

const dist = (r: number, g: number, b: number, bg: [number, number, number]) => Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2);

/** Background colour = per-channel median of the border pixels. */
export function borderColor(img: ImageData): [number, number, number] {
  const { width: w, height: h, data } = img;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 16) return; // already transparent
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    take(w - 1, y);
  }
  if (!rs.length) return [255, 255, 255];
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Opacity for a pixel at `d` from the background: 0 inside tolerance, fading over `soft`. */
const alphaFor = (d: number, tol: number, soft: number) => (d <= tol ? 0 : soft <= 0 || d >= tol + soft ? 1 : (d - tol) / soft);

/**
 * Removes the background in place. Partly transparent edge pixels are "un-blended" from the
 * background colour so no light halo remains around letters.
 */
export function removeBackground(img: ImageData, opts: Pick<CleanOptions, 'mode' | 'tolerance' | 'softness'>) {
  if (opts.mode === 'none') return;
  const { width: w, height: h, data } = img;
  const bg = borderColor(img);
  const tol = opts.tolerance;
  const soft = opts.softness;
  const limit = tol + soft;
  const apply = (p: number) => {
    const i = p * 4;
    const a = alphaFor(dist(data[i], data[i + 1], data[i + 2], bg), tol, soft);
    if (a >= 1) return;
    if (a <= 0) {
      data[i + 3] = 0;
      return;
    }
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - bg[c] * (1 - a)) / a)));
    data[i + 3] = Math.round(data[i + 3] * a);
  };

  if (opts.mode === 'all') {
    for (let p = 0; p < w * h; p++) apply(p);
    return;
  }
  // 'edges': flood fill from every border pixel through background-coloured pixels
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (p: number) => {
    if (seen[p]) return;
    const i = p * 4;
    if (data[i + 3] > 0 && dist(data[i], data[i + 1], data[i + 2], bg) > limit) return;
    seen[p] = 1;
    stack[top++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (top) {
    const p = stack[--top];
    apply(p);
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
}

/** Paints every visible pixel in one colour, keeping its opacity (and darkness as opacity for clean ink). */
export function recolor(img: ImageData, hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    // darker original pixels become more opaque ink
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    data[i + 3] = Math.round(data[i + 3] * Math.min(1, (1 - lum) * 1.6 + 0.15));
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Smallest rectangle containing visible pixels, grown by `pad`; null if the image is empty. */
export function contentBounds(img: ImageData, pad = 0): Rect | null {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(w, x1 + 1 + pad) - x, h: Math.min(h, y1 + 1 + pad) - y };
}

/** Draws the source rotated by `quarterTurns` × 90°, cropped to `crop` (in rotated coordinates), scaled to ≤ MAX_SIDE. */
export function baseCanvas(src: CanvasImageSource & { width: number; height: number }, quarterTurns: number, crop: Rect | null): HTMLCanvasElement {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const rw = turns % 2 ? src.height : src.width;
  const rh = turns % 2 ? src.width : src.height;
  const rotated = document.createElement('canvas');
  rotated.width = rw;
  rotated.height = rh;
  const rc = rotated.getContext('2d')!;
  rc.translate(rw / 2, rh / 2);
  rc.rotate((turns * Math.PI) / 2);
  rc.drawImage(src, -src.width / 2, -src.height / 2);
  const c = crop ?? { x: 0, y: 0, w: rw, h: rh };
  const scale = Math.min(1, MAX_SIDE / Math.max(c.w, c.h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.w * scale));
  out.height = Math.max(1, Math.round(c.h * scale));
  out.getContext('2d')!.drawImage(rotated, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  return out;
}

/** Full pipeline: background removal → ink colour → trim to content. */
export function cleanCanvas(base: HTMLCanvasElement, opts: CleanOptions, trim: boolean): HTMLCanvasElement {
  const ctx = base.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, base.width, base.height);
  removeBackground(img, opts);
  if (opts.inkColor) recolor(img, opts.inkColor);
  const bounds = trim ? contentBounds(img, Math.round(Math.max(img.width, img.height) * 0.02)) : null;
  const out = document.createElement('canvas');
  const b = bounds ?? { x: 0, y: 0, w: img.width, h: img.height };
  out.width = b.w;
  out.height = b.h;
  out.getContext('2d')!.putImageData(img, -b.x, -b.y);
  return out;
}

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be opened. Upload a PNG, JPG or WEBP file.'));
    img.src = src;
  });

export const canvasToPng = (c: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(new File([b], name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' })) : reject(new Error('Could not create the PNG'))), 'image/png'),
  );
