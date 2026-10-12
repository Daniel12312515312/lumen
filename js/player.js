// Playback state: polls Spotify, interpolates the position smoothly, and sends commands.
import { sp, isDemo } from './client.js';
import { toast } from './ui.js';

const subs = new Set();
const contextNames = new Map();
const isNoDevice = e => e?.status === 404 && (e.reason === 'NO_ACTIVE_DEVICE' || /device/i.test(e.message || ''));

export const player = {
  pb: null,          // normalized playback state
  basePos: 0,        // position (ms) at baseAt
  baseAt: 0,         // performance.now() timestamp
  lastActionAt: 0,
  fast: false,
  timer: null,
  liked: null,
  upNext: [],
  contextName: '',
  me: null,
  lastSkip: { dir: 0, at: 0 },

  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  emit(type, data) {
    for (const f of subs) { try { f(type, data); } catch (e) { console.error(e); } }
  },

  get track() { return this.pb?.item || null; },
  get playing() { return !!this.pb?.isPlaying; },
  position() {
    if (!this.pb) return 0;
    const p = this.basePos + (this.pb.isPlaying ? performance.now() - this.baseAt : 0);
    return Math.max(0, Math.min(this.track?.duration || p, p));
  },

  start() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); });
    this.poll();
  },
  setFast(v) { this.fast = v; if (v) this.schedule(250); },
  schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.poll(), ms); },

  async poll() {
    clearTimeout(this.timer);
    if (document.hidden) return;
    const started = performance.now();
    try {
      const pb = await sp.playback();
      if (started >= this.lastActionAt) this.apply(pb, performance.now() - started);
    } catch (e) {
      if (e.auth) { this.emit('auth'); return; }
      console.warn('poll failed', e);
    }
    let next = this.fast ? 2000 : 4500;
    if (this.pb?.isPlaying && this.track) {
      const left = this.track.duration - this.position();
      if (left > 0 && left + 350 < next) next = left + 350;
    }
    this.schedule(next);
  },

  apply(pb, rtt = 0) {
    const prevUri = this.track?.uri;
    const wasPlaying = this.playing;
    const predicted = this.position();
    if (!pb || !pb.item) {
      this.pb = pb && pb.item ? pb : (pb ? { ...pb, item: null } : null);
      if (prevUri) this.emit('track');
      this.emit('state');
      return;
    }
    const pos = pb.progress + (pb.isPlaying ? Math.min(rtt, 1500) / 2 : 0);
    const same = prevUri === pb.item.uri;
    this.pb = pb;
    if (!same || pb.isPlaying !== wasPlaying || Math.abs(pos - predicted) > 450) {
      this.basePos = pos;
      this.baseAt = performance.now();
    }
    if (!same) this.trackChanged();
    this.emit('state');
  },

  trackChanged() {
    this.liked = null;
    this.emit('track');
    this.checkLiked();
    this.resolveContext();
    clearTimeout(this.qTimer);
    this.qTimer = setTimeout(() => this.refreshQueue(), 900);
  },

  /** Apply a local (optimistic) change right away. */
  local(patch) {
    const pos = this.position();
    const prevUri = this.track?.uri;
    this.pb = { ...(this.pb || {}), ...patch };
    this.basePos = patch.progress ?? pos;
    this.baseAt = performance.now();
    this.lastActionAt = performance.now();
    if (this.track?.uri !== prevUri) this.trackChanged();
    this.emit('state');
  },

  async act(fn, { optimistic, polls = [400, 1600] } = {}) {
    this.lastActionAt = performance.now();
    if (optimistic) this.local(optimistic);
    try {
      await this.withDevice(fn);
    } catch (e) {
      this.handleError(e);
    }
    this.lastActionAt = performance.now();
    polls.forEach(d => setTimeout(() => this.poll(), d));
  },

  async withDevice(fn) {
    try {
      return await fn(undefined);
    } catch (e) {
      if (!isNoDevice(e)) throw e;
      const devices = await sp.devices();
      const d = devices.find(x => x.active) || devices.find(x => x.type === 'Smartphone') || devices[0];
      if (!d) { const err = new Error('No device'); err.noDevice = true; throw err; }
      return fn(d.id);
    }
  },

  handleError(e) {
    console.warn(e);
    if (e.noDevice) {
      toast('Open Spotify on your phone first', { action: 'Open Spotify', onAction: () => { location.href = 'spotify:'; }, duration: 7000 });
    } else if (e.auth) {
      this.emit('auth');
    } else if (e.status === 403) {
      toast('Spotify didn’t allow that right now');
    } else if (e.status === 429) {
      toast('Spotify is busy — try again in a moment');
    } else {
      toast('Couldn’t reach Spotify');
    }
  },

  /* ───── Commands ───── */
  toggle() {
    if (!this.track) return this.act(id => sp.play({ deviceId: id }));
    const playing = this.playing;
    return this.act(id => (playing ? sp.pause(id) : sp.play({ deviceId: id })), { optimistic: { isPlaying: !playing } });
  },
  pause() {
    if (!this.playing) return Promise.resolve();
    return this.act(id => sp.pause(id), { optimistic: { isPlaying: false } });
  },
  next() {
    this.lastSkip = { dir: 1, at: performance.now() };
    const n = this.upNext[0];
    this.upNext = this.upNext.slice(1);
    return this.act(id => sp.next(id), { optimistic: n ? { item: n, progress: 0 } : undefined, polls: [350, 1200, 2600] });
  },
  prev() {
    if (this.position() > 3500) return this.seek(0);
    this.lastSkip = { dir: -1, at: performance.now() };
    return this.act(id => sp.prev(id), { polls: [350, 1200, 2600] });
  },
  seek(ms) {
    ms = Math.max(0, Math.round(ms));
    return this.act(id => sp.seek(ms, id), { optimistic: { progress: ms }, polls: [900] });
  },
  shuffle() {
    const v = !this.pb?.shuffle;
    return this.act(id => sp.shuffle(v, id), { optimistic: { shuffle: v }, polls: [600] }).then(() => this.refreshQueue());
  },
  repeat() {
    const order = ['off', 'context', 'track'];
    const v = order[(order.indexOf(this.pb?.repeat || 'off') + 1) % 3];
    return this.act(id => sp.repeat(v, id), { optimistic: { repeat: v }, polls: [600] });
  },

  /** Play a playlist/album/artist (optionally starting at a track). */
  playContext(contextUri, { offsetUri, offsetPosition, track, shuffle } = {}) {
    return this.act(async id => {
      if (shuffle !== undefined && shuffle !== !!this.pb?.shuffle) await sp.shuffle(shuffle, id).catch(() => {});
      await sp.play({ contextUri, offsetUri, offsetPosition, deviceId: id });
    }, { optimistic: track ? { item: track, progress: 0, isPlaying: true, ...(shuffle !== undefined ? { shuffle } : {}) } : undefined });
  },
  playUris(tracks, index = 0) {
    const slice = tracks.slice(index, index + 100);
    return this.act(id => sp.play({ uris: slice.map(t => t.uri), deviceId: id }), {
      optimistic: { item: slice[0], progress: 0, isPlaying: true },
    });
  },
  /** Liked Songs: try the collection context, fall back to a list of URIs. */
  playLiked(tracks, index = 0, shuffle) {
    const uri = this.me ? `spotify:user:${this.me.id}:collection` : null;
    const slice = tracks.slice(index, index + 100);
    return this.act(async id => {
      if (shuffle !== undefined && shuffle !== !!this.pb?.shuffle) await sp.shuffle(shuffle, id).catch(() => {});
      if (uri) {
        try { await sp.play({ contextUri: uri, offsetUri: tracks[index]?.uri, deviceId: id }); return; } catch (e) { if (isNoDevice(e)) throw e; }
      }
      await sp.play({ uris: slice.map(t => t.uri), deviceId: id });
    }, { optimistic: { item: tracks[index], progress: 0, isPlaying: true } });
  },
  async addToQueue(track) {
    try {
      await this.withDevice(id => sp.addToQueue(track.uri, id));
      toast('Added to queue');
      this.refreshQueue();
    } catch (e) { this.handleError(e); }
  },
  async skipTo(k) {
    await this.act(async id => { for (let i = 0; i <= k; i++) await sp.next(id); }, { polls: [300, 1200] });
    this.refreshQueue();
  },
  async transfer(device) {
    try {
      await sp.transfer(device.id, true);
      toast(`Playing on ${device.name}`);
    } catch (e) { this.handleError(e); }
    setTimeout(() => this.poll(), 700);
  },

  /* ───── Likes / queue / context ───── */
  async checkLiked() {
    const t = this.track;
    if (!t?.uri || t.type !== 'track' || t.isLocal) return;
    try {
      const [v] = await sp.libraryContains([t.uri]);
      if (this.track?.uri === t.uri) { this.liked = !!v; this.emit('liked'); }
    } catch { /* ignore */ }
  },
  async setLiked(track, value) {
    if (!track?.uri) return;
    const isCurrent = track.uri === this.track?.uri;
    if (isCurrent) { this.liked = value; this.emit('liked'); }
    try {
      if (value) await sp.librarySave([track.uri]);
      else await sp.libraryRemove([track.uri]);
      toast(value ? 'Added to Liked Songs' : 'Removed from Liked Songs');
      this.emit('library');
    } catch (e) {
      if (isCurrent) { this.liked = !value; this.emit('liked'); }
      this.handleError(e);
    }
  },
  async refreshQueue() {
    try {
      const q = await sp.queue();
      this.upNext = q.queue || [];
      this.emit('queue');
    } catch { /* ignore */ }
  },
  async resolveContext() {
    const c = this.pb?.context;
    const t = this.track;
    let name = '';
    if (c?.uri) {
      if (contextNames.has(c.uri)) name = contextNames.get(c.uri);
      else {
        const [, type, id] = c.uri.split(':');
        try {
          if (c.uri.endsWith(':collection') || c.type === 'collection') name = 'Liked Songs';
          else if (type === 'album') name = t?.album?.name || '';
          else if (type === 'playlist') name = (await sp.playlistMeta(id))?.name || '';
          else if (type === 'artist') name = (await sp.artist(id))?.name || '';
        } catch { /* ignore */ }
        if (name) contextNames.set(c.uri, name);
      }
    }
    this.contextName = name || t?.album?.name || '';
    this.contextType = !c?.uri ? null : c.uri.endsWith(':collection') ? 'collection' : c.type;
    this.emit('context');
  },
};

export const demoMode = () => isDemo;
