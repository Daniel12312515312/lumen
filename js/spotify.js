// Real Spotify Web API client (follows the Feb-2026 Development Mode endpoint set).
import { auth } from './auth.js';
import { sleep } from './util.js';
import * as N from './normalize.js';

const BASE = 'https://api.spotify.com/v1';
let backoffUntil = 0;

export class ApiError extends Error {
  constructor(status, message, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

async function req(method, path, { query, body, retried = false } = {}) {
  const wait = backoffUntil - Date.now();
  if (wait > 0) await sleep(wait);
  const token = await auth.getToken();
  let url = BASE + path;
  if (query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
    const s = q.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (res.status === 401 && !retried) {
    await auth.refresh();
    return req(method, path, { query, body, retried: true });
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get('Retry-After')) || 3;
    backoffUntil = Date.now() + Math.min(ra, 30) * 1000;
    if (!retried) return req(method, path, { query, body, retried: true });
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* empty / non-JSON body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.message || res.statusText || 'Request failed', data?.error?.reason);
  return data;
}

const page = (d, offset, map, size = 50) => ({
  items: (d?.items || []).map(map).filter(Boolean),
  next: d?.next ? offset + size : null,
  total: d?.total ?? 0,
});

export const spotify = {
  async me() {
    const m = await req('GET', '/me');
    return { id: m.id, name: m.display_name || m.id, image: N.pickImage(m.images, 120) };
  },

  /* Library */
  async playlistsPage(offset = 0) {
    return page(await req('GET', '/me/playlists', { query: { limit: 50, offset } }), offset, N.nPlaylist);
  },
  async likedPage(offset = 0) {
    return page(await req('GET', '/me/tracks', { query: { limit: 50, offset } }), offset, x => N.nTrack(x.track || x.item));
  },
  async albumsPage(offset = 0) {
    return page(await req('GET', '/me/albums', { query: { limit: 50, offset } }), offset, x => N.nAlbum(x.album));
  },
  async followedArtists() {
    const out = [];
    let after;
    for (let i = 0; i < 4; i++) {
      const d = await req('GET', '/me/following', { query: { type: 'artist', limit: 50, after } });
      out.push(...(d?.artists?.items || []).map(N.nArtist));
      after = d?.artists?.cursors?.after;
      if (!after || !d?.artists?.next) break;
    }
    return out;
  },
  async recent() {
    const d = await req('GET', '/me/player/recently-played', { query: { limit: 50 } });
    return (d?.items || []).map(x => ({
      track: N.nTrack(x.track),
      context: x.context ? { uri: x.context.uri, type: x.context.type } : null,
    })).filter(x => x.track);
  },
  async topArtists() {
    const d = await req('GET', '/me/top/artists', { query: { time_range: 'short_term', limit: 20 } });
    return (d?.items || []).map(N.nArtist);
  },
  async topTracks() {
    const d = await req('GET', '/me/top/tracks', { query: { time_range: 'short_term', limit: 20 } });
    return (d?.items || []).map(t => N.nTrack(t));
  },

  /* Collections */
  async playlist(id) {
    const p = await req('GET', `/playlists/${id}`, { query: { additional_types: 'track,episode' } });
    const pl = N.nPlaylist(p);
    const pg = p.items || p.tracks;
    pl.firstPage = pg && Array.isArray(pg.items)
      ? { items: pg.items.map(x => N.nTrack(x.item || x.track)).filter(Boolean), next: pg.next ? pg.items.length : null, total: pg.total }
      : null;
    return pl;
  },
  async playlistItems(id, offset = 0) {
    const d = await req('GET', `/playlists/${id}/items`, { query: { limit: 50, offset, additional_types: 'track,episode' } });
    return page(d, offset, x => N.nTrack(x.item || x.track));
  },
  async playlistMeta(id) {
    return N.nPlaylist(await req('GET', `/playlists/${id}`, { query: { fields: 'id,name,images,uri,owner(id,display_name)' } }));
  },
  async album(id) {
    const a = await req('GET', `/albums/${id}`);
    const al = N.nAlbum(a);
    const ref = N.nAlbumRef(a);
    al.ref = ref;
    al.firstPage = {
      items: (a.tracks?.items || []).map(t => N.nTrack(t, ref)),
      next: a.tracks?.next ? a.tracks.items.length : null,
      total: a.tracks?.total ?? 0,
    };
    return al;
  },
  async albumTracks(id, offset, ref) {
    const d = await req('GET', `/albums/${id}/tracks`, { query: { limit: 50, offset } });
    return page(d, offset, t => N.nTrack(t, ref));
  },
  async artist(id) { return N.nArtist(await req('GET', `/artists/${id}`)); },
  async artistAlbums(id, group) {
    const d = await req('GET', `/artists/${id}/albums`, { query: { include_groups: group, limit: 10 } });
    return (d?.items || []).map(N.nAlbum);
  },

  async search(q, offset = 0, type = 'track,artist,album,playlist') {
    const d = await req('GET', '/search', { query: { q, type, limit: 10, offset } });
    return {
      tracks: (d?.tracks?.items || []).filter(Boolean).map(t => N.nTrack(t)),
      tracksNext: d?.tracks?.next ? offset + 10 : null,
      artists: (d?.artists?.items || []).filter(Boolean).map(N.nArtist),
      albums: (d?.albums?.items || []).filter(Boolean).map(N.nAlbum),
      playlists: (d?.playlists?.items || []).filter(Boolean).map(N.nPlaylist),
    };
  },

  /* Player */
  async playback() {
    return N.nPlayback(await req('GET', '/me/player', { query: { additional_types: 'track,episode' } }));
  },
  async queue() {
    const d = await req('GET', '/me/player/queue');
    return { current: N.nTrack(d?.currently_playing), queue: (d?.queue || []).map(t => N.nTrack(t)).filter(Boolean) };
  },
  async devices() {
    const d = await req('GET', '/me/player/devices');
    return (d?.devices || []).map(x => ({
      id: x.id, name: x.name, type: x.type, active: x.is_active, restricted: x.is_restricted,
    }));
  },
  play({ contextUri, offsetUri, offsetPosition, uris, positionMs, deviceId } = {}) {
    const body = {};
    if (contextUri) body.context_uri = contextUri;
    if (uris) body.uris = uris;
    if (offsetUri) body.offset = { uri: offsetUri };
    else if (offsetPosition != null) body.offset = { position: offsetPosition };
    if (positionMs) body.position_ms = positionMs;
    return req('PUT', '/me/player/play', { query: { device_id: deviceId }, body: Object.keys(body).length ? body : undefined });
  },
  pause(deviceId) { return req('PUT', '/me/player/pause', { query: { device_id: deviceId } }); },
  next(deviceId) { return req('POST', '/me/player/next', { query: { device_id: deviceId } }); },
  prev(deviceId) { return req('POST', '/me/player/previous', { query: { device_id: deviceId } }); },
  seek(ms, deviceId) { return req('PUT', '/me/player/seek', { query: { position_ms: ms, device_id: deviceId } }); },
  shuffle(state, deviceId) { return req('PUT', '/me/player/shuffle', { query: { state, device_id: deviceId } }); },
  repeat(state, deviceId) { return req('PUT', '/me/player/repeat', { query: { state, device_id: deviceId } }); },
  addToQueue(uri, deviceId) { return req('POST', '/me/player/queue', { query: { uri, device_id: deviceId } }); },
  transfer(id, play = true) { return req('PUT', '/me/player', { body: { device_ids: [id], play } }); },

  /* Library (new generic endpoints) */
  async libraryContains(uris) {
    const d = await req('GET', '/me/library/contains', { query: { uris: uris.join(',') } });
    return Array.isArray(d) ? d : [];
  },
  librarySave(uris) { return req('PUT', '/me/library', { query: { uris: uris.join(',') } }); },
  libraryRemove(uris) { return req('DELETE', '/me/library', { query: { uris: uris.join(',') } }); },
};
