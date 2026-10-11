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

function once(key, fn) {
  if (!cache[key]) cache[key] = fn().catch(e => { delete cache[key]; throw e; });
  return cache[key];
}

export const lib = {
  me: () => once('me', () => sp.me()),
  playlists: () => once('pl', () => all(o => sp.playlistsPage(o), 400)),
  albums: () => once('al', () => all(o => sp.albumsPage(o), 200)),
  artists: () => once('ar', () => sp.followedArtists()),
  invalidate(key) {
    if (key) delete cache[key];
    else for (const k of Object.keys(cache)) if (k !== 'me') delete cache[k];
  },
};
