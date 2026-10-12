// Stats tab: top artists / songs / albums / genres for a time range, plus minutes,
// plays, most-played songs and a listening clock for the same range.
// Spotify's API has no play counts or minutes: the top lists come from Spotify, the
// minutes from the history Lumen keeps on the device (history.js) — its own saved plays
// plus, if imported, the history from Spotify's "Download your data".
import { $, el, esc, art, icon, artistNames, store, haptic, sleep } from './util.js';
import { sp } from './client.js';
import { player } from './player.js';
import { go } from './nav.js';
import { card, trackRow, markPlaying } from './rows.js';
import { trackActions, itemActions } from './sheets.js';
import { openSheet, closeSheet, toast } from './ui.js';
import { listening } from './history.js';

// Spotify's three windows: ≈4 weeks, ≈6 months, ≈12 months (its "long term" — there is no all-time option)
const RANGES = [['short_term', '4 weeks'], ['medium_term', '6 months'], ['long_term', '12 months']];
const DAYS = { short_term: 28, medium_term: 182, long_term: 365 };
const hourLabel = h => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const fmtDate = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
};
// a saved play → the shape the song rows expect (imported plays may have no link or picture)
const asTrack = x => ({
  type: 'track', id: x.uri?.split(':')[2] || '', uri: x.uri || '', name: x.name, artists: [{ name: x.artist }], album: { image: x.image },
});

/** A song from the saved history as a Spotify track — found by name when the import had no link. */
async function resolveSaved(x) {
  if (x.uri) return asTrack(x);
  try {
    const t = (await sp.search(`${x.name} ${x.artist}`, 0, 'track')).tracks[0];
    if (t) return t;
  } catch { /* shown below */ }
  toast('Couldn’t find that song on Spotify');
  return null;
}

/* ───── import Spotify's "Download your data" ───── */
const PRIVACY_URL = 'https://www.spotify.com/account/privacy/';

function importSheet() {
  const sheet = openSheet(`<div class="sheet-title">Your Spotify history</div>
    <div class="hi-box">
      <div class="hi-status"></div>
      <ol class="hi-steps">
        <li><span>Open <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Spotify’s privacy page</a> and sign in.</span></li>
        <li><span>Under <b>Download your data</b>, tick <b>Account data</b> (your past year, ready in about 5 days) — or <b>Extended streaming history</b> (every year, up to 30 days). Then confirm the email Spotify sends.</span></li>
        <li><span>When Spotify emails that it’s ready, download the ZIP and pick it here.</span></li>
      </ol>
      <input class="hidden" type="file" accept=".zip,.json,application/zip,application/json" multiple>
      <button class="primary-btn hi-pick">Choose the ZIP file</button>
      <div class="hi-progress hidden"></div>
    </div>
    <button class="sheet-item hi-clear hidden">${icon('x')}<span class="si-text">Remove imported history<small>Lumen keeps the plays it saved itself</small></span></button>
    <div class="sheet-note">Your history is read on this device and saved only here — it’s never uploaded anywhere. Lumen also saves every song you play from now on, as long as you open it at least once every ~50 songs.</div>`);
  const input = sheet.querySelector('input'), pick = sheet.querySelector('.hi-pick');
  const progress = sheet.querySelector('.hi-progress'), status = sheet.querySelector('.hi-status'), clear = sheet.querySelector('.hi-clear');
  const paint = () => {
    const m = listening.meta;
    clear.classList.toggle('hidden', !m.importCount);
    status.innerHTML = m.importCount
      ? `<div class="sl-now">${icon('check')}<span>${m.importCount.toLocaleString()} plays imported · ${esc(fmtDate(m.importFrom))} – ${esc(fmtDate(m.importTo))}</span></div>`
      : '';
    pick.textContent = m.importCount ? 'Import a newer file' : 'Choose the ZIP file';
  };
  paint();
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    pick.disabled = true;
    progress.classList.remove('hidden', 'err');
    try {
      const r = await listening.importFiles(files, text => { progress.textContent = text; });
      haptic(12);
      paint();
      progress.textContent = `Done — ${r.count.toLocaleString()} plays from ${fmtDate(r.from)} to ${fmtDate(r.to)}.`;
      toast('Spotify history imported');
    } catch (e) {
      progress.classList.add('err');
      progress.textContent = e.message || 'Couldn’t read that file.';
    }
    pick.disabled = false;
  });
  clear.addEventListener('click', async () => {
    haptic();
    await listening.clearImport();
    toast('Imported history removed');
    closeSheet();
  });
}
const skeleton = '<div class="st-hero"><div class="st-card sk" style="height:210px"></div><div class="st-card sk" style="height:210px"></div></div>'
  + '<div class="sec-h"><h2>Top artists</h2></div><div class="hscroll">' + '<div class="card round"><div class="card-art sk"></div></div>'.repeat(3) + '</div>';

/** Most-played albums: albums that show up most (and highest) among your top songs. */
function topAlbums(tracks) {
  const map = new Map();
  tracks.forEach((t, i) => {
    const a = t.album;
    if (!a?.id) return;
    const e = map.get(a.id) || { type: 'album', id: a.id, uri: a.uri, name: a.name, image: a.image, artists: t.artists, score: 0, count: 0 };
    e.score += tracks.length - i;
    e.count += 1;
    map.set(a.id, e);
  });
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

/** Top genres, weighted by how high each artist ranks. */
function topGenres(artists) {
  const map = new Map();
  artists.forEach((a, i) => (a.genres || []).forEach(g => map.set(g, (map.get(g) || 0) + (artists.length - i))));
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  const list = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = list[0]?.[1] || 1;
  return list.map(([name, v]) => ({ name, share: Math.round((v / total) * 100), width: (v / max) * 100 }));
}

/*
 * Spotify stopped sharing artist genres with Development-Mode apps (2026), so when they're
 * missing we look the artist up on MusicBrainz (free, open; 1 request/second) and keep the
 * result on the device for a month.
 */
const MB_KEY = 'lumen.genres';
const NOT_GENRE = /^(\d{2,4}s?|seen live|favou?rites?|.*vocalists?|singer|songwriter|.*composer|producer|band|duo|legend.*|american|british|english|scottish|irish|welsh|canadian|australian|german|french|swedish|norwegian|finnish|danish|dutch|belgian|italian|spanish|portuguese|brazilian|mexican|argentin.*|japanese|korean|chinese|russian|polish|israeli|hebrew|uk|usa|us|united states|england|london|los angeles|new york|california)$/i;
const cachedGenres = name => {
  const hit = (store(MB_KEY) || {})[name.toLowerCase()];
  return hit && Date.now() - hit.at < 30 * 864e5 ? hit.g : null;
};
async function lookupGenres(name) {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const res = await fetch(`https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=1`);
  if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
  const a = (await res.json()).artists?.[0];
  const g = a && a.score >= 85
    ? (a.tags || []).filter(t => t.count > 0 && !NOT_GENRE.test(t.name.trim())).sort((x, y) => y.count - x.count).slice(0, 4).map(t => t.name)
    : [];
  const cache = store(MB_KEY) || {};
  cache[name.toLowerCase()] = { g, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 400) keys.sort((x, y) => cache[x].at - cache[y].at).slice(0, keys.length - 400).forEach(k => delete cache[k]);
  store(MB_KEY, cache);
  return g;
}

const rankRow = (t, i, extra = '') => trackRow(t, i)
  .replace('>', `><div class="st-num">${i + 1}</div>`)
  .replace('<button class="row-more"', `${extra}<button class="row-more"`);

export function statsView() {
  let range = store('lumen.statsRange') || 'short_term';
  const v = el(`<div class="view stats">
    <header class="page-head"><div><div class="eyebrow">Your listening</div><h1 class="page-title">Stats</h1></div></header>
    <div class="chips st-range">${RANGES.map(([r, l]) => `<button class="chip${r === range ? ' on' : ''}" data-r="${r}">${l}</button>`).join('')}</div>
    <div class="st-top">${skeleton}</div>
    <div class="st-recent"></div></div>`);
  const topEl = $('.st-top', v), recentEl = $('.st-recent', v);
  const cache = {};
  let cur = null, recent = null, recentAt = 0, tipTimer = 0, syncing = false;

  /* ───── top lists for the chosen range ───── */
  async function loadTop() {
    const r = range;
    if (!cache[r]) {
      cache[r] = Promise.all([sp.topArtists(r, 50), sp.topTracks(r, 50)])
        .then(([artists, tracks]) => ({ artists, tracks, albums: topAlbums(tracks), genres: topGenres(artists), all: false }))
        .catch(e => { delete cache[r]; throw e; });
    }
    try {
      const d = await cache[r];
      if (r !== range) return;
      cur = d;
      renderTop();
    } catch (e) {
      if (r === range) topEl.innerHTML = `<div class="empty"><b>Couldn’t load your stats</b>${esc(e.message || '')}</div>`;
    }
  }

  function renderTop() {
    const { artists, tracks, albums, genres } = cur;
    if (!artists.length && !tracks.length) {
      topEl.innerHTML = '<div class="empty"><b>Not enough listening yet</b>Play some more music and check back.</div>';
      return;
    }
    const a1 = artists[0], t1 = tracks[0];
    const songs = cur.all ? tracks : tracks.slice(0, 10);
    topEl.innerHTML = '<div class="st-hero">'
      + (a1 ? `<button class="st-card glass-card" data-k="a1">${art(a1.image, 'st-img round', 'artist')}<div class="st-kicker">#1 artist</div><div class="st-name">${esc(a1.name)}</div>`
        + `<div class="st-sub">${esc((a1.genres || []).slice(0, 2).join(' · ') || 'Artist')}</div></button>` : '')
      + (t1 ? `<button class="st-card glass-card" data-k="t1">${art(t1.album?.image, 'st-img', 'music')}<div class="st-kicker">#1 song</div><div class="st-name">${esc(t1.name)}</div>`
        + `<div class="st-sub">${esc(artistNames(t1))}</div></button>` : '')
      + '</div>'
      + (artists.length ? `<div class="sec-h"><h2>Top artists</h2></div><div class="hscroll" data-k="artists">${artists.slice(0, 20).map((a, i) => card(a, i, '')
        .replace('</div><div class="card-title">', `<span class="st-rank">${i + 1}</span></div><div class="card-title">`)).join('')}</div>` : '')
      + (tracks.length ? `<div class="sec-h"><h2>Top songs</h2>${tracks.length > 10 ? `<button data-k="more">${cur.all ? 'Show less' : `Show all ${tracks.length}`}</button>` : ''}</div>`
        + `<div class="list" data-k="songs">${songs.map((t, i) => rankRow(t, i)).join('')}</div>` : '')
      + (albums.length ? `<div class="sec-h"><h2>Top albums</h2></div><div class="hscroll" data-k="albums">${albums.map((x, i) => card(x, i, `${x.count} top song${x.count > 1 ? 's' : ''}`)).join('')}</div>` : '')
      + '<div class="st-genre-wrap"></div>';
    paintGenres();
    markPlaying(topEl);
    fillGenres(cur);
  }

  function paintGenres() {
    const wrap = $('.st-genre-wrap', topEl);
    if (!wrap || !cur) return;
    const { genres } = cur;
    if (!genres.length) {
      wrap.innerHTML = cur.filling ? '<div class="sec-h"><h2>Top genres</h2></div><div class="st-note">Finding your genres…</div>' : '';
      return;
    }
    wrap.innerHTML = '<div class="sec-h"><h2>Top genres</h2></div><div class="st-genres glass-card">' + genres.map(g => '<div class="st-g">'
      + `<div class="st-g-label"><span>${esc(g.name)}</span><span>${g.share}%</span></div>`
      + `<div class="st-g-track" role="img" aria-label="${esc(g.name)} ${g.share}%"><i style="width:${g.width.toFixed(1)}%"></i></div></div>`).join('') + '</div>';
    const sub = $('[data-k="a1"] .st-sub', topEl);
    const g1 = cur.artists[0]?.genres;
    if (sub && g1?.length) sub.textContent = g1.slice(0, 2).join(' · ');
  }

  /** Fill in genres from MusicBrainz for the top artists, one per second, repainting as they arrive. */
  async function fillGenres(d) {
    if (d.filling || d.filled || d.artists.some(a => a.genres?.length && !a.mb)) return;
    d.filling = true;
    paintGenres();
    for (const a of d.artists.slice(0, 15)) {
      let g = cachedGenres(a.name);
      if (!g) {
        try { g = await lookupGenres(a.name); } catch { g = []; }
        await sleep(1100);
      }
      a.genres = g;
      a.mb = true;
      d.genres = topGenres(d.artists);
      if (cur === d) paintGenres();
    }
    d.filling = false;
    d.filled = true;
    if (cur === d) paintGenres();
  }

  /* ───── listening for the chosen range (from the on-device history) ───── */
  async function loadListening(sync = false) {
    recentAt = Date.now();
    const r = range;
    try {
      if (sync) { syncing = true; await listening.syncRecent(true).finally(() => { syncing = false; }); }
      const s = await listening.summary(DAYS[r]);
      if (r === range) renderListening(s);
    } catch { recentEl.innerHTML = ''; }
  }

  function renderListening(s) {
    const label = RANGES.find(([r]) => r === range)[1];
    const m = listening.meta;
    recent = s;
    s.most = s.topSongs.filter(x => x.n > 1);
    const note = s.covered ? `Your last ${label}`
      : s.from && m.importCount ? `Since ${fmtDate(s.from)} — as far back as your Spotify history goes`
      : s.from ? `Saved since ${fmtDate(s.from)} — Lumen adds every play from now on`
      : 'Nothing saved yet — Lumen starts saving your plays from now on';
    const tile = (n, text) => `<div class="st-tile glass-card"><b>${n.toLocaleString()}</b><span>${text}</span></div>`;
    const max = Math.max(...s.hours, 1);
    const peak = s.hours.indexOf(Math.max(...s.hours));
    const maxMin = Math.max(...s.topArtists.map(a => a.minutes), 1);
    recentEl.innerHTML = `<div class="sec-h"><h2>Your listening</h2></div><div class="st-note">${esc(note)}</div>`
      + `<div class="st-tiles">${tile(s.minutes, 'minutes listened')}${tile(s.plays, 'plays')}${tile(s.songs, 'different songs')}${tile(s.artists, 'different artists')}</div>`
      + (m.importCount
        ? `<button class="st-import-line" data-k="import">${icon('check')}Includes your Spotify history until ${esc(fmtDate(m.importTo))} · Manage</button>`
        : `<button class="st-import glass-card" data-k="import"><b>See your real minutes for the whole year</b><span>Import your history from Spotify — it stays on this device</span>${icon('chevRight')}</button>`)
      + (s.topArtists.length ? `<div class="sec-h"><h2>Most listened artists</h2></div><div class="st-genres st-mins glass-card">${s.topArtists.map(a => '<div class="st-g">'
        + `<div class="st-g-label"><span>${esc(a.name)}</span><span>${a.minutes.toLocaleString()} min</span></div>`
        + `<div class="st-g-track" role="img" aria-label="${esc(a.name)} ${a.minutes} minutes"><i style="width:${(a.minutes / maxMin * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>` : '')
      + (s.most.length ? `<div class="sec-h"><h2>Most played</h2></div><div class="list" data-k="most">${s.most.map((x, i) => rankRow(asTrack(x), i, `<span class="st-plays">${x.n}×</span>`)).join('')}</div>` : '')
      + (s.plays ? `<div class="sec-h"><h2>Listening clock</h2></div><div class="st-clock glass-card">`
        + `<div class="st-clock-head">You listen most around <b>${hourLabel(peak)}</b></div>`
        + `<div class="st-bars">${s.hours.map((c, h) => `<button class="st-bar${c ? '' : ' zero'}${h === peak ? ' peak' : ''}" data-h="${h}" data-c="${c}" style="--v:${(c / max).toFixed(3)}" aria-label="${hourLabel(h)}: ${c} plays"><i></i></button>`).join('')}</div>`
        + '<div class="st-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span></div>'
        + '<div class="st-tip hidden"></div></div>' : '');
    markPlaying(recentEl);
  }
  const unsub = listening.on(() => {
    if (!v.isConnected) unsub();
    else if (!syncing) loadListening();
  });

  /* ───── interactions ───── */
  v.querySelector('.st-range').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c || c.dataset.r === range) return;
    haptic();
    range = c.dataset.r;
    store('lumen.statsRange', range);
    v.querySelectorAll('.st-range .chip').forEach(x => x.classList.toggle('on', x === c));
    topEl.innerHTML = skeleton;
    loadTop();
    loadListening();
  });

  topEl.addEventListener('click', e => {
    if (!cur) return;
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'a1') { haptic(); go(`artist/${cur.artists[0].id}`); return; }
    if (k === 't1') { haptic(); player.playUris(cur.tracks, 0); return; }
    if (k === 'more') { cur.all = !cur.all; renderTop(); return; }
    const c = e.target.closest('.card');
    if (c) {
      haptic();
      const list = c.parentElement.dataset.k === 'artists' ? cur.artists : cur.albums;
      const x = list[Number(c.dataset.i)];
      if (x) go(`${x.type}/${x.id}`);
      return;
    }
    const row = e.target.closest('.row.track');
    if (row) {
      const t = cur.tracks[Number(row.dataset.i)];
      if (e.target.closest('.row-more')) trackActions(t); else { haptic(); player.playUris(cur.tracks, Number(row.dataset.i)); }
    }
  });
  topEl.addEventListener('contextmenu', e => {
    if (!cur) return;
    const c = e.target.closest('.card'), row = e.target.closest('.row.track');
    if (!c && !row) return;
    e.preventDefault();
    if (row) trackActions(cur.tracks[Number(row.dataset.i)]);
    else itemActions((c.parentElement.dataset.k === 'artists' ? cur.artists : cur.albums)[Number(c.dataset.i)]);
  });

  recentEl.addEventListener('click', e => {
    const bar = e.target.closest('.st-bar');
    if (bar) {
      const tip = $('.st-tip', recentEl);
      recentEl.querySelectorAll('.st-bar.sel').forEach(b => b.classList.remove('sel'));
      bar.classList.add('sel');
      const n = Number(bar.dataset.c);
      tip.textContent = `${hourLabel(Number(bar.dataset.h))} · ${n} play${n === 1 ? '' : 's'}`;
      tip.classList.remove('hidden');
      const box = bar.closest('.st-clock').getBoundingClientRect(), b = bar.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(b.left - box.left + b.width / 2, 40), box.width - 40)}px`;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => { tip.classList.add('hidden'); bar.classList.remove('sel'); }, 2500);
      return;
    }
    if (e.target.closest('[data-k="import"]')) { haptic(); importSheet(); return; }
    const row = e.target.closest('.row.track');
    if (row && recent?.most) {
      const x = recent.most[Number(row.dataset.i)];
      if (!x) return;
      const more = e.target.closest('.row-more');
      if (!more) haptic();
      resolveSaved(x).then(t => { if (t) { if (more) trackActions(t); else player.playUris([t]); } });
    }
  });

  loadTop();
  loadListening(true);
  return { el: v, onShow() { if (Date.now() - recentAt > 2 * 60_000) loadListening(true); } };
}
