// Sleep timer: pauses Spotify after N minutes or when the current song ends.
// It runs inside Lumen, so it's exact while Lumen is open; if the phone puts Lumen to
// sleep in the background it catches up (pauses) as soon as Lumen runs again.
import { store } from './util.js';
import { player } from './player.js';
import { toast } from './ui.js';

const KEY = 'lumen.sleep';
const subs = new Set();
let timer = 0;

const read = () => store(KEY);
const emit = () => subs.forEach(f => f());

function fire() {
  stop();
  if (player.playing) player.pause();
  toast('Sleep timer — music paused', { duration: 5000 });
}

function stop() {
  clearTimeout(timer);
  store(KEY, null);
  emit();
}

function check() {
  clearTimeout(timer);
  const s = read();
  if (!s) return;
  if (s.until) {
    const left = s.until - Date.now();
    if (left < -30 * 60_000) { stop(); return; } // came back far too late: just forget it
    if (left <= 0) { fire(); return; }
    timer = setTimeout(check, Math.min(left, 15_000));
  } else if (s.endOfTrack) {
    const t = player.track;
    if (t && t.uri !== s.trackUri) { fire(); return; } // the song already changed
    const left = t ? t.duration - player.position() : Infinity;
    if (player.playing && left < 1200) { fire(); return; }
    timer = setTimeout(check, player.playing && left < 6000 ? 250 : 2000);
  }
  emit();
}

export const sleepTimer = {
  get active() { return !!read(); },
  get endOfTrack() { return !!read()?.endOfTrack; },
  /** ms left, or null (end-of-song mode / off). */
  remaining() { const s = read(); return s?.until ? Math.max(0, s.until - Date.now()) : null; },
  label() {
    const s = read();
    if (!s) return '';
    if (s.endOfTrack) return 'End of song';
    const m = Math.ceil(this.remaining() / 60_000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`;
  },
  start(minutes) { store(KEY, { until: Date.now() + minutes * 60_000 }); check(); },
  startEndOfTrack() { store(KEY, { endOfTrack: true, trackUri: player.track?.uri || null }); check(); },
  cancel() { stop(); },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  init() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    player.on(type => { if (type === 'track' && read()?.endOfTrack) check(); });
    setInterval(() => { if (read()) emit(); }, 30_000); // keep the minutes shown fresh
    check();
  },
};
