// Bottom-sheet menus: track actions, devices, now-playing menu, settings.
import { openSheet, closeSheet, closeOverlays, toast } from './ui.js';
import { player } from './player.js';
import { sp, isDemo } from './client.js';
import { auth } from './auth.js';
import { go } from './nav.js';
import { esc, icon, art, artistNames, deviceIcon, store } from './util.js';

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

export function settingsSheet() {
  const me = player.me;
  const avatar = me?.image ? `<img src="${esc(me.image)}" alt="">` : esc((me?.name || '?').slice(0, 1).toUpperCase());
  const sheet = openSheet(`<div class="sheet-head"><div class="avatar" style="width:52px;height:52px;font-size:20px">${avatar}</div>`
    + `<div class="row-text"><div class="row-title">${esc(me?.name || 'Listener')}</div><div class="row-sub"><span>${isDemo ? 'Demo mode — sample music' : 'Connected to Spotify'}</span></div></div></div>`
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
    if (b.dataset.a === 'out') {
      store('lumen.demo', null);
      if (!isDemo) auth.logout();
      location.replace(auth.redirectUri);
    }
  });
}
