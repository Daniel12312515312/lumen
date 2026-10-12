// "Play on this phone": move the music from the PC (or a speaker) to the phone in one tap.
// Spotify only lists the phone while its app is awake, so when it isn't listed Lumen opens
// Spotify for a moment and finishes the switch by itself as soon as the phone shows up.
import { $, esc, icon, store, haptic, deviceIcon } from './util.js';
import { sp } from './client.js';
import { player } from './player.js';
import { toast } from './ui.js';

const KEY = 'lumen.myPhone';
const bar = $('#handoff');
let pending = null, watching = false, dismissed = null;

/** Lumen is running on a phone (not the PC layout). */
export const onPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent) && !matchMedia('(min-width: 1000px)').matches;

/** Remember which Spotify device is this phone (when it's picked from the phone). */
export function rememberPhone(d) {
  if (onPhone() && d?.type === 'Smartphone') store(KEY, { id: d.id, name: d.name });
}

function findPhone(devs) {
  const mine = store(KEY);
  return (mine && (devs.find(d => d.id === mine.id) || devs.find(d => d.type === 'Smartphone' && d.name === mine.name)))
    || devs.find(d => d.type === 'Smartphone') || null;
}

/** Is Spotify playing on a device that isn't this phone? */
function elsewhere() {
  const d = player.pb?.device;
  if (!d || !player.track) return false;
  const mine = store(KEY);
  if (mine) return d.id !== mine.id && d.name !== mine.name;
  return d.type !== 'Smartphone';
}

async function moveTo(phone, play) {
  try {
    await sp.transfer(phone.id, play);
    rememberPhone(phone);
    toast(`Playing on ${phone.name}`);
  } catch (e) { player.handleError(e); }
  setTimeout(() => player.poll(), 700);
}

/** Wait (up to a minute) for the phone to show up in Spotify's device list, then switch to it. */
async function watch() {
  if (watching) return;
  watching = true;
  while (pending && Date.now() < pending.until) {
    const phone = findPhone(await sp.devices().catch(() => []));
    if (phone) {
      const { play } = pending;
      pending = null;
      if (!phone.active) await moveTo(phone, play);
      break;
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  if (pending && Date.now() >= pending.until) pending = null;
  watching = false;
  paint();
}

export async function playOnThisPhone() {
  haptic();
  const play = player.playing || !player.pb;
  const phone = findPhone(await sp.devices().catch(() => []));
  if (phone?.active) { toast('Already playing on this phone'); return; }
  if (phone) { await moveTo(phone, play); return; }
  // Spotify on the phone is asleep → wake it; the switch finishes once it's listed
  pending = { until: Date.now() + 60_000, play };
  toast('Opening Spotify — just swipe back, Lumen finishes the switch', { duration: 6000 });
  watch();
  setTimeout(() => { location.href = 'spotify:'; }, 250);
}

/* ───── the one-tap bar above the mini player ───── */
function paint() {
  const d = player.pb?.device;
  const show = onPhone() && elsewhere() && !pending && dismissed !== d?.id;
  bar.classList.toggle('show', !!show);
  if (!show) return;
  const key = `${d.id}|${d.name}|${player.playing}`;
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.innerHTML = `${icon(deviceIcon(d.type), 'ho-dev')}<span class="ho-text"><small>${player.playing ? 'Playing on' : 'Connected to'}</small><b>${esc(d.name)}</b></span>`
    + '<button class="ho-go" data-a="go">Play here</button>'
    + `<button class="ho-x" data-a="x" aria-label="Dismiss">${icon('x')}</button>`;
}

export function initHandoff() {
  player.on(type => { if (type === 'state' || type === 'track') paint(); });
  addEventListener('resize', paint);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pending) watch(); });
  bar.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'x') { dismissed = player.pb?.device?.id || null; paint(); }
    else if (a === 'go') { bar.classList.remove('show'); playOnThisPhone(); }
  });
  paint();
}
