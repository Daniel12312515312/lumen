// Small HTML builders shared by the views, the queue and search.
import { esc, icon, art, artistNames, EQ } from './util.js';
import { player } from './player.js';

export function trackRow(t, i, { num = false } = {}) {
  if (!t) return '';
  const lead = num
    ? `<div class="row-num"><span>${t.trackNumber || i + 1}</span>${EQ}</div>`
    : `<div class="row-art-wrap">${art(t.album?.image, 'row-art')}${EQ}</div>`;
  return `<div class="row track${t.isPlayable === false ? ' dim' : ''}" data-i="${i}" data-uri="${esc(t.uri)}">${lead}`
    + `<div class="row-text"><div class="row-title">${esc(t.name)}</div>`
    + `<div class="row-sub">${t.explicit ? '<span class="explicit">E</span>' : ''}<span>${esc(artistNames(t))}</span></div></div>`
    + `<button class="row-more" aria-label="More">${icon('more')}</button></div>`;
}

export function itemSub(x) {
  if (x.type === 'liked') return 'Playlist · Your favourites';
  if (x.type === 'playlist') return `Playlist · ${x.owner || 'Spotify'}`;
  if (x.type === 'album') return `Album · ${artistNames(x)}`;
  if (x.type === 'artist') return 'Artist';
  return x.sub || '';
}

export function itemArt(x, cls) {
  if (x.type === 'liked') return `<div class="${cls} liked-art">${icon('heartFill')}</div>`;
  return art(x.image, cls + (x.type === 'artist' ? ' round' : ''), x.type === 'artist' ? 'artist' : 'music');
}

export function itemRow(x, i) {
  return `<div class="row item" data-i="${i}">${itemArt(x, 'row-art')}`
    + `<div class="row-text"><div class="row-title">${esc(x.name)}</div><div class="row-sub"><span>${esc(itemSub(x))}</span></div></div>`
    + `${icon('chevRight', 'row-chev')}</div>`;
}

export function card(x, i, sub) {
  const playable = x.uri && ['album', 'playlist', 'artist'].includes(x.type);
  return `<button class="card${x.type === 'artist' ? ' round' : ''}" data-i="${i}"><div class="card-art-wrap">`
    + art(x.image || x.album?.image, 'card-art', x.type === 'artist' ? 'artist' : 'music')
    + (playable ? `<span class="card-play" data-uri="${esc(x.uri)}" role="button" aria-label="Play">${icon('play')}</span>` : '')
    + `</div><div class="card-title">${esc(x.name)}</div><div class="card-sub">${esc(sub ?? itemSub(x))}</div></button>`;
}

export function markPlaying(root = document) {
  const uri = player.track?.uri;
  root.querySelectorAll('.row.playing').forEach(r => { if (r.dataset.uri !== uri) r.classList.remove('playing'); });
  if (uri) root.querySelectorAll(`.row[data-uri="${CSS.escape(uri)}"]`).forEach(r => r.classList.add('playing'));
}
