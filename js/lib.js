// Cached library lists shared by Home and Library.
import { sp } from './client.js';

const cache = {};

async function all(pager, max) {
  const out = [];
  let off = 0;
  while (off != null && out.length < max) {
    const p = await pager(off);
    out.push(...p.items);
    off = p.next;
  }
  return out;
}

/** Every page of a long list, a few pages at a time in parallel (the first page tells the total). */
async function allFast(pager, max) {
  const first = await pager(0);
  const out = [...first.items];
  const offsets = [];
  for (let o = first.items.length; first.next != null && o < Math.min(first.total || 0, max); o += 50) offsets.push(o);
  for (let i = 0; i < offsets.length; i += 6) {
    const pages = await Promise.all(offsets.slice(i, i + 6).map(o => pager(o)));
    pages.forEach(p => out.push(...p.items));
  }
  return out;
}

function once(key, fn) {
  if (!cache[key]) cache[key] = fn().catch(e => { delete cache[key]; throw e; });
  return cache[key];
}

export const lib = {
  me: () => once('me', () => sp.me()),
  playlists: () => once('pl', () => all(o => sp.playlistsPage(o), 400)),
  albums: () => once('al', () => all(o => sp.albumsPage(o), 200)),
  artists: () => once('ar', () => sp.followedArtists()),
  /** All your Liked Songs (for "your liked songs by this artist"). */
  liked: () => once('lk', () => allFast(o => sp.likedPage(o), 6000)),
  invalidate(key) {
    if (key) delete cache[key];
    else for (const k of Object.keys(cache)) if (k !== 'me') delete cache[k];
  },
};
