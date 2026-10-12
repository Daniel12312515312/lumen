// Mini player + full Now Playing sheet (cover ⇄ lyrics ⇄ queue), gestures and progress.
import { $, $$, esc, icon, fmtTime, artistNames, clamp, haptic, store, deviceIcon } from './util.js';
import { player } from './player.js';
import { background } from './background.js';
import { LyricsView, fetchLyrics } from './lyrics.js';
import { pushOverlay, closeOverlays } from './ui.js';
import { go } from './nav.js';
import { trackRow, markPlaying } from './rows.js';
import { trackActions, devicesSheet, npMenu, getLyricsOffset, sleepSheet } from './sheets.js';
import { sleepTimer } from './sleeptimer.js';

const np = $('#np');
const app = $('#app');
const mini = $('#mini');
const dbar = $('#dbar');
const wide = matchMedia('(min-width: 1000px)'); // desktop layout: side menu, player bar, cover + lyrics side by side
const isDesktop = () => wide.matches;
const D = {
  art: $('.db-art', dbar), title: $('.db-title', dbar), artist: $('.db-artist', dbar), like: $('.db-like', dbar),
  play: $('[data-act="toggle"]', dbar), shuffle: $('[data-act="shuffle"]', dbar), repeat: $('[data-act="repeat"]', dbar),
  fill: $('.db-fill', dbar), pos: $('.db-pos', dbar), dur: $('.db-dur', dbar), progress: $('.db-progress', dbar),
  device: $('.np-device', dbar), sleep: $('.db-sleep', dbar), lyrics: $('[data-act="lyrics"]', dbar), queue: $('[data-act="queue"]', dbar),
};
const npSleep = $('.np-sleep', np);
const E = {
  art: $('.np-art', np), artWrap: $('.np-art-wrap', np), meta: $('.np-meta', np),
  title: $('.np-title', np), titleSpan: $('.np-title span', np), artist: $('.np-artist', np),
  like: $('.np-like', np), ctxLabel: $('.np-context small', np), ctxName: $('.np-context b', np),
  fill: $('.np-fill', np), pos: $('.np-pos', np), dur: $('.np-dur', np), progress: $('.np-progress', np),
  device: $('.np-device', np), play: $('.ctl.play', np), shuffle: $('[data-act="shuffle"]', np),
  repeat: $('[data-act="repeat"]', np), lyricsBtn: $('[data-act="lyrics"]', np), queueBtn: $('[data-act="queue"]', np),
  queue: $('.np-queue', np),
  miniArt: $('.mini-art', mini), miniTitle: $('.mini-title', mini), miniArtist: $('.mini-artist', mini),
  miniToggle: $('[data-act="toggle"]', mini), miniFill: $('.mini-progress i', mini), miniInner: $('.mini-inner', mini),
};

let open = false;
let mode = store('lumen.npMode') === 'lyrics' ? 'lyrics' : 'cover';
let settleTimer = 0, idleTimer = 0, suppressClick = false, scrub = null, lastPosText = '', lastRemain = '';
let swipeOut = null;
let lyricsFor = null;

const lyrics = new LyricsView($('.np-lyrics', np), {
  onSeek: ms => { haptic(); player.seek(ms - getLyricsOffset()); },
  onTap: () => poke(true),
});

export function initNowPlaying() {
  $('#np-close').innerHTML = icon('chevDown');
  $('#np-more').innerHTML = icon('more');
  $('[data-act="prev"]', np).innerHTML = icon('prev');
  $('[data-act="next"]', np).innerHTML = icon('next');
  E.shuffle.innerHTML = icon('shuffle');
  E.lyricsBtn.innerHTML = `${icon('lyrics')}<span>Lyrics</span>`;
  E.queueBtn.innerHTML = icon('queue');
  $('[data-act="next"]', mini).innerHTML = icon('next');
  $('[data-act="prev"]', dbar).innerHTML = icon('prev');
  $('[data-act="next"]', dbar).innerHTML = icon('next');
  D.shuffle.innerHTML = icon('shuffle');
  D.lyrics.innerHTML = icon('lyrics');
  D.queue.innerHTML = icon('queue');
  np.dataset.mode = mode;
  E.lyricsBtn.classList.toggle('on', mode === 'lyrics');
  sleepTimer.on(paintSleep);
  paintSleep();
  wide.addEventListener('change', () => {
    if (isDesktop() && mode === 'cover') setMode('lyrics', false);
    poke();
  });

  player.on(type => {
    if (type === 'track') updateTrack();
    else if (type === 'state') updateState();
    else if (type === 'liked') updateLike();
    else if (type === 'context') updateContext();
    else if (type === 'queue' && mode === 'queue') drawQueue();
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) lyrics.snap(); });
  wireControls();
  wireMini();
  wireGestures();
  wireScrub(E.progress, E);
  wireScrub(D.progress, D);
  wireDbar();
  requestAnimationFrame(tick);
  updateTrack();
  updateState();
}

function paintSleep() {
  const on = sleepTimer.active;
  const label = sleepTimer.label();
  npSleep.classList.toggle('hidden', !on);
  npSleep.innerHTML = on ? `${icon('moon')}<span>${esc(label)}</span>` : '';
  D.sleep.innerHTML = on ? `${icon('moon')}<span>${esc(label)}</span>` : icon('moon');
  D.sleep.classList.toggle('on', on);
}

/** Desktop player bar. */
function wireDbar() {
  dbar.addEventListener('click', e => {
    const b = e.target.closest('[data-act], .db-like');
    if (!b) return;
    if (b.classList.contains('db-like')) { player.setLiked(player.track, !player.liked); return; }
    switch (b.dataset.act) {
      case 'open': openNP('lyrics'); break;
      case 'toggle': player.toggle(); break;
      case 'next': player.next(); break;
      case 'prev': player.prev(); break;
      case 'shuffle': player.shuffle(); break;
      case 'repeat': player.repeat(); break;
      case 'lyrics': if (open && mode === 'lyrics') history.back(); else openNP('lyrics'); break;
      case 'queue': if (open && mode === 'queue') history.back(); else openNP('queue'); break;
      case 'devices': devicesSheet(); break;
      case 'sleep': sleepSheet(); break;
    }
  });
}

/** Keyboard "L": open the lyrics, or close the song screen if it's open. */
export function toggleLyrics() {
  if (open) history.back(); else openNP('lyrics');
}

/* ───────── Rendering ───────── */
function setImg(img, src) {
  if (!src) { img.removeAttribute('src'); return; }
  if (img.getAttribute('src') !== src) img.src = src;
}

function updateTrack() {
  const t = player.track;
  mini.classList.toggle('hidden', !t);
  dbar.classList.toggle('hidden', !t);
  document.body.classList.toggle('has-player', !!t);
  if (!t) {
    background.setImage(null);
    if (open) history.back();
    return;
  }
  const big = t.album?.imageLarge || t.album?.image;
  setImg(E.miniArt, t.album?.image || big);
  setImg(D.art, t.album?.image || big);
  setImg(E.art, big);
  background.setImage(t.album?.image || big);
  E.miniTitle.textContent = t.name;
  E.miniArtist.textContent = artistNames(t);
  D.title.textContent = t.name;
  D.artist.textContent = artistNames(t);
  E.titleSpan.textContent = t.name;
  E.artist.textContent = artistNames(t);
  const likeable = t.type === 'track' && !t.isLocal;
  E.like.classList.toggle('hidden', !likeable);
  D.like.classList.toggle('hidden', !likeable);
  updateLike();
  updateContext();
  setupMarquee();
  loadLyrics(t);
  if (mode === 'queue') drawQueue();
  markPlaying();
  animateArtIn();
}

function animateArtIn() {
  const recent = performance.now() - player.lastSkip.at < 2500;
  if (!open || mode !== 'cover' || (!recent && !swipeOut)) return;
  if (swipeOut?.anim?.playState === 'running') { // let the fly-out finish first
    if (!swipeOut.waiting) { swipeOut.waiting = true; swipeOut.anim.finished.then(animateArtIn, animateArtIn); }
    return;
  }
  const dir = swipeOut?.dir || player.lastSkip.dir || 1;
  swipeOut?.anim?.cancel();
  clearTimeout(swipeOut?.timer);
  swipeOut = null;
  E.artWrap.style.transform = '';
  E.artWrap.animate([
    { transform: `translateX(${dir * 45}%) scale(.9)`, opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 460, easing: 'cubic-bezier(.22,.9,.24,1)' });
}

async function loadLyrics(t) {
  if (lyricsFor === t.uri) return;
  lyricsFor = t.uri;
  lyrics.showStatus('loading');
  E.lyricsBtn.classList.remove('none');
  const data = await fetchLyrics(t).catch(() => ({ kind: 'error' }));
  if (lyricsFor !== t.uri) return;
  lyrics.setLyrics(data);
  E.lyricsBtn.classList.toggle('none', !['synced', 'plain'].includes(data.kind));
}

function updateLike() {
  const on = !!player.liked;
  for (const b of [E.like, D.like]) {
    b.innerHTML = icon(on ? 'heartFill' : 'heart');
    b.classList.toggle('on', on);
  }
}

function updateContext() {
  const type = player.contextType;
  const label = { playlist: 'Playing from playlist', album: 'Playing from album', artist: 'Playing from artist', collection: 'Playing from your library' }[type] || 'Now playing';
  E.ctxLabel.textContent = label;
  E.ctxName.textContent = player.contextName || player.track?.album?.name || '';
}

let lastStateKey = '';
function updateState() {
  const pb = player.pb;
  const playing = player.playing;
  const key = `${playing}|${pb?.shuffle}|${pb?.repeat}|${pb?.device?.id}|${pb?.device?.name}`;
  if (key !== lastStateKey) {
    lastStateKey = key;
    const pi = icon(playing ? 'pause' : 'play');
    E.play.innerHTML = pi;
    E.miniToggle.innerHTML = pi;
    D.play.innerHTML = pi;
    np.classList.toggle('paused', !playing);
    document.body.classList.toggle('is-paused', !playing);
    const rep = icon(pb?.repeat === 'track' ? 'repeatOne' : 'repeat');
    for (const s of [E, D]) {
      s.shuffle.classList.toggle('on', !!pb?.shuffle);
      s.repeat.classList.toggle('on', !!pb?.repeat && pb.repeat !== 'off');
      s.repeat.innerHTML = rep;
    }
    const d = pb?.device;
    const dev = `${icon(deviceIcon(d?.type))}<span>${esc(d ? d.name : 'Devices')}</span>`;
    for (const el of [E.device, D.device]) {
      el.innerHTML = dev;
      el.classList.toggle('remote', !!d && d.type !== 'Smartphone' && d.type !== 'Computer');
    }
    poke();
  }
  syncMiniProgress();
  markPlaying();
}

function syncMiniProgress() {
  const t = player.track;
  if (!t) return;
  const d = t.duration || 1;
  const pos = player.position();
  const f = E.miniFill;
  f.style.transition = 'none';
  f.style.transform = `scaleX(${clamp(pos / d, 0, 1)})`;
  if (player.playing) {
    void f.offsetWidth;
    f.style.transition = `transform ${Math.max(0, d - pos)}ms linear`;
    f.style.transform = 'scaleX(1)';
  }
}

function setupMarquee() {
  requestAnimationFrame(() => {
    const box = E.title, span = E.titleSpan;
    box.classList.remove('marquee');
    const over = span.scrollWidth - box.clientWidth;
    if (over > 4 && open) {
      box.style.setProperty('--mq', `${-(over + 48)}px`);
      box.style.setProperty('--mq-dur', `${Math.max(8, (over + 48) / 28)}s`);
      box.classList.add('marquee');
    }
  });
}

/* ───────── Frame loop: progress + lyrics ───────── */
let dbPos = '', dbDur = '';
function tick() {
  requestAnimationFrame(tick);
  if (document.hidden || !player.track) return;
  const pos = player.position();
  const d = player.track.duration || 1;
  if (isDesktop() && scrub?.el !== D.progress) { // desktop player bar
    D.fill.style.transform = `scaleX(${clamp(pos / d, 0, 1)})`;
    const a = fmtTime(pos), b = fmtTime(d);
    if (a !== dbPos) { D.pos.textContent = a; dbPos = a; }
    if (b !== dbDur) { D.dur.textContent = b; dbDur = b; }
  }
  if (!open) return;
  if (scrub?.el !== E.progress) {
    E.fill.style.transform = `scaleX(${clamp(pos / d, 0, 1)})`;
    const a = fmtTime(pos), b = `-${fmtTime(d - pos)}`;
    if (a !== lastPosText) { E.pos.textContent = a; lastPosText = a; }
    if (b !== lastRemain) { E.dur.textContent = b; lastRemain = b; }
  }
  if (mode === 'lyrics') lyrics.update(pos + getLyricsOffset());
}

/* ───────── Open / close / modes ───────── */
export function openNP(m) {
  if (!player.track) return;
  if (isDesktop() && !m && mode === 'cover') m = 'lyrics'; // on PC the cover is always shown beside the lyrics
  if (m && m !== mode) setMode(m, false);
  if (open) return;
  open = true;
  lyrics.snap();
  np.classList.add('open');
  np.setAttribute('aria-hidden', 'false');
  document.body.classList.add('np-open');
  pushOverlay('np', closeNow);
  player.setFast(true);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 560);
  setupMarquee();
  poke();
  if (mode === 'queue') drawQueue(true);
}

function settle() {
  if (!open) return;
  np.classList.add('settled');
  app.classList.add('behind');
}

function closeNow() {
  open = false;
  clearTimeout(settleTimer);
  np.classList.remove('settled', 'idle', 'dragging');
  app.classList.remove('behind');
  np.style.transform = '';
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('np-open');
  player.setFast(false);
}

function setMode(m, animate = true) {
  if (m === mode) m = 'cover';
  if (isDesktop() && m === 'cover') m = 'lyrics'; // the big cover is always visible on PC
  if (m === mode) return;
  const first = E.artWrap.getBoundingClientRect();
  mode = m;
  np.dataset.mode = m;
  store('lumen.npMode', m === 'lyrics' ? 'lyrics' : 'cover');
  E.lyricsBtn.classList.toggle('on', m === 'lyrics');
  E.queueBtn.classList.toggle('on', m === 'queue');
  if (animate && open) {
    const last = E.artWrap.getBoundingClientRect();
    if (last.width) {
      const dx = first.left - last.left, dy = first.top - last.top, s = first.width / last.width;
      E.artWrap.animate([
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${s})` },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: 560, easing: 'cubic-bezier(.22,.9,.24,1)' });
    }
    E.meta.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: 80, easing: 'cubic-bezier(.22,.9,.24,1)', fill: 'backwards' });
  }
  if (m === 'queue') drawQueue(true);
  if (m === 'lyrics') lyrics.snap();
  setupMarquee();
  poke();
}

/** Show controls; in lyrics mode hide them again after a few idle seconds. */
function poke(toggle = false) {
  if (toggle && mode === 'lyrics' && !np.classList.contains('idle') && player.playing) {
    np.classList.add('idle');
    clearTimeout(idleTimer);
    return;
  }
  np.classList.remove('idle');
  clearTimeout(idleTimer);
  // on PC the controls live beside the lyrics, so they never need to hide
  if (mode === 'lyrics' && player.playing && open && !isDesktop()) idleTimer = setTimeout(() => np.classList.add('idle'), 3800);
}

/* ───────── Queue ───────── */
function drawQueue(refresh = false) {
  const list = player.upNext;
  E.queue.innerHTML = `<div class="q-h">Up next</div>${player.contextName ? `<div class="q-sub">From <bdi>${esc(player.contextName)}</bdi></div>` : ''}`
    + (list.length ? list.map((t, i) => trackRow(t, i)).join('') : '<div class="empty">Nothing queued yet</div>');
  if (refresh) player.refreshQueue();
}

/* ───────── Wiring ───────── */
function wireControls() {
  np.addEventListener('click', async e => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); return; }
    const b = e.target.closest('[data-act], #np-close, #np-more, .np-artist, .np-like, .np-context, .np-sleep');
    if (!b) return;
    haptic();
    if (b.id === 'np-close') { history.back(); return; }
    if (b.classList.contains('np-sleep')) { sleepSheet(); return; }
    if (b.id === 'np-more') { npMenu(); return; }
    if (b.classList.contains('np-like')) { player.setLiked(player.track, !player.liked); return; }
    if (b.classList.contains('np-artist')) {
      const a = player.track?.artists?.find(x => x.id);
      if (a) { await closeOverlays(); go(`artist/${a.id}`); }
      return;
    }
    if (b.classList.contains('np-context')) { openContext(); return; }
    switch (b.dataset.act) {
      case 'toggle': player.toggle(); break;
      case 'next': player.next(); break;
      case 'prev': player.prev(); break;
      case 'shuffle': player.shuffle(); break;
      case 'repeat': player.repeat(); break;
      case 'lyrics': setMode('lyrics'); break;
      case 'queue': setMode('queue'); break;
      case 'devices': devicesSheet(); break;
    }
  }, true);

  np.addEventListener('pointerdown', e => { if (!e.target.closest('.np-lyrics')) poke(); });

  E.queue.addEventListener('click', e => {
    const row = e.target.closest('.row.track');
    if (!row) return;
    const i = Number(row.dataset.i);
    const t = player.upNext[i];
    if (!t) return;
    if (e.target.closest('.row-more')) trackActions(t);
    else { haptic(); player.skipTo(i); }
  });
}

async function openContext() {
  const c = player.pb?.context;
  if (!c?.uri) return;
  const [, type, id] = c.uri.split(':');
  await closeOverlays();
  if (c.uri.endsWith(':collection')) go('liked');
  else if (['playlist', 'album', 'artist'].includes(type)) go(`${type}/${id}`);
}

function wireMini() {
  let g = null;
  mini.addEventListener('click', e => {
    if (g?.moved) return;
    const b = e.target.closest('[data-act]');
    if (b) {
      e.stopPropagation();
      haptic();
      if (b.dataset.act === 'toggle') player.toggle(); else player.next();
      return;
    }
    openNP();
  });
  mini.addEventListener('pointerdown', e => { g = { x0: e.clientX, y0: e.clientY, id: e.pointerId, moved: false, axis: null }; });
  mini.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      g.moved = true;
      try { mini.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    if (g.axis === 'x') { E.miniInner.style.transition = 'none'; E.miniInner.style.transform = `translateX(${dx * .6}px)`; E.miniInner.style.opacity = String(1 - Math.min(.6, Math.abs(dx) / 300)); }
  });
  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, axis = g.axis;
    setTimeout(() => { g = null; }, 0);
    E.miniInner.style.transition = 'transform .35s cubic-bezier(.22,.9,.24,1), opacity .3s';
    E.miniInner.style.transform = '';
    E.miniInner.style.opacity = '';
    if (axis === 'x' && Math.abs(dx) > 70) { haptic(10); (dx < 0 ? player.next() : player.prev()); }
    if (axis === 'y' && dy < -30) openNP();
  };
  mini.addEventListener('pointerup', end);
  mini.addEventListener('pointercancel', end);
}

function wireGestures() {
  let g = null;
  np.addEventListener('pointerdown', e => {
    if (!open || !e.target.closest('.np-top, .np-head')) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), axis: null, onArt: mode === 'cover' && !!e.target.closest('.np-art-wrap') };
  });
  np.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 9) return;
      if (Math.abs(dy) > Math.abs(dx)) g.axis = dy > 0 ? 'y' : 'none';
      else g.axis = g.onArt ? 'x' : 'none';
      if (g.axis === 'none') { g = null; return; }
      try { np.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (g.axis === 'y') { np.classList.add('dragging'); np.classList.remove('settled'); app.classList.remove('behind'); clearTimeout(settleTimer); }
    }
    if (g.axis === 'y') np.style.transform = `translateY(${Math.max(0, dy)}px)`;
    else E.artWrap.style.transform = `translateX(${dx}px) rotate(${dx / 45}deg)`;
  });
  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = Math.max(1, performance.now() - g.t0), axis = g.axis;
    g = null;
    if (!axis) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (axis === 'y') {
      np.classList.remove('dragging');
      if (dy > 140 || (dy > 40 && dy / dt > .55)) history.back();
      else { np.style.transform = ''; settleTimer = setTimeout(settle, 560); }
      return;
    }
    if (Math.abs(dx) > 80 || (Math.abs(dx) > 30 && Math.abs(dx) / dt > .5)) {
      const dir = dx < 0 ? 1 : -1;
      haptic(10);
      const restart = dir < 0 && player.position() > 3500;
      const anim = E.artWrap.animate([
        { transform: E.artWrap.style.transform || 'none', opacity: 1 },
        { transform: `translateX(${-dir * 120}%) rotate(${-dir * 8}deg)`, opacity: 0 },
      ], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      swipeOut = { dir, anim, timer: setTimeout(animateArtIn, restart ? 240 : 1600) };
      if (dir > 0) player.next(); else player.prev();
    } else {
      const from = E.artWrap.style.transform;
      E.artWrap.style.transform = '';
      E.artWrap.animate([{ transform: from }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.3,1.35,.5,1)' });
    }
  };
  np.addEventListener('pointerup', end);
  np.addEventListener('pointercancel', end);
}

/** Drag-to-seek on a progress bar (the song screen's, or the desktop player bar's). */
function wireScrub(p, S) {
  const ratio = e => {
    const r = $('.np-bar', p).getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  const show = v => {
    const d = player.track?.duration || 0;
    S.fill.style.transform = `scaleX(${v})`;
    S.pos.textContent = fmtTime(v * d);
    if (S === E) S.dur.textContent = `-${fmtTime(d - v * d)}`;
  };
  p.addEventListener('pointerdown', e => {
    if (!player.track) return;
    scrub = { el: p, id: e.pointerId, v: ratio(e) };
    try { p.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    p.classList.add('drag');
    show(scrub.v);
  });
  p.addEventListener('pointermove', e => {
    if (!scrub || e.pointerId !== scrub.id) return;
    scrub.v = ratio(e);
    show(scrub.v);
  });
  const end = e => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const v = scrub.v;
    scrub = null;
    p.classList.remove('drag');
    lastPosText = '';
    dbPos = '';
    player.seek(v * (player.track?.duration || 0));
  };
  p.addEventListener('pointerup', end);
  p.addEventListener('pointercancel', e => { scrub = null; p.classList.remove('drag'); });
}

export { openNP as openNowPlaying };
export const _debug = { setMode: m => setMode(m), lyrics };
