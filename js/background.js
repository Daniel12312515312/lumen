// Living background: rotating, heavily blurred copies of the cover (Beautiful-Lyrics style)
// plus an accent colour pulled from the artwork.
import { clamp, easeInOut } from './util.js';

const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
const LAYERS = [
  { s: 1.9, x: -.22, y: -.2, r: .035, ph: 0 },
  { s: 1.55, x: .28, y: .2, r: -.05, ph: 1.7 },
  { s: 1.25, x: -.16, y: .36, r: .07, ph: 3.1 },
  { s: 1.05, x: .24, y: -.34, r: -.085, ph: 4.4 },
];
const FADE = 1600;
let cur = null, prev = null, fadeStart = 0, lastDraw = 0, running = false, currentUrl = null;
const t0 = performance.now();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function resize() {
  const w = 96;
  canvas.width = w;
  canvas.height = Math.max(96, Math.round(w * innerHeight / innerWidth));
}

function drawSet(img, alpha, t) {
  const W = canvas.width, H = canvas.height, base = Math.max(W, H);
  ctx.globalAlpha = alpha;
  for (const L of LAYERS) {
    const size = base * L.s;
    ctx.save();
    ctx.translate(W / 2 + L.x * W + Math.sin(t * .13 + L.ph) * W * .09, H / 2 + L.y * H + Math.cos(t * .11 + L.ph) * H * .06);
    ctx.rotate(t * L.r + L.ph);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (now - lastDraw < 33 || document.hidden) return; // ~30 fps is plenty for a blurred backdrop
  lastDraw = now;
  const t = reduceMotion ? 0 : (now - t0) / 1000;
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0e0e15';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = 'blur(9px) saturate(1.6)';
  const f = clamp((now - fadeStart) / FADE, 0, 1);
  if (prev && f < 1) drawSet(prev.img, 1, t);
  if (cur) drawSet(cur.img, prev && f < 1 ? easeInOut(f) : 1, t);
  if (f >= 1) prev = null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (img.crossOrigin) { // retry without CORS: still drawable, just no colour sampling
        const plain = new Image();
        plain.onload = () => resolve(plain);
        plain.onerror = reject;
        plain.src = src;
      } else reject(new Error('image failed'));
    };
    img.src = src;
  });
}

/* ───── Colour sampling ───── */
function rgb2hsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function analyze(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, 32, 32);
  let data;
  try { data = x.getImageData(0, 0, 32, 32).data; } catch { return null; }
  let lum = 0, ar = 0, ag = 0, ab = 0;
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    lum += .2126 * r + .7152 * g + .0722 * b;
    ar += r; ag += g; ab += b;
    const [h, s, l] = rgb2hsl(r, g, b);
    const w = s * (1 - Math.abs(l - .5) * 1.7);
    if (w <= .06) continue;
    const k = Math.round(h * 18) % 18;
    const e = bins.get(k) || { w: 0, r: 0, g: 0, b: 0 };
    e.w += w; e.r += r * w; e.g += g * w; e.b += b * w;
    bins.set(k, e);
  }
  const n = data.length / 4;
  let best = null;
  for (const e of bins.values()) if (!best || e.w > best.w) best = e;
  let accent = [236, 236, 246];
  if (best && best.w > 10) {
    const [h, s] = rgb2hsl(best.r / best.w, best.g / best.w, best.b / best.w);
    accent = hsl2rgb(h, clamp(s, .5, .92), .7);
  }
  return { accent, lum: lum / n, avg: [ar / n, ag / n, ab / n].map(v => Math.round(v * 255)) };
}

function applyColors(info) {
  const root = document.documentElement.style;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!info) {
    root.setProperty('--accent', '#ececf6');
    root.setProperty('--shade', '.34');
    meta?.setAttribute('content', '#0b0b10');
    return;
  }
  const [r, g, b] = info.accent;
  root.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  root.setProperty('--on-accent', (.2126 * r + .7152 * g + .0722 * b) / 255 > .55 ? '#0b0b0f' : '#ffffff');
  root.setProperty('--shade', (.2 + info.lum * .42).toFixed(3));
  const [ar, ag, ab] = info.avg.map(v => Math.round(v * .3));
  meta?.setAttribute('content', `rgb(${ar}, ${ag}, ${ab})`);
}

function defaultArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, '#2a1b5c');
  g.addColorStop(.5, '#5a2f7a');
  g.addColorStop(1, '#14324f');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

export const background = {
  init() {
    resize();
    addEventListener('resize', resize);
    cur = { img: defaultArt() };
    running = true;
    requestAnimationFrame(frame);
  },
  async setImage(url) {
    if (url === currentUrl) return;
    currentUrl = url;
    if (!url) {
      prev = cur; cur = { img: defaultArt() }; fadeStart = performance.now();
      applyColors(null);
      return;
    }
    try {
      const img = await loadImage(url);
      if (url !== currentUrl) return;
      prev = cur;
      cur = { img };
      fadeStart = performance.now();
      applyColors(analyze(img));
    } catch { /* keep the previous backdrop */ }
  },
};
