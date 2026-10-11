// "Install Lumen" card: uses Chrome's install prompt when available, and tells people
// inside in-app browsers (e.g. a link opened from another app) to open Chrome instead.
import { esc } from './util.js';

let deferred = null;
let installed = false;
const slots = new Set();
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inAppBrowser = /; wv\)|FBAN|FBAV|Instagram|Line\/|Claude/i.test(navigator.userAgent);

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; renderAll(); });
addEventListener('appinstalled', () => { deferred = null; installed = true; renderAll(); });

function state() {
  if (installed || standalone()) return 'installed';
  if (deferred) return 'ready';
  if (inAppBrowser && /Android/i.test(navigator.userAgent)) return 'inapp';
  return 'none';
}

function render(slot) {
  const s = state();
  if (s === 'ready') {
    slot.innerHTML = '<div class="install-card glass-card"><img src="icons/icon-192.png" alt="">'
      + '<div class="ic-text"><b>Install Lumen</b><span>Add it to your home screen</span></div>'
      + '<button class="ic-btn" data-install>Install</button></div>';
  } else if (s === 'inapp') {
    const chrome = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
    slot.innerHTML = '<div class="install-card glass-card"><img src="icons/icon-192.png" alt="">'
      + '<div class="ic-text"><b>Open in Chrome to install</b><span>Then ⋮ → Add to home screen</span></div>'
      + `<a class="ic-btn" href="${esc(chrome)}">Open</a></div>`;
  } else slot.innerHTML = '';
}

function renderAll() { for (const s of slots) render(s); }

/** Mount an install card into `slot` (it stays updated and empties once installed). */
export function mountInstall(slot) {
  slots.add(slot);
  render(slot);
  slot.addEventListener('click', async e => {
    if (!e.target.closest('[data-install]') || !deferred) return;
    const d = deferred;
    deferred = null;
    d.prompt();
    const choice = await d.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') installed = true;
    renderAll();
  });
}
