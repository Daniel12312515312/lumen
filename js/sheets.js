// Bottom-sheet menus: track actions, devices, now-playing menu, settings.
import { openSheet, closeSheet, closeOverlays, toast } from './ui.js';
import { player } from './player.js';
import { sp, isDemo } from './client.js';
import { auth } from './auth.js';
import { go } from './nav.js';
import { esc, icon, art, artistNames, deviceIcon, store, haptic } from './util.js';
import { pins } from './pins.js';
import { lib } from './lib.js';
import { itemArt, itemSub } from './rows.js';

export const getLyricsOffset = () => Number(store('lumen.lyricsOffset')) || 0;

function head(t) {
  return `<div class="sheet-head">${art(t.album?.image, '')}<div class="row-text"><div class="row-title">${esc(t.name)}</div>`
    + `<div class="row-sub"><span>${esc(artistNames(t))}</span></div></div></div>`;
}

function share(t) {
  const url = `https://open.spotify.com/${t.type === 'episode' ? 'episode' : 'track'}/${t.id}`;
  if (navigator.share) navigator.share({ title: t.name, text: `${t.name} — ${artistNames(t)}`, url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Link copied'));
}

function linkItems(t) {
  return (t.album?.id ? `<button class="sheet-item" data-a="album">${icon('album')}<span class="si-text">Go to album</span></button>` : '')
    + t.artists.filter(a => a.id).map(a => `<button class="sheet-item" data-a="artist" data-id="${esc(a.id)}">${icon('artist')}<span class="si-text">Go to ${esc(a.name)}</span></button>`).join('');
}

async function handleLink(b, t) {
  if (b.dataset.a === 'album') { await closeOverlays(); go(`album/${t.album.id}`); return true; }
  if (b.dataset.a === 'artist') { await closeOverlays(); go(`artist/${b.dataset.id}`); return true; }
  if (b.dataset.a === 'share') { closeSheet(); share(t); return true; }
  return false;
}

export function trackActions(t) {
  const canLike = t.type === 'track' && !t.isLocal;
  const sheet = openSheet(head(t)
    + `<button class="sheet-item" data-a="queue">${icon('addQueue')}<span class="si-text">Add to queue</span></button>`
    + (canLike ? `<button class="sheet-item" data-a="like">${icon('heart')}<span class="si-text">Add to Liked Songs</span></button>` : '')
    + linkItems(t)
    + `<button class="sheet-item" data-a="share">${icon('share')}<span class="si-text">Share</span></button>`);
  let liked = false;
  const likeBtn = sheet.querySelector('[data-a="like"]');
  if (likeBtn) {
    sp.libraryContains([t.uri]).then(([v]) => {
      liked = !!v;
      if (liked) likeBtn.innerHTML = `${icon('heartFill')}<span class="si-text">Remove from Liked Songs</span>`;
      likeBtn.classList.toggle('on', liked);
    }).catch(() => {});
  }
  sheet.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'queue') { closeSheet(); player.addToQueue(t); return; }
    if (b.dataset.a === 'like') { closeSheet(); player.setLiked(t, !liked); return; }
    handleLink(b, t);
  });
}

export async function devicesSheet() {
  const sheet = openSheet(`<div class="sheet-title">Play on</div><div class="dev-list"><div class="list-foot"><div class="spinner"></div></div></div>`
    + `<button class="sheet-item" data-a="open">${icon('open')}<span class="si-text">Open the Spotify app<small>Your phone shows up here once Spotify is open</small></span></button>`);
  const list = sheet.querySelector('.dev-list');
  let devs = [];
  try {
    devs = await sp.devices();
    list.innerHTML = devs.length
      ? devs.map(d => `<button class="sheet-item${d.active ? ' on' : ''}" data-id="${esc(d.id)}">${icon(deviceIcon(d.type))}`
        + `<span class="si-text">${esc(d.name)}<small>${d.active ? 'Playing now' : esc(d.type)}</small></span>${d.active ? icon('check') : ''}</button>`).join('')
      : '<div class="sheet-note">No devices found. Open Spotify on your phone, computer or speaker.</div>';
  } catch {
    list.innerHTML = '<div class="sheet-note">Couldn’t load your devices.</div>';
  }
  sheet.addEventListener('click', e => {
    const b = e.target.closest('.sheet-item');
    if (!b) return;
    if (b.dataset.a === 'open') { location.href = 'spotify:'; return; }
    const d = devs.find(x => x.id === b.dataset.id);
    if (d && !d.active) { closeSheet(); player.transfer(d); }
  });
}

function offsetItem() {
  return `<div class="sheet-item" data-offset>${icon('clock')}<span class="si-text">Lyrics timing<small>If words come too early or late</small></span>`
    + `<div class="stepper"><button data-s="-1" aria-label="Earlier">−</button><output></output><button data-s="1" aria-label="Later">+</button></div></div>`;
}
function wireOffset(sheet) {
  const out = sheet.querySelector('[data-offset] output');
  if (!out) return;
  const show = () => { const v = getLyricsOffset() / 1000; out.textContent = `${v > 0 ? '+' : ''}${v.toFixed(2)}s`; };
  show();
  sheet.querySelector('[data-offset]').addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const v = Math.max(-3000, Math.min(3000, getLyricsOffset() + Number(b.dataset.s) * 250));
    store('lumen.lyricsOffset', v);
    show();
  });
}

export function npMenu() {
  const t = player.track;
  if (!t) return;
  const sheet = openSheet(head(t) + linkItems(t)
    + `<button class="sheet-item" data-a="share">${icon('share')}<span class="si-text">Share</span></button>`
    + offsetItem()
    + (t.id ? `<a class="sheet-item" href="spotify:${t.type}:${esc(t.id)}">${icon('open')}<span class="si-text">Open in Spotify</span></a>` : ''));
  wireOffset(sheet);
  sheet.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (b) handleLink(b, t);
  });
}

/* ───────── Pin to Home (long-press on an album / playlist / artist) ───────── */
export function itemActions(x) {
  if (!x) return;
  haptic(12);
  if (x.type === 'liked') {
    const sheet = openSheet(`<div class="sheet-head">${itemArt(x, '')}<div class="row-text"><div class="row-title">Liked Songs</div></div></div>`
      + `<button class="sheet-item" data-a="hide">${icon('x')}<span class="si-text">Hide from Home</span></button>`
      + `<button class="sheet-item" data-a="edit">${icon('home')}<span class="si-text">Edit Home screen</span></button>`);
    sheet.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'hide') { closeSheet(); pins.setShowLiked(false); toast('Liked Songs hidden from Home'); }
      if (a === 'edit') { await closeOverlays(); homeEditor(); }
    });
    return;
  }
  const pinned = pins.isPinned(x.uri);
  const sheet = openSheet(`<div class="sheet-head">${itemArt(x, '')}<div class="row-text"><div class="row-title">${esc(x.name)}</div>`
    + `<div class="row-sub"><span>${esc(itemSub(x))}</span></div></div></div>`
    + `<button class="sheet-item${pinned ? ' on' : ''}" data-a="pin">${icon(pinned ? 'pinFill' : 'pin')}<span class="si-text">${pinned ? 'Unpin from Home' : 'Pin to Home'}</span></button>`
    + `<button class="sheet-item" data-a="open">${icon('chevRight')}<span class="si-text">Open</span></button>`
    + `<button class="sheet-item" data-a="edit">${icon('home')}<span class="si-text">Edit Home screen</span></button>`);
  sheet.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'pin') {
      closeSheet();
      if (pinned) { pins.unpin(x.uri); toast('Removed from Home'); } else { pins.pin(x); toast('Pinned to Home'); }
    }
    if (a === 'open') { await closeOverlays(); go(`${x.type}/${x.id}`); }
    if (a === 'edit') { await closeOverlays(); homeEditor(); }
  });
}

/* ───────── Home screen editor ───────── */
export function homeEditor() {
  const sheet = openSheet(`<div class="sheet-title">Home screen</div>
    <label class="sheet-item">${icon('heart')}<span class="si-text">Show Liked Songs</span><input type="checkbox" class="switch" data-liked></label>
    <div class="ed-h"><span>Pinned</span><button data-a="reset">Reset to automatic</button></div>
    <div class="ed-pins"></div>
    <div class="ed-h"><span>Add from your library</span></div>
    <div class="chips ed-chips"><button class="chip on" data-f="">All</button><button class="chip" data-f="album">Albums</button><button class="chip" data-f="playlist">Playlists</button><button class="chip" data-f="artist">Artists</button></div>
    <div class="ed-lib"><div class="list-foot"><div class="spinner"></div></div></div>`);
  const pinsEl = sheet.querySelector('.ed-pins'), libEl = sheet.querySelector('.ed-lib'), liked = sheet.querySelector('[data-liked]');
  let items = [], filter = '';
  liked.checked = pins.showLiked;
  liked.addEventListener('change', () => { haptic(); pins.setShowLiked(liked.checked); });

  const row = (x, right) => `<div class="row ed-row" data-uri="${esc(x.uri)}">${itemArt(x, 'row-art')}`
    + `<div class="row-text"><div class="row-title">${esc(x.name)}</div><div class="row-sub"><span>${esc(itemSub(x))}</span></div></div>${right}</div>`;

  function drawPins() {
    const list = pins.custom ? pins.list : [];
    pinsEl.innerHTML = list.length
      ? list.map((x, i) => row(x, `<button class="icon-btn" data-a="up" ${i ? '' : 'disabled'} aria-label="Move up">${icon('arrowUp')}</button>`
        + `<button class="icon-btn" data-a="remove" aria-label="Remove">${icon('x')}</button>`)).join('')
      : `<div class="sheet-note">${pins.custom ? 'Nothing pinned yet — add some below.' : 'Automatic: your recent albums and playlists. Pin something to choose yourself.'}</div>`;
  }
  function drawLib() {
    const shown = items.filter(x => !filter || x.type === filter);
    libEl.innerHTML = shown.map(x => {
      const on = pins.isPinned(x.uri);
      return row(x, `<button class="ed-add${on ? ' on' : ''}" data-a="toggle" aria-label="${on ? 'Unpin' : 'Pin'}">${icon(on ? 'check' : 'plus')}</button>`);
    }).join('') || '<div class="sheet-note">Nothing in your library yet.</div>';
  }
  const off = pins.on(() => { drawPins(); drawLib(); liked.checked = pins.showLiked; });
  new MutationObserver((m, obs) => { if (!sheet.isConnected) { off(); obs.disconnect(); } }).observe(document.getElementById('sheet-root'), { childList: true });

  drawPins();
  Promise.allSettled([lib.albums(), lib.playlists(), lib.artists()]).then(([al, pl, ar]) => {
    items = [...(al.value || []), ...(pl.value || []), ...(ar.value || [])];
    drawLib();
  });

  sheet.addEventListener('click', e => {
    const chip = e.target.closest('.ed-chips .chip');
    if (chip) {
      filter = chip.dataset.f;
      sheet.querySelectorAll('.ed-chips .chip').forEach(c => c.classList.toggle('on', c === chip));
      drawLib();
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    haptic();
    const uri = b.closest('[data-uri]')?.dataset.uri;
    if (b.dataset.a === 'reset') { pins.reset(); toast('Home is automatic again'); }
    if (b.dataset.a === 'up') pins.move(uri, -1);
    if (b.dataset.a === 'remove') pins.unpin(uri);
    if (b.dataset.a === 'toggle') {
      const x = items.find(i => i.uri === uri);
      if (pins.isPinned(uri)) pins.unpin(uri);
      else if (pins.full) toast('Home holds up to 12 — remove one first');
      else if (x) pins.pin(x);
    }
  });
}

export function settingsSheet() {
  const me = player.me;
  const avatar = me?.image ? `<img src="${esc(me.image)}" alt="">` : esc((me?.name || '?').slice(0, 1).toUpperCase());
  const sheet = openSheet(`<div class="sheet-head"><div class="avatar" style="width:52px;height:52px;font-size:20px">${avatar}</div>`
    + `<div class="row-text"><div class="row-title">${esc(me?.name || 'Listener')}</div><div class="row-sub"><span>${isDemo ? 'Demo mode — sample music' : 'Connected to Spotify'}</span></div></div></div>`
    + `<button class="sheet-item" data-a="home">${icon('home')}<span class="si-text">Edit Home screen<small>Pinned albums, playlists, artists · Liked Songs</small></span></button>`
    + offsetItem()
    + `<button class="sheet-item" data-a="devices">${icon('speaker')}<span class="si-text">Devices</span></button>`
    + `<a class="sheet-item" href="spotify:">${icon('open')}<span class="si-text">Open the Spotify app</span></a>`
    + `<button class="sheet-item" data-a="out">${icon('logout')}<span class="si-text">${isDemo ? 'Exit demo' : 'Sign out'}</span></button>`
    + '<div class="sheet-note">Lumen · lyrics by LRCLIB · not affiliated with Spotify</div>');
  wireOffset(sheet);
  sheet.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'devices') { await closeOverlays(); devicesSheet(); }
    if (b.dataset.a === 'home') { await closeOverlays(); homeEditor(); }
    if (b.dataset.a === 'out') {
      store('lumen.demo', null);
      if (!isDemo) auth.logout();
      location.replace(auth.redirectUri);
    }
  });
}
