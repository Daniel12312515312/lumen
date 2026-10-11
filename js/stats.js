// Stats tab: top artists / songs / albums / genres for a time range, plus what the
// last 50 plays say (time listened, variety, what's on repeat, and a listening clock).
// Spotify's API has no play counts or minutes, so everything here is derived from
// the top lists and the recently-played history.
import { $, el, esc, art, artistNames, store, haptic, sleep } from './util.js';
import { sp } from './client.js';
import { player } from './player.js';
import { go } from './nav.js';
import { card, trackRow, markPlaying } from './rows.js';
import { trackActions, itemActions } from './sheets.js';

const RANGES = [['short_term', '4 weeks'], ['medium_term', '6 months'], ['long_term', 'All time']];
const hourLabel = h => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
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
  let cur = null, recent = null, recentAt = 0, tipTimer = 0;

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
        .replace('<div class="card-title">', `<span class="st-rank">${i + 1}</span><div class="card-title">`)).join('')}</div>` : '')
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

  /* ───── last 50 plays ───── */
  async function loadRecent() {
    recentAt = Date.now();
    try {
      recent = await sp.recent();
      renderRecent();
    } catch { recentEl.innerHTML = ''; }
  }

  function renderRecent() {
    const list = recent || [];
    if (!list.length) { recentEl.innerHTML = ''; return; }
    const minutes = Math.round(list.reduce((s, x) => s + (x.track.duration || 0), 0) / 60000);
    const songs = new Set(list.map(x => x.track.id)).size;
    const artists = new Set(list.flatMap(x => x.track.artists.map(a => a.id || a.name))).size;
    const times = list.map(x => Date.parse(x.playedAt)).filter(Number.isFinite);
    const days = times.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...times)) / 86400000)) : 0;
    const counts = new Map();
    list.forEach(x => { const e = counts.get(x.track.id) || { track: x.track, n: 0 }; e.n += 1; counts.set(x.track.id, e); });
    const most = [...counts.values()].filter(e => e.n > 1).sort((a, b) => b.n - a.n).slice(0, 5);
    const hours = Array(24).fill(0);
    times.forEach(t => { hours[new Date(t).getHours()] += 1; });
    const max = Math.max(...hours, 1);
    const peak = hours.indexOf(Math.max(...hours));
    recent.most = most;

    const tile = (n, label) => `<div class="st-tile glass-card"><b>${n}</b><span>${label}</span></div>`;
    recentEl.innerHTML = `<div class="sec-h"><h2>Recent listening</h2></div>`
      + `<div class="st-note">From your last ${list.length} plays${days ? ` · about ${days === 1 ? 'the last day' : `the last ${days} days`}` : ''}</div>`
      + `<div class="st-tiles">${tile(minutes, 'minutes listened')}${tile(list.length, 'plays')}${tile(songs, 'different songs')}${tile(artists, 'different artists')}</div>`
      + (most.length ? `<div class="sec-h"><h2>On repeat lately</h2></div><div class="list" data-k="most">${most.map((e, i) => rankRow(e.track, i, `<span class="st-plays">${e.n}×</span>`)).join('')}</div>` : '')
      + (times.length ? `<div class="sec-h"><h2>Listening clock</h2></div><div class="st-clock glass-card">`
        + `<div class="st-clock-head">You listen most around <b>${hourLabel(peak)}</b></div>`
        + `<div class="st-bars">${hours.map((c, h) => `<button class="st-bar${c ? '' : ' zero'}${h === peak ? ' peak' : ''}" data-h="${h}" data-c="${c}" style="--v:${(c / max).toFixed(3)}" aria-label="${hourLabel(h)}: ${c} plays"><i></i></button>`).join('')}</div>`
        + '<div class="st-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span></div>'
        + '<div class="st-tip hidden"></div></div>' : '');
    markPlaying(recentEl);
  }

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
    const row = e.target.closest('.row.track');
    if (row && recent?.most) {
      const t = recent.most[Number(row.dataset.i)]?.track;
      if (!t) return;
      if (e.target.closest('.row-more')) { trackActions(t); return; }
      haptic();
      if (t.album?.uri) player.playContext(t.album.uri, { offsetUri: t.uri, track: t }); else player.playUris([t]);
    }
  });

  loadTop();
  loadRecent();
  return { el: v, onShow() { if (Date.now() - recentAt > 5 * 60_000) loadRecent(); } };
}
