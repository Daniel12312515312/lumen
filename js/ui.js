// Toasts, bottom sheets and the overlay stack (wired into the Android back gesture).
import { $, el } from './util.js';

/* ───────── Overlay stack ───────── */
const overlays = [];

export function pushOverlay(name, close) {
  overlays.push({ name, close });
  history.pushState({ overlay: name, depth: overlays.length }, '', location.href);
}
export const overlayOpen = name => overlays.some(o => o.name === name);
export const overlayCount = () => overlays.length;

addEventListener('popstate', e => {
  const depth = e.state?.depth || 0;
  while (overlays.length > depth) overlays.pop().close();
});

/** Close every overlay (goes back in history) and resolve once done. */
export function closeOverlays() {
  const n = overlays.length;
  if (!n) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { removeEventListener('popstate', check); clearTimeout(t); resolve(); };
    const check = () => { if (!overlays.length) setTimeout(done, 0); };
    const t = setTimeout(() => { while (overlays.length) overlays.pop().close(); done(); }, 700);
    addEventListener('popstate', check);
    history.go(-n);
  });
}

/* ───────── Toast ───────── */
let toastTimer;
export function toast(msg, { action, onAction, duration = 2600 } = {}) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(Object.assign(document.createElement('span'), { textContent: msg }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { textContent: action });
    b.onclick = () => { hideToast(); onAction?.(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}
function hideToast() { $('#toast').classList.remove('show'); }

/* ───────── Bottom sheet ───────── */
export function openSheet(html) {
  const root = $('#sheet-root');
  root.innerHTML = '';
  const scrim = el('<div class="sheet-scrim"></div>');
  const sheet = el(`<div class="sheet" role="dialog"><div class="sheet-grab"></div>${html}</div>`);
  root.append(scrim, sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  pushOverlay('sheet', () => {
    root.classList.remove('open');
    setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 450);
  });
  scrim.addEventListener('click', () => history.back());

  // swipe down to dismiss
  let y0 = null, dy = 0;
  sheet.addEventListener('pointerdown', e => { if (sheet.scrollTop <= 0) { y0 = e.clientY; dy = 0; } });
  sheet.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    if (dy > 4) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) history.back();
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
  return sheet;
}
export const closeSheet = () => history.back();
