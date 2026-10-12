// Boot, routing and the first-run setup screen.
import { $, $$, esc, icon, store } from './util.js';
import { auth, DEFAULT_CLIENT_ID } from './auth.js';
import { spotify } from './spotify.js';
import { createMock } from './mock.js';
import { setClient } from './client.js';
import { player } from './player.js';
import { background } from './background.js';
import { initNowPlaying, toggleLyrics } from './nowplaying.js';
import { createView } from './views.js';
import { parseRoute, navStack, TABS, goTab, go } from './nav.js';
import { markPlaying, itemArt, itemSub } from './rows.js';
import { lib } from './lib.js';
import { mountInstall } from './install.js';
import { pins } from './pins.js';
import { sleepTimer } from './sleeptimer.js';
import { itemActions } from './sheets.js';
import { overlayCount } from './ui.js';
import { listening } from './history.js';

const LOGO = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="9" y="12" width="22" height="5" rx="2.5" fill="#1DB954" opacity=".7"/><rect x="9" y="21.5" width="30" height="5" rx="2.5" fill="#1ED760"/><rect x="9" y="31" width="17" height="5" rx="2.5" fill="#1DB954" opacity=".7"/></svg>';

/* ───────── Router ───────── */
const cache = new Map();
let current = null;

function showRoute() {
  const r = parseRoute();
  if (location.hash !== r.key) history.replaceState(history.state, '', r.key);

  let dir = 'enter';
  const i = navStack.lastIndexOf(r.key);
  if (i >= 0 && i === navStack.length - 2) { navStack.pop(); dir = 'enter-back'; }
  else if (i >= 0 && i === navStack.length - 1) dir = null;
  else { navStack.push(r.key); if (navStack.length > 60) navStack.splice(0, navStack.length - 60); }
  if (!r.type && dir) dir = 'enter-fade';

  let entry = cache.get(r.key);
  if (!entry) {
    entry = createView(r);
    entry.key = r.key;
    cache.set(r.key, entry);
    $('#views').append(entry.el);
  }
  if (current && current !== entry) current.el.classList.add('off');
  entry.el.classList.remove('off', 'enter', 'enter-back', 'enter-fade');
  if (dir && current !== entry) { void entry.el.offsetWidth; entry.el.classList.add(dir); }
  current = entry;
  entry.onShow?.();
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === r.tab));
  markPlaying(entry.el);
  trim();
}

function trim() {
  const keep = new Set(navStack.slice(-10));
  TABS.forEach(t => keep.add(`#/${t}`));
  for (const [k, e] of cache) {
    if (!keep.has(k) && e !== current) { e.el.remove(); cache.delete(k); }
  }
}

function wireTabs() {
  const labels = { home: 'Home', search: 'Search', library: 'Library', stats: 'Stats' };
  $$('.tab').forEach(t => {
    t.innerHTML = `${icon(t.dataset.tab)}<span>${labels[t.dataset.tab]}</span>`;
    t.addEventListener('click', () => {
      const r = parseRoute();
      if (r.tab === t.dataset.tab && !r.type) {
        current?.el.scrollTo({ top: 0, behavior: 'smooth' });
        if (t.dataset.tab === 'search') current?.el.querySelector('input')?.focus();
      } else goTab(t.dataset.tab);
    });
  });
}

/* ───────── Desktop side menu: pinned items ───────── */
let sideItems = [];
async function renderSidePins() {
  const el = $('.side-pins');
  if (!el) return;
  const liked = pins.showLiked ? [{ type: 'liked', name: 'Liked Songs' }] : [];
  let list = pins.custom ? pins.list : pins.auto;
  if (!pins.custom && !list.length) list = (await lib.playlists().catch(() => [])).slice(0, 8);
  sideItems = [...liked, ...list];
  el.innerHTML = '<div class="side-h">Pinned</div>' + sideItems.map((x, i) => `<button class="side-item" data-i="${i}">${itemArt(x, 'side-art')}`
    + `<span class="side-text"><span class="side-name">${esc(x.name)}</span><span class="side-sub">${esc(itemSub(x))}</span></span></button>`).join('');
}
function wireSide() {
  const el = $('.side-pins');
  el.addEventListener('click', e => {
    const b = e.target.closest('.side-item');
    const x = b && sideItems[Number(b.dataset.i)];
    if (!x) return;
    if (x.type === 'liked') go('liked'); else go(`${x.type}/${x.id}`);
  });
  el.addEventListener('contextmenu', e => {
    const b = e.target.closest('.side-item');
    if (!b) return;
    e.preventDefault();
    itemActions(sideItems[Number(b.dataset.i)]);
  });
  pins.on(renderSidePins);
  renderSidePins();
}

/* ───────── PC: keyboard shortcuts + hover play buttons ───────── */
function wireKeys() {
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); player.toggle(); }
    else if (k === 'ArrowRight' && e.shiftKey) player.seek(player.position() + 10_000);
    else if (k === 'ArrowLeft' && e.shiftKey) player.seek(player.position() - 10_000);
    else if (k === 'ArrowRight') player.next();
    else if (k === 'ArrowLeft') player.prev();
    else if (k === 'l' || k === 'L') toggleLyrics();
    else if (k === 's' || k === 'S') player.shuffle();
    else if (k === '/') { e.preventDefault(); goTab('search'); setTimeout(() => $('.view.search input')?.focus(), 80); }
    else if (k === 'Escape' && overlayCount()) history.back();
    else return;
  });
  // the round play button that appears on covers when hovering with a mouse
  document.addEventListener('click', e => {
    const b = e.target.closest('.card-play');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    player.playContext(b.dataset.uri);
  }, true);
  // the song that's already playing: clicking / tapping it (or its hover button) pauses or
  // resumes instead of restarting it — on the phone and the PC alike
  document.addEventListener('click', e => {
    const row = e.target.closest('.row.track.playing');
    if (!row || e.target.closest('.row-more')) return;
    e.preventDefault();
    e.stopPropagation();
    player.toggle();
  }, true);
}

/* ───────── Setup ───────── */
function showSetup(err) {
  $('#app').classList.add('hidden');
  const s = $('#setup');
  s.classList.remove('hidden');
  const uri = auth.redirectUri;
  const insecure = location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname);
  const builtIn = !!DEFAULT_CLIENT_ID && !localStorage.getItem('lumen.clientId');
  s.innerHTML = `<div class="setup-wrap">
    <div class="logo">${LOGO}</div>
    <h1>Lumen</h1>
    <p>A cleaner, glassy skin for your Spotify — with glowing synced lyrics.</p>
    <div class="install-slot"></div>
    ${err ? `<div class="setup-error">${esc(err)}</div>` : ''}
    ${insecure ? '<div class="setup-error">Open Lumen from its https address (GitHub Pages) — Spotify sign-in needs a secure page.</div>' : ''}
    <div class="${builtIn ? 'hidden' : ''}">
    <div class="step glass-card"><h3><span class="step-n">1</span>Create a Spotify app</h3>
      <p>Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a>, tap <b>Create app</b> and tick <b>Web API</b>.</p></div>
    <div class="step glass-card"><h3><span class="step-n">2</span>Add this Redirect URI</h3>
      <p>Paste it exactly as shown, including the last slash.</p>
      <div class="copy-field"><code>${esc(uri)}</code><button data-copy>Copy</button></div></div>
    <div class="step glass-card"><h3><span class="step-n">3</span>Paste your Client ID</h3>
      <p>It’s on your app’s page in the dashboard (Settings → Basic information).</p>
      <input class="text-input" id="cid" placeholder="Client ID" value="${esc(auth.clientId)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    </div>
    <button class="primary-btn" id="connect">Connect Spotify</button>
    <button class="ghost-btn" id="demo">Try the demo first</button>
  </div>`;
  mountInstall($('.install-slot', s));
  const cid = $('#cid', s), connect = $('#connect', s);
  const check = () => { connect.disabled = cid.value.trim().length < 20; };
  check();
  cid.addEventListener('input', check);
  $('[data-copy]', s).addEventListener('click', e => {
    navigator.clipboard?.writeText(uri).then(() => { e.target.textContent = 'Copied ✓'; });
  });
  connect.addEventListener('click', () => {
    const v = cid.value.trim();
    if (v && v !== DEFAULT_CLIENT_ID) auth.setClientId(v);
    else localStorage.removeItem('lumen.clientId');
    auth.login();
  });
  $('#demo', s).addEventListener('click', () => {
    store('lumen.demo', true);
    location.reload();
  });
}

/* ───────── Boot ───────── */
function start() {
  $('#setup').classList.add('hidden');
  $('#app').classList.remove('hidden');
  wireTabs();
  wireSide();
  wireKeys();
  mountInstall($('.side-install'));
  initNowPlaying();
  sleepTimer.init();
  lib.me().then(me => { player.me = me; }).catch(() => {});
  player.on(type => {
    if (type === 'auth') { auth.logout(); showSetup('Your Spotify session ended — please connect again.'); }
    if (type === 'library') lib.invalidate();
  });
  addEventListener('hashchange', showRoute);
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/home');
  showRoute();
  player.start();
  // keep the on-device listening history growing: Spotify only remembers the last 50 plays
  listening.syncRecent();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) listening.syncRecent(); });
  setInterval(() => { if (!document.hidden) listening.syncRecent(); }, 15 * 60_000);
}

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // a new version took over → reload once so the whole app runs the new code
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !$('#np.open')) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // apps on a phone stay alive for days: look for a new version whenever Lumen comes back
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
  background.init();
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    store('lumen.demo', true);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if (params.has('code') || params.has('error')) {
    try { await auth.handleRedirect(); } catch (e) { showSetup(e.message); return; }
  }
  if (store('lumen.demo')) { setClient(createMock(), true); start(); return; }
  if (auth.clientId && auth.loggedIn) { setClient(spotify, false); start(); return; }
  showSetup();
}

boot();
