// Synced lyrics: fetching (LRCLIB), LRC parsing, word-timing estimation and the
// Beautiful-Lyrics-style renderer (glowing word fill, spring-cascaded scrolling).
import { isRTL, isArabic, clamp, easeOut, store, icon } from './util.js';

/* ───────────────────────── Fetching ───────────────────────── */
const mem = new Map();
const LS_KEY = 'lumen.lyrics';
const NONE_TTL = 3 * 24 * 3600 * 1000;

function lsGet(key) {
  const rec = (store(LS_KEY) || {})[key];
  if (!rec) return null;
  if (rec.none && Date.now() - rec.at > NONE_TTL) return null;
  return rec;
}
function lsPut(key, rec) {
  const c = store(LS_KEY) || {};
  c[key] = { ...rec, at: Date.now() };
  const keys = Object.keys(c);
  if (keys.length > 80) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 80).forEach(k => delete c[k]);
  store(LS_KEY, c);
}

function cleanTitle(t) {
  return t
    .replace(/\s+[-–]\s+.*\b(remaster(ed)?|live|version|edit|mono|stereo|acoustic|mix|bonus)\b.*$/i, '')
    .replace(/\s*[([](feat\.?|ft\.?|with|from)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|version|edit|live)\b[^)\]]*[)\]]/gi, '')
    .trim() || t;
}

async function lrclib(path, params) {
  const res = await fetch(`https://lrclib.net${path}?${new URLSearchParams(params)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib ${res.status}`);
  return res.json();
}

function pick(list, dur, tolerance = 4) {
  const ok = (list || []).filter(r => r && (r.syncedLyrics || r.plainLyrics || r.instrumental) && Math.abs((r.duration || 0) - dur) <= tolerance);
  ok.sort((a, b) => (Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics)) || (Math.abs(a.duration - dur) - Math.abs(b.duration - dur)));
  return ok[0] || null;
}

export async function fetchLyrics(track) {
  if (!track) return { kind: 'none' };
  if (track.lrc !== undefined) return track.lrc ? parseLRC(track.lrc, track.duration) : { kind: 'none' }; // demo
  if (track.type === 'episode') return { kind: 'none' };
  const key = track.id || track.uri;
  if (mem.has(key)) return mem.get(key);

  const p = (async () => {
    const cached = lsGet(key);
    if (cached) return toLyrics(cached, track.duration);
    const artist = track.artists?.[0]?.name || '';
    const dur = Math.round(track.duration / 1000);
    let ok = 0, errors = 0;
    const call = async (path, params) => {
      try { const r = await lrclib(path, params); ok++; return r; } catch { errors++; return null; }
    };
    let rec = await call('/api/get', { track_name: track.name, artist_name: artist, album_name: track.album?.name || '', duration: dur });
    if (!rec || (!rec.syncedLyrics && !rec.instrumental)) {
      const clean = cleanTitle(track.name);
      const found = pick(await call('/api/search', { track_name: clean, artist_name: artist }), dur)
        || pick(await call('/api/search', { q: `${clean} ${artist}` }), dur)
        // artist names often differ by language ("Omer Adam" vs "עומר אדם") → title + exact length
        || pick(await call('/api/search', { track_name: clean }), dur, 2);
      if (found && (found.syncedLyrics || !rec)) rec = found;
    }
    if (!rec && errors) return { kind: ok ? 'none' : 'error' }; // don't cache a miss caused by network errors
    const slim = rec
      ? { synced: rec.syncedLyrics || '', plain: rec.syncedLyrics ? '' : (rec.plainLyrics || ''), instrumental: !!rec.instrumental }
      : { none: true };
    lsPut(key, slim);
    return toLyrics(slim, track.duration);
  })();
  mem.set(key, p);
  p.then(r => { if (r.kind === 'error') mem.delete(key); }, () => mem.delete(key));
  return p;
}

function toLyrics(rec, durMs) {
  if (!rec || rec.none) return { kind: 'none' };
  if (rec.synced) {
    const r = parseLRC(rec.synced, durMs);
    if (r.lines.length) return r;
  }
  if (rec.instrumental) return { kind: 'instrumental' };
  if (rec.plain) {
    const lines = [];
    for (const raw of rec.plain.split(/\r?\n/)) {
      const text = raw.trim();
      if (text) lines.push({ kind: 'line', text, rtl: isRTL(text) });
      else if (lines.length && lines[lines.length - 1].kind !== 'gap') lines.push({ kind: 'gap' });
    }
    return { kind: 'plain', lines };
  }
  return { kind: 'none' };
}

/* ───────────────────────── LRC parsing ───────────────────────── */
const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const toMs = (m, s) => (Number(m) * 60 + parseFloat(String(s).replace(':', '.'))) * 1000;

export function parseLRC(text, durMs = 0) {
  let offset = 0;
  const raw = [];
  for (const line of text.split(/\r?\n/)) {
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]); continue; }
    const tags = [...line.matchAll(TAG)];
    if (!tags.length) continue;
    let body = line.replace(TAG, '').trim();
    let words = null;
    if (/<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/.test(body)) { // enhanced LRC (word timestamps)
      words = [];
      const re = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>([^<]*)/g;
      let m;
      while ((m = re.exec(body))) {
        const t = toMs(m[1], m[2]);
        const last = words[words.length - 1];
        if (last && last.end == null) last.end = t;
        const txt = m[3].trim();
        if (txt) words.push({ text: txt, start: t, end: null });
      }
      body = words.map(w => w.text).join(' ');
    }
    for (const tg of tags) raw.push({ start: toMs(tg[1], tg[2]) - offset, text: body, words });
  }
  raw.sort((a, b) => a.start - b.start);

  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i], nxt = raw[i + 1];
    const nextStart = nxt ? nxt.start : Math.max(r.start + 4000, durMs || 0);
    if (!r.text) {
      if (nxt && nextStart - r.start >= 2600) lines.push({ kind: 'interlude', start: r.start + 150, end: nextStart - 200 });
      continue;
    }
    const words = r.words?.length ? fixWords(r.words, nextStart) : estimateWords(r.text, r.start, nextStart);
    const singEnd = words[words.length - 1].end;
    lines.push({ kind: 'line', start: r.start, text: r.text, words, rtl: isRTL(r.text) });
    if (nxt && nxt.text && nxt.start - singEnd > 7000) lines.push({ kind: 'interlude', start: singEnd + 900, end: nxt.start - 200 });
  }
  const first = lines.find(l => l.kind === 'line');
  if (first && first.start > 3500 && !(lines[0].kind === 'interlude' && lines[0].start < 1500)) {
    lines.unshift({ kind: 'interlude', start: 0, end: first.start - 200 });
  }
  return { kind: 'synced', lines, rtl: lines.some(l => l.rtl) };
}

function fixWords(words, nextStart) {
  return words.map((w, k) => ({
    text: w.text,
    start: w.start,
    end: w.end ?? words[k + 1]?.start ?? Math.min(nextStart - 100, w.start + Math.max(450, w.text.length * 140)),
  }));
}

/** No word timings available → spread the line's time over its words by length. */
function estimateWords(text, start, nextStart) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map(w => (w.replace(/[^\p{L}\p{N}]/gu, '').length || 1) + 1.2 + (/[,.;:!?…]$/.test(w) ? 1.5 : 0));
  const W = weights.reduce((a, b) => a + b, 0);
  const letters = tokens.reduce((a, w) => a + w.length, 0);
  const est = letters * 78 + tokens.length * 135;
  const avail = Math.max(300, nextStart - start - 120);
  const dur = avail <= est * 1.8 ? avail * .9 : Math.min(avail * .9, est * 1.35);
  let acc = 0;
  return tokens.map((t, k) => {
    const s = start + (acc / W) * dur;
    acc += weights[k];
    return { text: t, start: s, end: start + (acc / W) * dur };
  });
}

/* In an RTL line, keep runs of Latin words together so bidi ordering stays right. */
function mergeLatin(words) {
  const out = [];
  for (const w of words) {
    const latin = !isRTL(w.text) && /[A-Za-z]/.test(w.text);
    const last = out[out.length - 1];
    if (latin && last?.latin) { last.text += ' ' + w.text; last.end = w.end; } else out.push({ ...w, latin });
  }
  return out;
}

const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = s => (seg ? [...seg.segment(s)].map(x => x.segment) : [...s]);

/* ───────────────────────── Spring ───────────────────────── */
class Spring {
  constructor() { this.x = 0; this.v = 0; this.target = 0; this.pending = null; this.at = 0; }
  set(x) { this.x = x; this.target = x; this.v = 0; this.pending = null; }
  schedule(target, at) {
    if (at <= performance.now()) { this.target = target; this.pending = null; } else { this.pending = target; this.at = at; }
  }
  get idle() { return this.pending === null && this.x === this.target && this.v === 0; }
  step(dt, now) {
    if (this.pending !== null && now >= this.at) { this.target = this.pending; this.pending = null; }
    if (this.x === this.target && this.v === 0) return;
    const k = 70, c = 17; // ≈ critically damped, soft ~0.75 s glide
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      this.v += (-k * (this.x - this.target) - c * this.v) * h;
      this.x += this.v * h;
    }
    if (Math.abs(this.x - this.target) < .05 && Math.abs(this.v) < .5) { this.x = this.target; this.v = 0; }
  }
}

/* ───────────────────────── Renderer ───────────────────────── */
const ANCHOR = .26; // active line sits ~a quarter of the way down
const SPLIT_LETTERS = true; // every character animates on its own → a wave runs through the line
const smooth = t => t * t * (3 - 2 * t);
const sinOut = t => Math.sin((t * Math.PI) / 2);

/*
 * Beautiful-Lyrics-style motion. Every letter follows keyframed targets for size, height
 * and glow as it's sung, and reaches them through damped springs — so it swells softly
 * past full size, bobs a touch and settles, a little behind the singing.
 */
const keyframes = kf => t => {
  if (t <= kf[0][0]) return kf[0][1];
  for (let i = 1; i < kf.length; i++) {
    const [t1, v1] = kf[i];
    if (t <= t1) { const [t0, v0] = kf[i - 1]; return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0)); }
  }
  return kf[kf.length - 1][1];
};
const SCALE = keyframes([[0, .95], [.7, 1.025], [1, 1]]); // upcoming text sits a bit smaller
const RISE = keyframes([[0, .01], [.9, -1 / 60], [1, 0]]); // em; negative = up
const GLOW = keyframes([[0, 0], [.15, 1], [.6, 1], [1, 0]]);
const MOTION = { scale: [.6, .7], rise: [.4, 1.25], glow: [.5, 1] }; // [damping ratio, Hz]
// glow at full strength: [extra blur px, opacity] for normal letters and for long held words
const GLOW_LOOK = { base: 4, normal: [2, .3], held: [6, .8] };
const MOTION_BLUR = { per: 150, max: 2.8 }; // px/s of movement per 1px of blur, cap in px

class Motion {
  constructor(x, [zeta, hz]) { this.x = x; this.v = 0; this.target = x; this.z = zeta; this.w = hz * 2 * Math.PI; }
  set(x) { this.x = this.target = x; this.v = 0; }
  get asleep() { return this.x === this.target && this.v === 0; }
  step(dt) {
    if (this.asleep) return;
    const { z, w } = this;
    for (let left = dt; left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      this.v += (-w * w * (this.x - this.target) - 2 * z * w * this.v) * h;
      this.x += this.v * h;
    }
    if (Math.abs(this.x - this.target) < 2e-4 && Math.abs(this.v) < 2e-3) this.set(this.target);
  }
}

export class LyricsView {
  constructor(root, { onSeek, onTap } = {}) {
    this.root = root;
    this.onSeek = onSeek;
    this.onTap = onTap;
    root.classList.add('lyrics');
    this.trackEl = Object.assign(document.createElement('div'), { className: 'ly-track' });
    this.statusEl = Object.assign(document.createElement('div'), { className: 'ly-status hidden' });
    root.append(this.trackEl, this.statusEl);
    this.items = [];
    this.data = null;
    this.active = -2;
    this.manual = false;
    this.manualUntil = 0;
    this.drag = null;
    this.h = 0;
    this.lastFrame = 0;
    this.awake = new Set(); // lines whose letters are animating
    new ResizeObserver(() => this.measure()).observe(root);
    root.addEventListener('pointerdown', e => this.down(e));
    root.addEventListener('pointermove', e => this.move(e));
    root.addEventListener('pointerup', e => this.up(e));
    root.addEventListener('pointercancel', e => this.up(e, true));
  }

  showStatus(kind) {
    const m = {
      loading: '<div class="ly-loading"><i></i><i></i><i></i></div>',
      none: `${icon('lyrics')}<div>No lyrics for this song</div><small>Synced lyrics come from LRCLIB</small>`,
      instrumental: `${icon('music')}<div>Instrumental</div><small>Just enjoy the music</small>`,
      error: `${icon('lyrics')}<div>Couldn’t load lyrics</div><small>Check your connection</small>`,
    };
    this.data = { kind };
    this.items = [];
    this.awake.clear();
    this.trackEl.innerHTML = '';
    this.statusEl.innerHTML = m[kind] || m.none;
    this.statusEl.classList.remove('hidden');
    this.root.classList.remove('manual', 'plain');
  }

  setLyrics(data) {
    if (!data || !['synced', 'plain'].includes(data.kind)) { this.showStatus(data?.kind || 'none'); return; }
    this.data = data;
    this.items = [];
    this.awake.clear();
    this.active = -2;
    this.manual = data.kind === 'plain';
    this.manualUntil = data.kind === 'plain' ? Infinity : 0;
    this.statusEl.classList.add('hidden');
    this.root.classList.remove('manual');
    this.root.classList.toggle('plain', data.kind === 'plain');
    this.trackEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    data.lines.forEach((L, i) => {
      const it = this.build(L, i, data);
      this.items.push(it);
      frag.append(it.el);
    });
    this.trackEl.append(frag);
    this.measure();
    if (data.kind === 'plain') for (const it of this.items) it.spring.set(24);
  }

  build(L, i, data) {
    const el = document.createElement('div');
    el.className = 'ly-line';
    el.dataset.i = i;
    const inner = document.createElement('div');
    inner.className = 'ly-inner';
    el.append(inner);
    const it = { L, el, inner, spring: new Spring(), words: [], top: 0, height: 0, drawn: null, blur: null };
    if (L.kind === 'interlude') {
      el.classList.add('ly-interlude');
      el.dir = data.rtl ? 'rtl' : 'ltr';
      inner.innerHTML = '<div class="ly-dots"><i></i><i></i><i></i></div>';
      it.dotsEl = inner.firstChild;
      it.dots = [...it.dotsEl.children];
      return it;
    }
    if (L.kind === 'gap') { el.style.height = '18px'; el.style.padding = '0'; return it; }
    el.dir = L.rtl ? 'rtl' : 'ltr';
    if (data.kind === 'plain') { inner.textContent = L.text; return it; }

    it.units = [];
    const words = L.rtl ? mergeLatin(L.words) : L.words;
    words.forEach((w, k) => {
      if (k) inner.append(' ');
      const span = document.createElement('span');
      span.className = 'w';
      const dur = Math.max(1, w.end - w.start);
      const chars = graphemes(w.text);
      // long held words get the stronger look (bigger bob, brighter glow)
      const word = { start: w.start, dur, held: chars.length <= 12 ? clamp((dur - 800) / 500, 0, 1) : 0 };
      if (w.latin) { span.dir = 'ltr'; span.style.setProperty('--gdir', '90deg'); }
      if (SPLIT_LETTERS && !isArabic(w.text)) { // Arabic letters join, so they can't be split apart
        span.classList.add('split');
        chars.forEach((ch, j) => {
          const l = document.createElement('span');
          l.className = 'l';
          l.textContent = ch;
          span.append(l);
          it.units.push(this.unit(l, word, j, chars.length, true));
        });
      } else {
        span.textContent = w.text;
        it.units.push(this.unit(span, word, 0, 1, false));
      }
      inner.append(span);
    });
    return it;
  }

  unit(el, word, j, n, letter) {
    const u = {
      el, word, j, n, letter, key: '',
      s: new Motion(SCALE(0), MOTION.scale), y: new Motion(RISE(0), MOTION.rise), g: new Motion(0, MOTION.glow),
    };
    this.paint(u, 0);
    return u;
  }

  measure() {
    const h = this.root.clientHeight;
    if (!h || !this.items.length) return;
    this.h = h;
    for (const it of this.items) { it.top = it.el.offsetTop; it.height = it.el.offsetHeight; }
    if (this.data.kind === 'plain') return;
    if (!this.manual && this.active !== -2) this.retarget(true);
  }

  restOffset() {
    const a = this.active;
    const it = this.items[a >= 0 ? a : 0];
    if (!it) return 0;
    return this.h * ANCHOR - it.top + (a >= 0 ? 0 : 36);
  }

  retarget(immediate = false, prev = this.active) {
    const target = this.restOffset();
    const now = performance.now();
    const a = Math.max(this.active, 0);
    const forward = this.active >= prev;
    this.items.forEach((it, i) => {
      if (immediate) { it.spring.set(target); return; }
      const steps = forward ? clamp(i - a, 0, 10) : clamp(a - i, 0, 10);
      it.spring.schedule(target, now + steps * 55);
    });
  }

  findActive(t) {
    let lo = 0, hi = this.items.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].L.start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /** Jump straight to the current line on the next frame (after the view was hidden). */
  snap() { this.snapNext = true; }

  setActive(a, immediate = false, t = 0) {
    const prev = this.active;
    const p = this.items[prev];
    if (p) { p.el.classList.remove('active'); this.reset(p); }
    this.active = a;
    this.items[a]?.el.classList.add('active');
    // after a jump (seek, first show) put every line straight into its sung / upcoming state
    if (immediate || prev === -2 || Math.abs(a - prev) > 1) {
      for (const it of this.items) if (it.units) this.animUnits(it, t, 0, true);
    }
    if (p?.units) this.awake.add(p);
    if (this.items[a]?.units) this.awake.add(this.items[a]);
    this.items.forEach((it, i) => {
      const d = a < 0 ? i + 1 : Math.abs(i - a);
      const b = Math.min(d * .6, 2.4).toFixed(2);
      if (it.blur !== b) { it.inner.style.setProperty('--blur', b); it.blur = b; }
    });
    if (!this.manual) this.retarget(immediate || prev === -2, prev);
  }

  reset(it) {
    if (it.dotsEl) { it.dotsEl.style.transform = ''; it.dots.forEach(d => { d.style.opacity = ''; }); }
  }

  /** Called every animation frame with the current song position (ms). */
  update(t) {
    const now = performance.now();
    const dt = Math.min(.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    if (!this.items.length || !this.h) return;

    if (this.data.kind === 'synced') {
      const a = this.findActive(t);
      if (a !== this.active) this.setActive(a, this.snapNext, t);
      else if (this.snapNext && !this.manual) this.retarget(true);
      this.snapNext = false;
      const it = this.items[a];
      if (it?.dotsEl) this.animDots(it, t);
      // the active line plus any line whose letters are still settling
      for (const line of this.awake) {
        if (this.animUnits(line, t, dt) && line !== it) this.awake.delete(line);
      }
      if (this.manual && !this.drag && now > this.manualUntil) this.exitManual();
    }

    // soft motion blur: lines blur a little in proportion to how fast they're moving
    const dragV = this.drag?.moved ? Math.abs(this.drag.v) : 0;
    for (const it of this.items) {
      it.spring.step(dt, now);
      if (it.drawn !== it.spring.x) {
        it.el.style.transform = `translate3d(0,${it.spring.x.toFixed(2)}px,0)`;
        it.drawn = it.spring.x;
      }
      const y = it.top + it.spring.x;
      const onScreen = y > -200 && y < this.h + 200;
      const mb = onScreen ? Math.min(MOTION_BLUR.max, Math.max(dragV, Math.abs(it.spring.v)) / MOTION_BLUR.per) : 0;
      const key = mb > .2 ? mb.toFixed(1) : '';
      if (key !== (it.mb || '')) {
        it.el.style.filter = key ? `blur(${key}px)` : '';
        it.mb = key;
      }
    }
  }

  /** Progress of one letter: [fill/motion progress, glow progress], both 0..1. */
  progress(u, t) {
    const w = u.word;
    const wt = clamp((t - w.start) / w.dur, 0, 1);
    if (!u.letter) return [wt, wt];
    const a = sinOut(wt); // letters early in the word move a little quicker
    const from = u.j / u.n;
    return [clamp((a - from) * u.n, 0, 1), clamp((a - from) / (1 - from), 0, 1)]; // glow lasts to the word's end
  }

  /** Steps every letter of a line toward its targets; returns true once all have settled. */
  animUnits(it, t, dt, immediate = false) {
    let settled = true;
    for (const u of it.units) {
      const [p, gp] = this.progress(u, t);
      u.s.target = SCALE(p);
      u.y.target = RISE(p);
      u.g.target = GLOW(gp);
      if (immediate) { u.s.set(u.s.target); u.y.set(u.y.target); u.g.set(u.g.target); } else { u.s.step(dt); u.y.step(dt); u.g.step(dt); }
      this.paint(u, p);
      if (!(u.s.asleep && u.y.asleep && u.g.asleep)) settled = false;
    }
    return settled;
  }

  paint(u, p) {
    const h = u.word.held;
    const y = u.y.x * (1 + h); // held words bob twice as much
    const g = Math.max(0, u.g.x);
    const blur = GLOW_LOOK.base + g * (GLOW_LOOK.normal[0] + (GLOW_LOOK.held[0] - GLOW_LOOK.normal[0]) * h);
    const alpha = g * (GLOW_LOOK.normal[1] + (GLOW_LOOK.held[1] - GLOW_LOOK.normal[1]) * h);
    const key = `${p.toFixed(3)}|${u.s.x.toFixed(4)}|${y.toFixed(4)}|${alpha.toFixed(3)}`;
    if (key === u.key) return;
    u.key = key;
    const st = u.el.style;
    st.setProperty('--p', p.toFixed(3));
    st.transform = `translateY(${y.toFixed(4)}em) scale(${u.s.x.toFixed(4)})`;
    st.setProperty('--gr', `${blur.toFixed(1)}px`);
    st.setProperty('--go', alpha.toFixed(3));
  }

  animDots(it, t) {
    const { start, end } = it.L;
    const p = clamp((t - start) / Math.max(1, end - start), 0, 1);
    const appear = easeOut(clamp((t - start) / 500, 0, 1));
    const vanish = 1 - easeOut(clamp((t - (end - 500)) / 500, 0, 1));
    const breathe = 1 + .1 * Math.sin(((t - start) / 1000) * Math.PI * 1.5);
    it.dotsEl.style.transform = `scale(${(appear * vanish * breathe).toFixed(3)})`;
    it.dots.forEach((d, k) => { d.style.opacity = (.28 + .72 * clamp(p * 3 - k, 0, 1)).toFixed(3); });
  }

  /* ───── Touch: drag to browse, tap a line to jump there ───── */
  currentOffset() {
    const it = this.items[clamp(this.active, 0, this.items.length - 1)];
    return it ? it.spring.x : 0;
  }
  bounds() {
    const first = this.items[0], last = this.items[this.items.length - 1];
    if (this.data.kind === 'plain') {
      return { max: 24, min: Math.min(24, this.h * .45 - (last.top + last.height)) };
    }
    const anchor = this.h * ANCHOR;
    const max = anchor - first.top + 40;
    return { max, min: Math.min(max, anchor - last.top) };
  }
  rubber(off) {
    const { min, max } = this.bounds();
    if (off > max) return max + (off - max) * .35;
    if (off < min) return min + (off - min) * .35;
    return off;
  }
  enterManual() {
    this.manual = true;
    this.manualUntil = Infinity;
    if (this.data.kind === 'synced') this.root.classList.add('manual');
  }
  exitManual() {
    if (this.data.kind !== 'synced') return;
    this.manual = false;
    this.root.classList.remove('manual');
    this.retarget(false, this.active);
  }

  down(e) {
    if (!this.items.length) return;
    try { this.root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const now = performance.now();
    this.drag = { id: e.pointerId, y0: e.clientY, x0: e.clientX, lastY: e.clientY, lastT: now, v: 0, moved: false, base: this.currentOffset() };
  }
  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dy) < 7) return;
      d.moved = true;
      this.enterManual();
    }
    const now = performance.now();
    const inst = ((e.clientY - d.lastY) / Math.max(1, now - d.lastT)) * 1000;
    d.v = d.v * .5 + inst * .5;
    d.lastY = e.clientY;
    d.lastT = now;
    const off = this.rubber(d.base + dy);
    for (const it of this.items) it.spring.set(off);
  }
  up(e, cancelled = false) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved) {
      if (cancelled) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ly-line');
      const it = hit ? this.items[Number(hit.dataset.i)] : null;
      if (it && this.data.kind === 'synced' && it.L.kind === 'line') {
        this.onSeek?.(it.L.start);
        if (this.manual) { this.manualUntil = 0; }
      } else this.onTap?.();
      return;
    }
    const now = performance.now();
    const v = now - d.lastT > 90 ? 0 : d.v;
    const { min, max } = this.bounds();
    const target = clamp(this.currentOffset() + v * .32, min, max);
    for (const it of this.items) it.spring.schedule(target, now);
    this.manualUntil = this.data.kind === 'plain' ? Infinity : now + 3200;
  }
}
