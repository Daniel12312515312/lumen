// Swipe a song sideways (either way) to add it to the queue — like Spotify's swipe on a song.
import { icon, haptic } from './util.js';
import { player } from './player.js';

const ARM = 0.26; // share of the row's width to drag before letting go adds it

export function wireSwipeToQueue() {
  let g = null, swallowClick = false;

  const canSwipe = row => row && !row.classList.contains('dim') && /^spotify:(track|episode|local):/.test(row.dataset.uri || '')
    && !row.closest('#np, #queue, #sheet-root');

  addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || g) return; // on PC: right-click → Add to queue
    const row = e.target.closest?.('.row.track');
    if (!canSwipe(row) || e.target.closest('.row-more')) return;
    g = { id: e.pointerId, row, x0: e.clientX, y0: e.clientY, dx: 0, on: false, armed: false, w: row.offsetWidth || innerWidth };
  }, { passive: true });

  addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; } // it's a scroll
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      g.on = true;
      g.hint = document.createElement('span');
      g.hint.className = 'sw-hint';
      g.hint.innerHTML = icon('addQueue');
      g.row.append(g.hint);
      g.row.classList.add('swiping');
      try { g.row.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    // follows the finger, with resistance past the point where it's armed
    const lim = g.w * ARM;
    const mag = Math.abs(dx) <= lim ? Math.abs(dx) : lim + (Math.abs(dx) - lim) * .35;
    g.dx = Math.sign(dx) * mag;
    const armed = Math.abs(dx) >= lim;
    if (armed !== g.armed) { g.armed = armed; if (armed) haptic(8); }
    g.row.style.transform = `translate3d(${g.dx}px,0,0)`;
    g.hint.classList.toggle('left', g.dx < 0);
    g.hint.classList.toggle('armed', armed);
    g.hint.style.opacity = Math.min(1, mag / (lim * .7)).toFixed(3);
  }, { passive: true });

  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const { row, hint, on, armed } = g;
    g = null;
    if (!on) return;
    swallowClick = true; // the lift would otherwise count as a tap on the song
    setTimeout(() => { swallowClick = false; }, 60);
    row.classList.add('swipe-back');
    row.style.transform = '';
    setTimeout(() => { row.classList.remove('swiping', 'swipe-back'); hint.remove(); }, 320);
    if (armed && e.type === 'pointerup') {
      haptic(14);
      player.addToQueue({ uri: row.dataset.uri, name: row.querySelector('.row-title')?.textContent || '' });
    }
  };
  addEventListener('pointerup', end, true);
  addEventListener('pointercancel', end, true);
  // window capture runs before every other click handler
  addEventListener('click', e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
}
