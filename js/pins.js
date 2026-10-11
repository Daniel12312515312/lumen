// What the Home shortcuts grid shows: Liked Songs (optional) + pinned albums/playlists/artists.
// Until the user pins something, Home fills the grid automatically from recent listening.
import { store } from './util.js';

const KEY = 'lumen.home';
const MAX = 12;
const subs = new Set();

const read = () => ({ custom: false, pins: [], showLiked: true, ...(store(KEY) || {}) });
const write = s => { store(KEY, s); subs.forEach(f => f()); };
const slim = x => ({
  type: x.type, id: x.id, uri: x.uri, name: x.name, image: x.image || null,
  owner: x.owner, artists: (x.artists || []).map(a => ({ id: a.id, name: a.name })),
});

export const pins = {
  /** Shortcuts Home filled in automatically last time (used to seed the first custom list). */
  auto: [],
  get custom() { return read().custom; },
  get list() { return read().pins; },
  get showLiked() { return read().showLiked !== false; },
  get full() { return read().pins.length >= MAX; },
  isPinned(uri) { return read().pins.some(p => p.uri === uri); },

  pin(x) {
    const s = read();
    if (!s.custom) { s.custom = true; s.pins = this.auto.filter(p => p.uri).map(slim).slice(0, MAX - 1); }
    if (!s.pins.some(p => p.uri === x.uri)) s.pins.push(slim(x));
    s.pins = s.pins.slice(-MAX);
    write(s);
  },
  unpin(uri) {
    const s = read();
    if (!s.custom) { s.custom = true; s.pins = this.auto.filter(p => p.uri).map(slim); }
    s.pins = s.pins.filter(p => p.uri !== uri);
    write(s);
  },
  move(uri, dir) {
    const s = read();
    const i = s.pins.findIndex(p => p.uri === uri), j = i + dir;
    if (i < 0 || j < 0 || j >= s.pins.length) return;
    [s.pins[i], s.pins[j]] = [s.pins[j], s.pins[i]];
    write(s);
  },
  setShowLiked(v) { write({ ...read(), showLiked: !!v }); },
  reset() { write({ custom: false, pins: [], showLiked: this.showLiked }); },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
};
