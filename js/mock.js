// Offline demo: fictional artists/songs (lyrics written for this demo) and a simulated player.
import { sleep } from './util.js';

const LRC_EN = `[00:00.00]
[00:05.20] I left the city sleeping in the rearview
[00:09.60] Every light was singing something new
[00:13.80] Hold the silence like a secret
[00:17.40] Let it carry me to you
[00:21.40]
[00:25.00] Oh, we are glass hours
[00:28.40] Breaking into gold
[00:31.60] Every word you never said
[00:35.20] Is a story that I hold
[00:39.40]
[00:46.00] So turn it up and let the night be ours
[00:50.60] We're running on the edge of shooting stars
[00:55.00] And if the morning finds us here
[00:58.80] We'll still be shining through the years
[01:03.40]
[01:08.00] Ooooh, glass hours
[01:12.60] Ooooh, into gold
[01:17.40] Every word you never said
[01:21.20] Is the light I hold
[01:26.00]`;

const LRC_HE = `[00:00.00]
[00:04.50] הלילה יורד לאט על העיר
[00:08.80] ואני שומע אותך בין השירים
[00:13.20] כל אור קטן מספר לי סיפור
[00:17.40] שאנחנו עוד כאן ועוד חולמים
[00:21.80]
[00:26.00] אז תני לי עוד רגע של שקט
[00:30.20] לפני שהבוקר יבוא
[00:34.20] אור של לילה, אור של לילה
[00:38.60] נשאר איתי כשאת לא
[00:43.00]
[00:49.00] והרחוב מתעורר בלי מילים
[00:53.20] ואני מחזיק את מה שנשאר
[00:57.60] אור של לילה, all night long
[01:02.40] נשאר איתי עד הסוף
[01:07.00]`;

const ARTISTS = [
  { id: 'a1', name: 'Neon Harbor', colors: ['#3a1c71', '#ff5f6d', '#ffc371'], genres: ['synth-pop'] },
  { id: 'a2', name: 'Velvet Static', colors: ['#0b1e3f', '#6a11cb', '#2af598'], genres: ['dream pop'] },
  { id: 'a3', name: 'Paper Moons', colors: ['#134e5e', '#71b280', '#f9d423'], genres: ['indie folk'] },
  { id: 'a4', name: 'Coastline', colors: ['#fc466b', '#3f5efb', '#ffd3a5'], genres: ['indie rock'] },
  { id: 'a5', name: 'אביב כחול', colors: ['#000428', '#004e92', '#9be7ff'], genres: ['israeli pop'] },
  { id: 'a6', name: 'Juniper Lane', colors: ['#41295a', '#ff9a8b', '#ffd200'], genres: ['bedroom pop'] },
];

const ALBUMS = [
  { id: 'b1', name: 'Midnight Signals', artist: 'a1', year: '2025', colors: ['#1a0b2e', '#ff5f6d', '#ffc371'],
    tracks: [['Glass Hours', 96000, LRC_EN], ['Afterglow Avenue', 184000], ['Static Hearts', 201000], ['Neon Rain', 176000], ['Last Train Home', 223000]] },
  { id: 'b2', name: 'Soft Machines', artist: 'a2', year: '2024', colors: ['#0b1e3f', '#6a11cb', '#2af598'],
    tracks: [['Low Orbit', 192000], ['Chrome Petals', 167000], ['Satellite Love', 209000], ['Wireframe', 188000]] },
  { id: 'b3', name: 'Lanterns', artist: 'a3', year: '2023', colors: ['#0f3443', '#34e89e', '#f9d423'],
    tracks: [['Paper Lanterns', 214000], ['Fold & Fly', 158000], ['Origami Sky', 199000]] },
  { id: 'b4', name: 'Salt & Sun', artist: 'a4', year: '2025', colors: ['#ff9966', '#ff5e62', '#fff1c1'],
    tracks: [['Tidal', 181000], ['Golden Hour Drive', 236000], ['Seafoam', 172000]] },
  { id: 'b5', name: 'אור של לילה', artist: 'a5', year: '2026', colors: ['#000428', '#004e92', '#9be7ff'],
    tracks: [['אור של לילה', 90000, LRC_HE], ['ים של אנשים', 197000], ['רחוב הפרחים', 205000]] },
  { id: 'b6', name: 'Wildflower Radio', artist: 'a6', year: '2024', colors: ['#2f0743', '#ff9a8b', '#ffd200'],
    tracks: [['Wildflower Radio', 190000], ['Porch Lights', 176000], ['Summer Static', 203000]] },
];

const PLAYLISTS = [
  { id: 'p1', name: 'Late Night Drive', desc: 'Neon, rain and empty highways.', colors: ['#141e30', '#243b55', '#ff5f6d'], tracks: ['t0_0', 't0_3', 't1_0', 't1_2', 't4_0', 't4_2', 't2_1', 't0_4', 't5_1'] },
  { id: 'p2', name: 'Focus Flow', desc: 'Soft textures for deep work.', colors: ['#0f2027', '#203a43', '#2af598'], tracks: ['t1_1', 't1_3', 't2_0', 't2_2', 't3_2', 't5_0'] },
  { id: 'p3', name: 'Hebrew Vibes', desc: 'שירים בעברית לכל מצב רוח', colors: ['#000428', '#004e92', '#ffd200'], tracks: ['t4_0', 't4_1', 't4_2'] },
  { id: 'p4', name: 'Golden Hour', desc: 'Warm songs for the last light.', colors: ['#ff7e5f', '#feb47b', '#fff1c1'], tracks: ['t3_1', 't3_0', 't5_1', 't5_2', 't0_1', 't2_1'] },
  { id: 'p5', name: 'Discover Weekly', desc: 'Your weekly mixtape of fresh music.', owner: 'Spotify', colors: ['#4b6cb7', '#182848', '#a1c4fd'], tracks: ['t2_0', 't3_2', 't1_2', 't5_2'] },
  { id: 'p6', name: 'Daily Mix 1', desc: 'Neon Harbor, Velvet Static and more', owner: 'Spotify', colors: ['#c94b4b', '#4b134f', '#ffb88c'], tracks: ['t0_0', 't1_0', 't0_2', 't1_3'] },
  { id: 'p7', name: 'Gym Energy', desc: 'Push harder.', colors: ['#e65c00', '#f9d423', '#ff512f'], tracks: ['t0_2', 't3_0', 't1_2', 't0_3'] },
  { id: 'p8', name: 'Chill Sunday', desc: 'Slow mornings.', colors: ['#5f2c82', '#49a09d', '#d3cce3'], tracks: ['t2_1', 't5_1', 't3_2', 't4_1'] },
];

const LIKED = ['t0_0', 't4_0', 't1_0', 't3_1', 't2_0', 't5_0', 't0_3', 't1_2', 't4_2', 't3_0', 't5_2', 't0_1', 't2_2', 't1_3'];

function makeCover(colors, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 400;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 400, 400);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  x.fillStyle = g;
  x.fillRect(0, 0, 400, 400);
  let s = seed * 7919 + 13;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 4; i++) {
    const r = 90 + rnd() * 170, cx = rnd() * 400, cy = rnd() * 400;
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, colors[2 + (i % (colors.length - 2))]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = .8;
    x.fillStyle = rg;
    x.fillRect(0, 0, 400, 400);
  }
  x.globalAlpha = 1;
  x.strokeStyle = 'rgba(255,255,255,.32)';
  x.lineWidth = 3;
  const ox = 200 + (rnd() - .5) * 120, oy = 200 + (rnd() - .5) * 120;
  for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(ox, oy, 40 + i * 38, 0, Math.PI * 2); x.stroke(); }
  return c.toDataURL('image/jpeg', .88);
}

function build() {
  const artists = ARTISTS.map((a, i) => {
    const img = makeCover(a.colors, i + 101);
    return { type: 'artist', id: a.id, uri: `spotify:artist:${a.id}`, name: a.name, image: img, imageLarge: img, genres: a.genres };
  });
  const byArtist = Object.fromEntries(artists.map(a => [a.id, a]));
  const tracks = {};
  const albums = ALBUMS.map((al, ai) => {
    const img = makeCover(al.colors, ai + 1);
    const ar = byArtist[al.artist];
    const ref = { id: al.id, uri: `spotify:album:${al.id}`, name: al.name, image: img, imageLarge: img };
    const list = al.tracks.map(([name, duration, lrc], k) => {
      const id = `t${ai}_${k}`;
      const t = {
        type: 'track', id, uri: `spotify:track:${id}`, name, duration, explicit: k === 2,
        artists: [{ id: ar.id, uri: ar.uri, name: ar.name }], album: ref, trackNumber: k + 1,
        isLocal: false, isPlayable: true, lrc: lrc || '',
      };
      tracks[id] = t;
      return t;
    });
    return {
      type: 'album', id: al.id, uri: ref.uri, name: al.name, artists: [{ id: ar.id, uri: ar.uri, name: ar.name }],
      image: img, imageLarge: img, year: al.year, albumType: 'album', total: list.length, tracks: list, ref,
    };
  });
  const playlists = PLAYLISTS.map((p, i) => {
    const img = makeCover(p.colors, i + 51);
    return {
      type: 'playlist', id: p.id, uri: `spotify:playlist:${p.id}`, name: p.name, description: p.desc,
      image: img, imageLarge: img, owner: p.owner || 'You', ownerId: p.owner ? 'spotify' : 'demo',
      total: p.tracks.length, tracks: p.tracks.map(id => tracks[id]), owned: !p.owner,
    };
  });
  return { artists, albums, playlists, tracks, liked: LIKED.map(id => tracks[id]) };
}

export function createMock() {
  const D = build();
  const liked = new Set(LIKED.map(id => `spotify:track:${id}`));
  const devices = [
    { id: 'd1', name: 'Galaxy S25', type: 'Smartphone', active: true },
    { id: 'd2', name: 'Living Room', type: 'Speaker', active: false },
    { id: 'd3', name: 'Desktop PC', type: 'Computer', active: false },
  ];
  const S = {
    list: D.playlists[0].tracks.slice(), idx: 0, playing: true, base: 2500, at: Date.now(),
    shuffle: false, repeat: 'off', context: { uri: D.playlists[0].uri, type: 'playlist' }, device: devices[0],
  };
  const lag = () => sleep(90 + Math.random() * 120);
  const pos = () => S.base + (S.playing ? Date.now() - S.at : 0);

  function settle() {
    let t = S.list[S.idx];
    while (t && S.playing && pos() >= t.duration) {
      const over = pos() - t.duration;
      if (S.repeat === 'track') { S.base = 0; S.at = Date.now() - over; continue; }
      if (S.idx + 1 >= S.list.length) {
        if (S.repeat === 'context') S.idx = 0;
        else { S.playing = false; S.base = t.duration; break; }
      } else S.idx++;
      S.base = 0;
      S.at = Date.now() - over;
      t = S.list[S.idx];
    }
  }
  function contextTracks(uri) {
    const [, type, id] = uri.split(':');
    if (type === 'playlist') return D.playlists.find(p => p.id === id)?.tracks || [];
    if (type === 'album') return D.albums.find(a => a.id === id)?.tracks || [];
    if (type === 'artist') return D.albums.filter(a => a.artists[0].id === id).flatMap(a => a.tracks);
    if (uri.endsWith(':collection')) return D.liked;
    return [];
  }
  const pg = (arr, offset, size = 50) => ({ items: arr.slice(offset, offset + size), next: offset + size < arr.length ? offset + size : null, total: arr.length });
  const find = (arr, q) => arr.filter(x => x.name.toLowerCase().includes(q));
  const trackFromUri = uri => D.tracks[uri.split(':')[2]];

  return {
    async me() { await lag(); return { id: 'demo', name: 'Demo Listener', image: null }; },
    async playlistsPage(o = 0) { await lag(); return pg(D.playlists, o); },
    async likedPage(o = 0) { await lag(); return pg(D.liked.filter(t => liked.has(t.uri)), o); },
    async albumsPage(o = 0) { await lag(); return pg(D.albums.slice(0, 4), o); },
    async followedArtists() { await lag(); return D.artists.slice(0, 5); },
    async recent() {
      await lag();
      const order = [['t0_0', 'p1'], ['t4_0', 'p3'], ['t1_1', null], ['t3_1', 'p4'], ['t2_0', null], ['t5_0', null], ['t0_3', 'p1'], ['t4_1', null]];
      // 40 demo plays spread over the last few days, mostly in the evening
      const hours = [21, 22, 20, 23, 9, 18, 21, 8, 13, 22, 21, 19, 17, 0, 22, 20];
      return Array.from({ length: 40 }, (_, k) => {
        const [id, p] = order[(k * 3 + (k >> 2)) % order.length];
        const d = new Date(Date.now() - Math.floor(k / 6) * 86400000);
        d.setHours(hours[k % hours.length], (k * 7) % 60, 0, 0);
        return {
          track: D.tracks[id],
          context: p ? { uri: `spotify:playlist:${p}`, type: 'playlist' } : { uri: D.tracks[id].album.uri, type: 'album' },
          playedAt: d.toISOString(),
        };
      });
    },
    async topArtists(range = 'short_term') {
      await lag();
      const order = { short_term: [0, 4, 1, 3, 2, 5], medium_term: [4, 0, 2, 1, 5, 3], long_term: [1, 0, 4, 5, 3, 2] }[range] || [0, 1, 2, 3, 4, 5];
      return order.map(i => D.artists[i]);
    },
    async topTracks(range = 'short_term') {
      await lag();
      const ids = ['t0_0', 't4_0', 't1_2', 't3_1', 't0_3', 't2_0', 't5_1', 't4_2', 't0_1', 't1_0', 't3_0', 't5_0'];
      const shift = { short_term: 0, medium_term: 3, long_term: 6 }[range] || 0;
      return ids.slice(shift).concat(ids.slice(0, shift)).map(id => D.tracks[id]);
    },
    async playlist(id) {
      await lag();
      const p = D.playlists.find(x => x.id === id);
      return { ...p, firstPage: p.owned ? pg(p.tracks, 0) : null };
    },
    async playlistItems(id, o) { await lag(); return pg(D.playlists.find(x => x.id === id).tracks, o); },
    async playlistMeta(id) { await lag(); return D.playlists.find(x => x.id === id); },
    async album(id) { await lag(); const a = D.albums.find(x => x.id === id); return { ...a, firstPage: pg(a.tracks, 0) }; },
    async albumTracks(id, o) { await lag(); return pg(D.albums.find(x => x.id === id).tracks, o); },
    async artist(id) { await lag(); return D.artists.find(x => x.id === id); },
    async artistAlbums(id, group) { await lag(); return group === 'album' ? D.albums.filter(a => a.artists[0].id === id) : []; },
    async search(q, offset = 0) {
      await lag();
      q = q.toLowerCase();
      const tr = Object.values(D.tracks).filter(t => t.name.toLowerCase().includes(q) || t.artists[0].name.toLowerCase().includes(q));
      return {
        tracks: tr.slice(offset, offset + 10), tracksNext: offset + 10 < tr.length ? offset + 10 : null,
        artists: find(D.artists, q), albums: find(D.albums, q), playlists: find(D.playlists, q),
      };
    },

    async playback() {
      await lag();
      settle();
      const item = S.list[S.idx];
      if (!item) return null;
      return {
        isPlaying: S.playing, progress: Math.min(pos(), item.duration), item, shuffle: S.shuffle, repeat: S.repeat,
        device: { ...S.device }, context: S.context,
      };
    },
    async queue() { await lag(); settle(); return { current: S.list[S.idx], queue: S.list.slice(S.idx + 1, S.idx + 21) }; },
    async devices() { await lag(); return devices.map(d => ({ ...d, active: d.id === S.device.id })); },
    async play({ contextUri, offsetUri, offsetPosition, uris } = {}) {
      await lag();
      if (contextUri || uris) {
        const list = uris ? uris.map(trackFromUri).filter(Boolean) : contextTracks(contextUri);
        if (!list.length) return;
        let idx = offsetUri ? Math.max(0, list.findIndex(t => t.uri === offsetUri)) : (offsetPosition || 0);
        S.list = list.slice();
        if (S.shuffle) {
          const first = S.list.splice(idx, 1)[0];
          for (let i = S.list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.list[i], S.list[j]] = [S.list[j], S.list[i]]; }
          S.list.unshift(first);
          idx = 0;
        }
        S.idx = Math.min(idx, S.list.length - 1);
        S.context = contextUri ? { uri: contextUri, type: contextUri.endsWith(':collection') ? 'collection' : contextUri.split(':')[1] } : null;
        S.base = 0;
      } else {
        settle();
        S.base = pos();
      }
      S.at = Date.now();
      S.playing = true;
    },
    async pause() { await lag(); settle(); S.base = pos(); S.playing = false; },
    async next() { await lag(); settle(); S.idx = (S.idx + 1) % S.list.length; S.base = 0; S.at = Date.now(); },
    async prev() { await lag(); settle(); S.idx = Math.max(0, S.idx - 1); S.base = 0; S.at = Date.now(); },
    async seek(ms) { await lag(); S.base = ms; S.at = Date.now(); },
    async shuffle(v) { await lag(); S.shuffle = v; },
    async repeat(v) { await lag(); S.repeat = v; },
    async addToQueue(uri) { await lag(); const t = trackFromUri(uri); if (t) S.list.splice(S.idx + 1, 0, t); },
    async transfer(id) { await lag(); S.device = devices.find(d => d.id === id) || S.device; },
    async libraryContains(uris) { await lag(); return uris.map(u => liked.has(u)); },
    async librarySave(uris) { await lag(); uris.forEach(u => liked.add(u)); },
    async libraryRemove(uris) { await lag(); uris.forEach(u => liked.delete(u)); },
  };
}
