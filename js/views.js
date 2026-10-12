// Home, Search, Library and the playlist / album / liked / artist pages.
import { $, el, esc, icon, art, artistNames, greeting, debounce, store, haptic, fmtLong } from './util.js';
import { sp, isDemo } from './client.js';
import { player } from './player.js';
import { go, back } from './nav.js';
import { lib } from './lib.js';
import { trackRow, itemRow, card, itemArt, markPlaying } from './rows.js';
import { trackActions, settingsSheet, itemActions, homeEditor } from './sheets.js';
import { pins } from './pins.js';
import { statsView } from './stats.js';
import { toast } from './ui.js';
import { mountInstall } from './install.js';

export function createView(r) {
  switch (r.type) {
    case 'playlist': return collectionView('playlist', r.id);
    case 'album': return collectionView('album', r.id);
    case 'liked': return collectionView('liked');
    case 'artist': return artistView(r.id);
    default: return { home: homeView, search: searchView, library: libraryView, stats: statsView }[r.tab]();
  }
}

/* ───────── shared helpers ───────── */
const spinner = '<div class="list-foot"><div class="spinner"></div></div>';
const skRows = n => Array.from({ length: n }, () => '<div class="row"><div class="row-art sk"></div><div class="row-text"><div class="sk sk-line" style="width:62%"></div><div class="sk sk-line" style="width:38%;margin-top:8px"></div></div></div>').join('');
const skCards = n => `<div class="hscroll">${Array.from({ length: n }, () => '<div class="card"><div class="card-art sk"></div><div class="sk sk-line" style="width:80%;margin-top:10px"></div></div>').join('')}</div>`;
const errorBox = msg => `<div class="empty"><b>Something went wrong</b>${esc(msg || 'Couldn’t reach Spotify.')}<br><button class="more-btn" data-retry style="margin-top:14px">Try again</button></div>`;

function openItem(x) {
  if (!x) return;
  if (x.type === 'liked') go('liked');
  else if (x.type === 'playlist' || x.type === 'album' || x.type === 'artist') go(`${x.type}/${x.id}`);
}

/** Wire click / long-press on a list of track rows. */
function wireTracks(container, getTracks, onPlay) {
  container.addEventListener('click', e => {
    const row = e.target.closest('.row.track');
    if (!row || !container.contains(row)) return;
    const t = getTracks(row)[Number(row.dataset.i)];
    if (!t) return;
    if (e.target.closest('.row-more')) { trackActions(t); return; }
    haptic();
    onPlay(Number(row.dataset.i), t, row);
  });
  container.addEventListener('contextmenu', e => {
    const row = e.target.closest('.row.track');
    if (!row) return;
    e.preventDefault();
    const t = getTracks(row)[Number(row.dataset.i)];
    if (t) { haptic(12); trackActions(t); }
  });
}

/** Pin-to-Home toggle in a page's top bar. */
function wirePin(btn, item) {
  const paint = () => {
    const on = pins.isPinned(item.uri);
    btn.innerHTML = icon(on ? 'pinFill' : 'pin');
    btn.classList.toggle('on', on);
  };
  btn.classList.remove('hidden');
  paint();
  pins.on(paint);
  btn.addEventListener('click', () => {
    haptic();
    if (pins.isPinned(item.uri)) { pins.unpin(item.uri); toast('Removed from Home'); } else { pins.pin(item); toast('Pinned to Home'); }
  });
}

function wireTopbar(v, threshold = 190) {
  const bar = $('.topbar', v);
  $('.back', v).onclick = () => back();
  v.addEventListener('scroll', () => bar.classList.toggle('solid', v.scrollTop > threshold), { passive: true });
}

function playTrackInContext(t) {
  if (t.album?.uri) player.playContext(t.album.uri, { offsetUri: t.uri, track: t });
  else player.playUris([t]);
}

/* ───────── Home ───────── */
function homeView() {
  const v = el(`<div class="view home">
    <header class="page-head"><h1 class="page-title">${greeting()}</h1>
      <div class="head-actions"><button class="icon-btn home-edit" aria-label="Edit Home screen">${icon('pencil')}</button>
      <button class="avatar" aria-label="Settings">${icon('settings')}</button></div></header>
    <div class="install-slot"></div>
    <div class="home-body"><div class="shortcuts">${'<div class="shortcut sk"></div>'.repeat(8)}</div>
      <div class="sec-h"><h2>Recently played</h2></div>${skCards(4)}</div></div>`);
  const body = $('.home-body', v);
  const avatar = $('.avatar', v);
  mountInstall($('.install-slot', v));
  avatar.onclick = () => settingsSheet();
  $('.home-edit', v).onclick = () => { haptic(); homeEditor(); };
  let data = null, loadedAt = 0;

  async function load() {
    loadedAt = Date.now();
    const [me, recent, topA, pls] = await Promise.allSettled([lib.me(), sp.recent(), sp.topArtists(), lib.playlists()]);
    if (me.value) {
      player.me = me.value;
      avatar.innerHTML = me.value.image ? `<img src="${esc(me.value.image)}" alt="">` : esc(me.value.name.slice(0, 1).toUpperCase());
    }
    if ([recent, topA, pls].every(r => r.status === 'rejected')) {
      body.innerHTML = errorBox(recent.reason?.message);
      body.querySelector('[data-retry]').onclick = load;
      return;
    }
    const R = recent.value || [];
    const seen = new Set();
    const recentTracks = R.filter(x => !seen.has(x.track.id) && seen.add(x.track.id)).slice(0, 14);
    data = {
      auto: await buildShortcuts(R, pls.value || []),
      recent: recentTracks,
      artists: topA.value || [],
    };
    render();
  }

  /** Liked Songs (if shown) + pinned items, or the automatic picks until something is pinned. */
  function shortcuts() {
    const liked = pins.showLiked ? [{ type: 'liked', name: 'Liked Songs' }] : [];
    if (pins.custom) return [...liked, ...pins.list];
    pins.auto = data.auto.slice(0, 8 - liked.length); // what you see is what the first pin keeps
    return [...liked, ...pins.auto];
  }

  function renderShortcuts() {
    const wrap = $('.sc-wrap', body);
    if (!wrap) return;
    data.shortcuts = shortcuts();
    wrap.innerHTML = data.shortcuts.length
      ? `<div class="shortcuts">${data.shortcuts.map((s, i) => `<button class="shortcut" data-i="${i}">${itemArt(s, 'sc-art')}<span>${esc(s.name)}</span></button>`).join('')}</div>`
      : `<button class="note-card glass-card sc-empty">Pin albums, playlists or artists here — tap <b>Edit</b> or long-press any of them.</button>`;
  }

  function render() {
    const d = data;
    body.innerHTML = `<div class="sc-wrap"></div>`
      + (d.recent.length ? `<div class="sec-h"><h2>Recently played</h2></div><div class="hscroll" data-k="recent">${d.recent.map((x, i) => card({ ...x.track, image: x.track.album.image }, i, artistNames(x.track))).join('')}</div>` : '')
      + (d.artists.length ? `<div class="sec-h"><h2>Your top artists</h2></div><div class="hscroll" data-k="artists">${d.artists.slice(0, 12).map((a, i) => card(a, i, '')).join('')}</div>` : '');
    renderShortcuts();
    markPlaying(body);
  }
  pins.on(() => { if (data) renderShortcuts(); });

  body.addEventListener('click', e => {
    if (!data) return;
    if (e.target.closest('.sc-empty')) { haptic(); homeEditor(); return; }
    const sc = e.target.closest('.shortcut');
    if (sc) { haptic(); openItem(data.shortcuts[Number(sc.dataset.i)]); return; }
    const c = e.target.closest('.card');
    if (c) {
      const k = c.parentElement.dataset.k, i = Number(c.dataset.i);
      haptic();
      if (k === 'artists') openItem(data.artists[i]);
      if (k === 'recent') {
        const { track, context } = data.recent[i];
        if (context?.uri && (context.type === 'playlist' || context.type === 'album')) player.playContext(context.uri, { offsetUri: track.uri, track });
        else playTrackInContext(track);
      }
    }
  });
  body.addEventListener('contextmenu', e => {
    if (!data) return;
    const sc = e.target.closest('.shortcut');
    const c = e.target.closest('.card');
    if (!sc && !c) return;
    e.preventDefault();
    if (sc) { itemActions(data.shortcuts[Number(sc.dataset.i)]); return; }
    const k = c.parentElement.dataset.k, i = Number(c.dataset.i);
    if (k === 'recent') trackActions(data.recent[i].track);
    if (k === 'artists') itemActions(data.artists[i]);
  });

  load();
  return { el: v, onShow() { if (Date.now() - loadedAt > 5 * 60_000) load(); } };
}

async function buildShortcuts(R, PL) {
  const out = [];
  const seen = new Set();
  let lookups = 0;
  for (const { track, context } of R) {
    if (out.length >= 8) break;
    const uri = context?.uri;
    if (!uri || seen.has(uri) || uri.endsWith(':collection')) continue;
    seen.add(uri);
    const [, type, id] = uri.split(':');
    if (type === 'album') out.push({ type: 'album', id, uri, name: track.album.name, image: track.album.image, artists: track.artists });
    else if (type === 'playlist') {
      let p = PL.find(x => x.id === id);
      if (!p && lookups < 3) { lookups++; p = await sp.playlistMeta(id).catch(() => null); }
      if (p) out.push(p);
    } else if (type === 'artist' && lookups < 3) {
      lookups++;
      const a = await sp.artist(id).catch(() => null);
      if (a) out.push(a);
    }
  }
  for (const p of PL) {
    if (out.length >= 8) break;
    if (!out.some(x => x.id === p.id)) out.push(p);
  }
  return out;
}

/* ───────── Search ───────── */
function searchView() {
  const v = el(`<div class="view search has-topbar">
    <h1 class="page-title search-title">Search</h1>
    <div class="search-head"><label class="search-box">${icon('search')}
      <input type="search" placeholder="Songs, artists, albums…" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="clear hidden" aria-label="Clear">${icon('x')}</button></label></div>
    <div class="search-body"></div></div>`);
  const input = $('input', v), clear = $('.clear', v), body = $('.search-body', v), head = $('.search-head', v);
  const RKEY = 'lumen.recentSearch';
  let q = '', res = null, seq = 0, recents = store(RKEY) || [];

  function remember(x) {
    const slim = x.type === 'track' ? x : { type: x.type, id: x.id, uri: x.uri, name: x.name, image: x.image, owner: x.owner, artists: x.artists };
    recents = [slim, ...recents.filter(r => r.uri !== x.uri)].slice(0, 12);
    store(RKEY, recents);
  }

  function renderRecent() {
    if (!recents.length) {
      body.innerHTML = `<div class="empty"><b>Find your music</b>Search for songs, artists, albums and playlists.</div>`;
      return;
    }
    body.innerHTML = `<div class="recent-h"><h2>Recent</h2><button data-k="clear">Clear</button></div><div class="list" data-k="recent">`
      + recents.map((x, i) => (x.type === 'track' ? trackRow(x, i) : itemRow(x, i))).join('') + '</div>';
    markPlaying(body);
  }

  function pickTop() {
    const nq = q.toLowerCase();
    const a = res.artists[0];
    if (a && (a.name.toLowerCase() === nq || !res.tracks.length)) return a;
    return res.tracks[0] || a || null;
  }

  function renderResults() {
    const { tracks, artists, albums, playlists } = res;
    if (!tracks.length && !artists.length && !albums.length && !playlists.length) {
      body.innerHTML = '<div class="empty"><b>No results</b>Try a different spelling or another search.</div>';
      return;
    }
    const top = pickTop();
    res.top = top;
    body.innerHTML = (top ? `<div class="sec-h"><h2>Top result</h2></div><button class="top-result glass-card" data-k="top">`
        + art(top.image || top.album?.image, 'tr-art' + (top.type === 'artist' ? ' round' : ''), top.type === 'artist' ? 'artist' : 'music')
        + `<div style="min-width:0"><div class="tr-name">${esc(top.name)}</div><div class="tr-type">${top.type === 'artist' ? 'Artist' : `Song · ${esc(artistNames(top))}`}</div></div></button>` : '')
      + (tracks.length ? `<div class="sec-h"><h2>Songs</h2></div><div class="list" data-k="songs">${tracks.map((t, i) => trackRow(t, i)).join('')}</div>`
        + (res.tracksNext ? '<button class="more-btn" data-k="more">More songs</button>' : '') : '')
      + (artists.length ? `<div class="sec-h"><h2>Artists</h2></div><div class="hscroll" data-k="artists">${artists.map((a, i) => card(a, i, 'Artist')).join('')}</div>` : '')
      + (albums.length ? `<div class="sec-h"><h2>Albums</h2></div><div class="hscroll" data-k="albums">${albums.map((a, i) => card(a, i, [a.year, artistNames(a)].filter(Boolean).join(' · '))).join('')}</div>` : '')
      + (playlists.length ? `<div class="sec-h"><h2>Playlists</h2></div><div class="hscroll" data-k="playlists">${playlists.map((p, i) => card(p, i, p.owner)).join('')}</div>` : '');
    markPlaying(body);
  }

  const run = debounce(async () => {
    const my = ++seq;
    if (!q) { renderRecent(); return; }
    body.innerHTML = spinner;
    try {
      const r = await sp.search(q);
      if (my !== seq) return;
      res = r;
      renderResults();
    } catch (e) {
      if (my === seq) body.innerHTML = errorBox(e.message);
    }
  }, 320);

  input.addEventListener('input', () => {
    q = input.value.trim();
    clear.classList.toggle('hidden', !input.value);
    run();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  clear.addEventListener('click', e => {
    e.preventDefault();
    input.value = '';
    q = '';
    clear.classList.add('hidden');
    renderRecent();
    input.focus();
  });
  v.addEventListener('scroll', () => head.classList.toggle('solid', v.scrollTop > 60), { passive: true });
  v.addEventListener('touchmove', () => { if (document.activeElement === input) input.blur(); }, { passive: true });

  body.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'clear') { recents = []; store(RKEY, recents); renderRecent(); return; }
    if (k === 'more') {
      const btn = e.target.closest('[data-k="more"]');
      btn.disabled = true;
      try {
        const more = await sp.search(q, res.tracksNext, 'track');
        const start = res.tracks.length;
        res.tracks.push(...more.tracks);
        res.tracksNext = more.tracksNext;
        $('[data-k="songs"]', body).insertAdjacentHTML('beforeend', more.tracks.map((t, i) => trackRow(t, start + i)).join(''));
        markPlaying(body);
        if (res.tracksNext == null) btn.remove(); else btn.disabled = false;
      } catch { btn.disabled = false; toast('Couldn’t load more'); }
      return;
    }
    if (k === 'top') {
      haptic();
      remember(res.top);
      if (res.top.type === 'artist') openItem(res.top); else playTrackInContext(res.top);
      return;
    }
    const c = e.target.closest('.card');
    if (c) {
      const list = res[c.parentElement.dataset.k];
      const x = list?.[Number(c.dataset.i)];
      if (x) { haptic(); remember(x); openItem(x); }
      return;
    }
    const item = e.target.closest('.row.item');
    if (item && item.parentElement.dataset.k === 'recent') { haptic(); openItem(recents[Number(item.dataset.i)]); }
  });
  body.addEventListener('contextmenu', e => {
    const c = e.target.closest('.card');
    const item = e.target.closest('.row.item');
    const top = e.target.closest('[data-k="top"]');
    let x = null;
    if (c) x = res?.[c.parentElement.dataset.k]?.[Number(c.dataset.i)];
    else if (item && item.parentElement.dataset.k === 'recent') x = recents[Number(item.dataset.i)];
    else if (top && res?.top?.type === 'artist') x = res.top;
    if (!x) return;
    e.preventDefault();
    itemActions(x);
  });
  wireTracks(body, row => (row.parentElement.dataset.k === 'recent' ? recents : res?.tracks || []), (i, t) => {
    remember(t);
    playTrackInContext(t);
  });

  renderRecent();
  return { el: v, onShow() { if (!q) renderRecent(); } };
}

/* ───────── Library ───────── */
function libraryView() {
  const v = el(`<div class="view library">
    <header class="page-head"><h1 class="page-title">Library</h1></header>
    <div class="chips"><button class="chip" data-f="playlist">Playlists</button><button class="chip" data-f="album">Albums</button><button class="chip" data-f="artist">Artists</button></div>
    <div class="lib-list">${skRows(9)}</div></div>`);
  const list = $('.lib-list', v);
  let filter = store('lumen.libFilter') || null, items = null, shown = [], loadedAt = 0;

  async function load() {
    loadedAt = Date.now();
    const [pl, al, ar] = await Promise.allSettled([lib.playlists(), lib.albums(), lib.artists()]);
    if ([pl, al, ar].every(r => r.status === 'rejected')) {
      list.innerHTML = errorBox(pl.reason?.message);
      list.querySelector('[data-retry]').onclick = load;
      return;
    }
    items = [{ type: 'liked', name: 'Liked Songs' }, ...(pl.value || []), ...(al.value || []), ...(ar.value || [])];
    render();
  }
  function render() {
    v.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.f === filter));
    if (!items) return;
    shown = items.filter(x => !filter || x.type === filter || (filter === 'playlist' && x.type === 'liked'));
    list.innerHTML = shown.length ? shown.map((x, i) => itemRow(x, i)).join('') : '<div class="empty">Nothing here yet.</div>';
  }
  v.querySelector('.chips').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    haptic();
    filter = filter === c.dataset.f ? null : c.dataset.f;
    store('lumen.libFilter', filter);
    render();
    v.scrollTo({ top: 0 });
  });
  list.addEventListener('click', e => {
    const row = e.target.closest('.row.item');
    if (row) { haptic(); openItem(shown[Number(row.dataset.i)]); }
  });
  list.addEventListener('contextmenu', e => {
    const row = e.target.closest('.row.item');
    if (!row) return;
    e.preventDefault();
    itemActions(shown[Number(row.dataset.i)]);
  });

  render();
  load();
  return { el: v, onShow() { if (Date.now() - loadedAt > 10 * 60_000) { lib.invalidate(); load(); } } };
}

/* ───────── Playlist / Album / Liked Songs ───────── */
function collectionView(kind, id) {
  const v = el(`<div class="view coll has-topbar">
    <div class="topbar"><button class="icon-btn back" aria-label="Back">${icon('chevLeft')}</button><div class="topbar-title"></div><span class="topbar-gap"></span></div>
    <div class="ch">
      <div class="ch-bg"></div>
      <div class="ch-top"><div class="ch-art sk"></div><div class="ch-info"><div class="sk sk-line" style="width:40%"></div>
        <div class="sk sk-line" style="width:85%;height:24px;margin-top:10px"></div><div class="sk sk-line" style="width:60%;margin-top:10px"></div></div></div>
      <div class="ch-desc hidden"></div>
      <div class="ch-actions"></div>
    </div>
    <div class="tracklist">${skRows(6)}</div><div class="list-foot"></div></div>`);
  wireTopbar(v, 200);
  const head = $('.ch', v), list = $('.tracklist', v), foot = $('.list-foot', v);
  let info = null, tracks = [], next = null, pager = null, loading = false, saved = false;

  async function load() {
    try {
      if (kind === 'liked') {
        const p = await sp.likedPage(0);
        info = { type: 'liked', name: 'Liked Songs', total: p.total };
        tracks = p.items; next = p.next;
        pager = o => sp.likedPage(o);
      } else if (kind === 'playlist') {
        info = await sp.playlist(id);
        if (info.firstPage) { tracks = info.firstPage.items; next = info.firstPage.next; pager = o => sp.playlistItems(id, o); }
      } else {
        info = await sp.album(id);
        tracks = info.firstPage.items; next = info.firstPage.next;
        pager = o => sp.albumTracks(id, o, info.ref || info);
      }
    } catch (e) {
      $('.ch-top', v).innerHTML = '';
      list.innerHTML = errorBox(e.message);
      list.querySelector('[data-retry]').onclick = () => { list.innerHTML = skRows(6); load(); };
      return;
    }
    renderHead();
    if (kind !== 'liked') wirePin($('[data-a="pin"]', head), info);
    if (kind === 'playlist' && !info.firstPage) {
      list.innerHTML = '<div class="note-card glass-card"><b>Song list not available</b><br>Spotify only lets apps show the songs of playlists you created. You can still play or shuffle this playlist.</div>';
    } else {
      list.innerHTML = tracks.map((t, i) => trackRow(t, i, { num: kind === 'album' })).join('') || '<div class="empty">No songs yet.</div>';
      markPlaying(list);
    }
    if (kind === 'album') sp.libraryContains([info.uri]).then(([v2]) => { saved = !!v2; paintSave(); }).catch(() => {});
    observe();
  }

  /** Header: blurred cover behind, cover + title on the left, round play button + icons below. */
  function renderHead() {
    const count = info.total ?? tracks.length;
    const minutes = count && tracks.length >= count ? fmtLong(tracks.reduce((s, t) => s + (t.duration || 0), 0)) : '';
    const kindLabel = kind === 'album' ? ({ single: 'Single', compilation: 'Compilation' }[info.albumType] || 'Album') : 'Playlist';
    const by = kind === 'album' ? artistNames(info) : kind === 'playlist' ? info.owner : (player.me?.name || '');
    const meta = [by ? `<b class="ch-by">${esc(by)}</b>` : '', kind === 'album' ? esc(info.year || '') : '',
      count != null ? `${count} song${count === 1 ? '' : 's'}` : '', minutes].filter(Boolean).join(' · ');
    const cover = info.imageLarge || info.image;
    $('.ch-bg', v).innerHTML = kind === 'liked' ? '<div class="liked-bg"></div>' : (cover ? `<img src="${esc(cover)}" alt="">` : '');
    $('.ch-top', v).innerHTML = (kind === 'liked' ? `<div class="ch-art liked-art">${icon('heartFill')}</div>` : art(cover, 'ch-art'))
      + `<div class="ch-info"><div class="ch-kind">${kindLabel}</div><h1>${esc(info.name)}</h1><div class="ch-meta">${meta}</div></div>`;
    const desc = $('.ch-desc', v);
    desc.textContent = info.description || '';
    desc.classList.toggle('hidden', !info.description);
    $('.ch-actions', v).innerHTML = `<button class="ch-play" data-a="play" aria-label="Play">${icon('play')}</button>`
      + `<button class="icon-btn" data-a="shuffle" aria-label="Shuffle">${icon('shuffle')}</button>`
      + (kind === 'album' ? `<button class="icon-btn" data-a="save" aria-label="Save to library">${icon('heart')}</button>` : '')
      + (kind !== 'liked' ? `<button class="icon-btn" data-a="pin" aria-label="Pin to Home">${icon('pin')}</button>` : '');
    $('.topbar-title', v).textContent = info.name;
  }

  function paintSave() {
    const b = $('[data-a="save"]', head);
    if (!b) return;
    b.innerHTML = icon(saved ? 'heartFill' : 'heart');
    b.classList.toggle('on', saved);
  }

  async function toggleSave() {
    haptic();
    saved = !saved;
    paintSave();
    try {
      if (saved) await sp.librarySave([info.uri]); else await sp.libraryRemove([info.uri]);
      toast(saved ? 'Saved to your library' : 'Removed from your library');
      lib.invalidate('al');
    } catch (err) { saved = !saved; paintSave(); player.handleError(err); }
  }

  function play(shuffle) {
    haptic();
    const total = info.total ?? tracks.length;
    const rnd = total ? Math.floor(Math.random() * Math.min(total, tracks.length || total)) : 0;
    if (kind === 'liked') { if (tracks.length) player.playLiked(tracks, shuffle ? rnd : 0, shuffle); return; }
    player.playContext(info.uri, {
      offsetPosition: shuffle ? (total ? rnd : undefined) : 0,
      track: shuffle ? tracks[rnd] : tracks[0],
      shuffle,
    });
  }

  head.addEventListener('click', e => {
    if (!info) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') play(false);
    if (a === 'shuffle') play(true);
    if (a === 'save') toggleSave();
    if (e.target.closest('.ch-by') && kind === 'album' && info.artists?.[0]?.id) go(`artist/${info.artists[0].id}`);
  });
  wireTracks(list, () => tracks, (i, t) => {
    if (kind === 'liked') player.playLiked(tracks, i);
    else player.playContext(info.uri, { offsetUri: t.uri, track: t });
  });

  function observe() {
    if (next == null || !pager) return;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || loading || next == null) return;
      loading = true;
      foot.innerHTML = '<div class="spinner"></div>';
      try {
        const p = await pager(next);
        const start = tracks.length;
        tracks.push(...p.items);
        next = p.next;
        list.insertAdjacentHTML('beforeend', p.items.map((t, i) => trackRow(t, start + i, { num: kind === 'album' })).join(''));
        markPlaying(list);
      } catch { next = null; }
      foot.innerHTML = '';
      loading = false;
      if (next == null) io.disconnect();
    }, { root: v, rootMargin: '700px' });
    io.observe(foot);
  }

  load();
  return { el: v };
}

/* ───────── Artist ───────── */
function artistView(id) {
  const v = el(`<div class="view artist has-topbar">
    <div class="topbar"><button class="icon-btn back" aria-label="Back">${icon('chevLeft')}</button><div class="topbar-title"></div>
      <button class="icon-btn pinb" style="visibility:hidden" aria-label="Pin to Home">${icon('pin')}</button></div>
    <div class="artist-hero"><div class="sk" style="position:absolute;inset:0;border-radius:0"></div></div>
    <div class="artist-body">${skCards(3)}</div></div>`);
  wireTopbar(v, 300);
  const heroEl = $('.artist-hero', v), body = $('.artist-body', v);
  let artist = null, albums = [], singles = [];

  async function load() {
    const [a, al, si] = await Promise.allSettled([sp.artist(id), sp.artistAlbums(id, 'album'), sp.artistAlbums(id, 'single')]);
    if (a.status === 'rejected') {
      heroEl.innerHTML = '';
      body.innerHTML = errorBox(a.reason?.message);
      body.querySelector('[data-retry]').onclick = load;
      return;
    }
    artist = a.value;
    albums = al.value || [];
    singles = si.value || [];
    heroEl.innerHTML = `${artist.imageLarge ? `<img src="${esc(artist.imageLarge)}" alt="">` : `<div class="ph">${icon('artist')}</div>`}<h1>${esc(artist.name)}</h1>`;
    $('.topbar-title', v).textContent = artist.name;
    $('.pinb', v).style.visibility = '';
    wirePin($('.pinb', v), artist);
    body.innerHTML = `<div class="artist-actions"><button class="pill-btn" data-a="play">${icon('play')}Play</button><button class="pill-btn" data-a="shuffle">${icon('shuffle')}Shuffle</button></div>`
      + (artist.genres?.length ? `<div class="hero-sub" style="padding:10px 20px 0;text-align:left">${esc(artist.genres.slice(0, 3).join(' · '))}</div>` : '')
      + (albums.length ? `<div class="sec-h"><h2>Albums</h2></div><div class="hscroll" data-k="albums">${albums.map((x, i) => card(x, i, x.year)).join('')}</div>` : '')
      + (singles.length ? `<div class="sec-h"><h2>Singles & EPs</h2></div><div class="hscroll" data-k="singles">${singles.map((x, i) => card(x, i, x.year)).join('')}</div>` : '')
      + (!albums.length && !singles.length ? '<div class="empty">No releases to show.</div>' : '');
  }

  body.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a && artist) { haptic(); player.playContext(artist.uri, { shuffle: a === 'shuffle' }); return; }
    const c = e.target.closest('.card');
    if (c) {
      const list = c.parentElement.dataset.k === 'albums' ? albums : singles;
      haptic();
      openItem(list[Number(c.dataset.i)]);
    }
  });
  body.addEventListener('contextmenu', e => {
    const c = e.target.closest('.card');
    if (!c) return;
    e.preventDefault();
    itemActions((c.parentElement.dataset.k === 'albums' ? albums : singles)[Number(c.dataset.i)]);
  });

  load();
  return { el: v };
}

export { isDemo };
