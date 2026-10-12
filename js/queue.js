// The queue as a page of its own: what's playing and what's coming up — no player controls on it.
import { $, esc, icon, haptic } from './util.js';
import { player } from './player.js';
import { trackRow, markPlaying } from './rows.js';
import { trackActions } from './sheets.js';
import { pushOverlay } from './ui.js';

const page = $('#queue');
const body = $('.qp-body', page);
let open = false, settleTimer = 0;

export const queueOpen = () => open;
export const queueSettled = () => open && page.classList.contains('settled');

function draw() {
  const t = player.track, list = player.upNext;
  body.innerHTML = (t ? `<div class="q-h">Now playing</div><div class="list" data-k="now">${trackRow(t, 0)}</div>` : '')
    + `<div class="q-h">Next up</div>${player.contextName ? `<div class="q-sub">From <bdi>${esc(player.contextName)}</bdi></div>` : ''}`
    + (list.length ? `<div class="list" data-k="next">${list.map((x, i) => trackRow(x, i)).join('')}</div>` : '<div class="empty">Nothing queued yet</div>');
  markPlaying(page);
}

export function openQueue() {
  if (open || !player.track) return;
  open = true;
  draw();
  player.refreshQueue();
  body.scrollTop = 0;
  page.classList.add('open');
  page.setAttribute('aria-hidden', 'false');
  pushOverlay('queue', close);
  clearTimeout(settleTimer);
  // once it has slid in, hide what's underneath so only this page is drawn
  settleTimer = setTimeout(() => { if (open) { page.classList.add('settled'); document.body.classList.add('q-settled'); } }, 480);
}

function close() {
  open = false;
  clearTimeout(settleTimer);
  document.body.classList.remove('q-settled');
  page.classList.remove('open', 'settled');
  page.setAttribute('aria-hidden', 'true');
}

export function initQueue() {
  $('.qp-back', page).innerHTML = icon('chevLeft');
  $('.qp-back', page).addEventListener('click', () => history.back());
  player.on(type => {
    if (!open) return;
    if (type === 'queue' || type === 'track' || type === 'context') draw();
    else if (type === 'state') markPlaying(page);
  });
  body.addEventListener('click', e => {
    const row = e.target.closest('.row.track');
    if (!row || row.parentElement.dataset.k !== 'next') return;
    const i = Number(row.dataset.i);
    const t = player.upNext[i];
    if (!t) return;
    if (e.target.closest('.row-more')) trackActions(t);
    else { haptic(); player.skipTo(i); }
  });
  body.addEventListener('contextmenu', e => {
    const row = e.target.closest('.row.track');
    if (!row) return;
    const t = row.parentElement.dataset.k === 'now' ? player.track : player.upNext[Number(row.dataset.i)];
    if (!t) return;
    e.preventDefault();
    trackActions(t);
  });
}
