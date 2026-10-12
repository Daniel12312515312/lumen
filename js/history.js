// Listening history kept on this device (IndexedDB) — never uploaded anywhere.
// Two sources:
//  • live:   Spotify's "recently played" (last 50 plays), saved every time Lumen opens,
//            so the history keeps growing from the day Lumen was installed;
//  • import: the StreamingHistory files from Spotify's "Download your data" ZIP,
//            which cover the past year (Account data) or everything (Extended history).
// Spotify's API has no minutes or play counts, so this is how the Stats ranges get them.
import { sp, isDemo } from './client.js';
import { store } from './util.js';

// the demo keeps its own made-up history, so it never mixes with the real one
const STORE = 'plays';
const dbName = () => (isDemo ? 'lumen-history-demo' : 'lumen-history');
const metaKey = () => (isDemo ? 'lumen.history.demo' : 'lumen.history');
const MIN_PLAY_MS = 30_000; // Spotify counts a "stream" after 30 seconds
let dbPromise = null, lastSync = 0;
const subs = new Set();

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(dbName(), 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

async function putMany(records) {
  const d = await db();
  for (let i = 0; i < records.length; i += 2000) {
    const chunk = records.slice(i, i + 2000);
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      chunk.forEach(r => s.put(r));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}

async function since(ts) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).index('ts').getAll(IDBKeyRange.lowerBound(ts));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

const meta = () => store(metaKey()) || {};
const setMeta = patch => { store(metaKey(), { ...meta(), ...patch }); subs.forEach(f => f()); };

/* ───────── Spotify "Download your data" files ───────── */

/** Minimal ZIP reader (stored + deflate entries) using the browser's own decompressor. */
async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file isn’t a ZIP archive.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!isHistoryFile(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    let bytes = null;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    if (bytes) out.push({ name, text: dec.decode(bytes) });
  }
  return out;
}

// StreamingHistory_music_0.json / StreamingHistory0.json (account data) and
// Streaming_History_Audio_2024_0.json (extended); podcasts and video are skipped
const isHistoryFile = name => /\.json$/i.test(name) && /streaming_?history/i.test(name) && !/podcast|video/i.test(name);

function parseHistory(text, out) {
  let list;
  try { list = JSON.parse(text); } catch { return; }
  if (!Array.isArray(list)) return;
  for (const e of list) {
    if (e.endTime && e.trackName) { // account data: "2025-10-12 18:22" in UTC
      out.push({
        id: `I|${e.endTime}|${e.artistName}|${e.trackName}`, ts: Date.parse(`${e.endTime.replace(' ', 'T')}Z`),
        ms: e.msPlayed || 0, track: e.trackName, artist: e.artistName || '', src: 'import',
      });
    } else if (e.ts && e.master_metadata_track_name) { // extended streaming history
      out.push({
        id: `I|${e.ts}|${e.spotify_track_uri || e.master_metadata_track_name}`, ts: Date.parse(e.ts),
        ms: e.ms_played || 0, track: e.master_metadata_track_name, artist: e.master_metadata_album_artist_name || '',
        uri: e.spotify_track_uri || null, src: 'import',
      });
    }
  }
}

/* ───────── Public API ───────── (named `listening` so it never shadows window.history) */
export const listening = {
  get meta() { return meta(); },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },

  /** Save Spotify's latest 50 plays (at most every 2 minutes unless forced). */
  async syncRecent(force = false) {
    if (!force && Date.now() - lastSync < 120_000) return;
    lastSync = Date.now();
    const recent = await sp.recent().catch(() => null);
    if (!recent?.length) return;
    const records = recent.filter(x => x.playedAt && x.track?.uri).map(x => ({
      id: `L|${x.playedAt}|${x.track.uri}`, ts: Date.parse(x.playedAt), ms: x.track.duration || 0,
      track: x.track.name, artist: x.track.artists?.[0]?.name || '', artistId: x.track.artists?.[0]?.id || null,
      uri: x.track.uri, image: x.track.album?.image || null, src: 'live',
    }));
    await putMany(records).catch(() => {});
    const first = Math.min(...records.map(r => r.ts));
    if (!meta().liveSince || first < meta().liveSince) setMeta({ liveSince: first });
    else subs.forEach(f => f());
  },

  /** Import Spotify's export (the ZIP, or the JSON files inside it). */
  async importFiles(files, onProgress = () => {}) {
    const records = [];
    for (const f of files) {
      onProgress(`Reading ${f.name}…`);
      if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) for (const entry of await readZip(f)) parseHistory(entry.text, records);
      else if (isHistoryFile(f.name) || /\.json$/i.test(f.name)) parseHistory(await f.text(), records);
    }
    const valid = records.filter(r => Number.isFinite(r.ts));
    if (!valid.length) throw new Error('No listening history found. Pick the ZIP from Spotify, or the StreamingHistory files inside it.');
    onProgress(`Saving ${valid.length.toLocaleString()} plays…`);
    await putMany(valid);
    const all = await since(0);
    const imported = all.filter(r => r.src === 'import');
    let from = Infinity, to = 0;
    for (const r of imported) { if (r.ts < from) from = r.ts; if (r.ts > to) to = r.ts; }
    setMeta({ importFrom: from, importTo: to, importCount: imported.length });
    return { count: valid.length, from, to };
  },

  async clearImport() {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { if (c.value.src === 'import') c.delete(); c.continue(); } };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    setMeta({ importFrom: null, importTo: null, importCount: 0 });
  },

  /** Listening summary for the last `days` days. */
  async summary(days) {
    const from = Date.now() - days * 864e5;
    const m = meta();
    let rows = await since(from);
    // imported files are the full record for the time they cover; live data fills in after
    if (m.importTo) rows = rows.filter(r => r.src === 'import' || r.ts > m.importTo);
    const plays = rows.filter(r => r.ms >= MIN_PLAY_MS);
    const ms = rows.reduce((s, r) => s + r.ms, 0);
    const songs = new Map(), artists = new Map(), hours = Array(24).fill(0);
    for (const r of plays) {
      const k = `${r.track}|${r.artist}`;
      const s = songs.get(k) || { name: r.track, artist: r.artist, uri: r.uri || null, image: r.image || null, n: 0 };
      s.n += 1;
      s.uri = s.uri || r.uri || null;
      s.image = s.image || r.image || null;
      songs.set(k, s);
      hours[new Date(r.ts).getHours()] += 1;
    }
    for (const r of rows) artists.set(r.artist, (artists.get(r.artist) || 0) + r.ms);
    let earliest = Infinity;
    for (const r of rows) if (r.ts < earliest) earliest = r.ts;
    return {
      minutes: Math.round(ms / 60000),
      plays: plays.length,
      songs: songs.size,
      artists: [...artists.keys()].filter(Boolean).length,
      topSongs: [...songs.values()].sort((a, b) => b.n - a.n).slice(0, 5),
      topArtists: [...artists.entries()].filter(([a]) => a).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, t]) => ({ name, minutes: Math.round(t / 60000) })),
      hours,
      from: Number.isFinite(earliest) ? earliest : null,
      covered: Number.isFinite(earliest) && earliest <= from + 7 * 864e5, // history reaches back to the range start
    };
  },
};
