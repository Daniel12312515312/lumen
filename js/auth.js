// Spotify sign-in with Authorization Code + PKCE (no client secret needed).
import { store } from './util.js';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-follow-read',
].join(' ');

// Client ID of the "Lumen" app in the owner's Spotify developer dashboard (public, not a secret).
// The setup screen can still override it.
export const DEFAULT_CLIENT_ID = '52ce01dd133749ca9e4931abb78c8df6';

export class AuthError extends Error {
  constructor(msg = 'Not signed in') { super(msg); this.auth = true; }
}

function b64url(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a).slice(0, n);
}

let refreshing = null;

export const auth = {
  get clientId() { return localStorage.getItem('lumen.clientId') || DEFAULT_CLIENT_ID; },
  setClientId(v) { localStorage.setItem('lumen.clientId', (v || '').trim()); },
  get redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
  get tokens() { return store('lumen.tokens'); },
  get loggedIn() { return !!this.tokens?.refresh_token; },

  async login() {
    const verifier = randomString(64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const state = randomString(16);
    store('lumen.pkce', { verifier, state });
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: b64url(new Uint8Array(digest)),
      scope: SCOPES,
      state,
    });
    location.href = 'https://accounts.spotify.com/authorize?' + q;
  },

  /** Finishes the login when Spotify sends the user back with ?code=… */
  async handleRedirect() {
    const p = new URLSearchParams(location.search);
    if (!p.has('code') && !p.has('error')) return false;
    const saved = store('lumen.pkce');
    history.replaceState(null, '', this.redirectUri + location.hash);
    if (p.get('error')) throw new Error(`Spotify sign-in was cancelled (${p.get('error')}).`);
    if (!saved || saved.state !== p.get('state')) throw new Error('The sign-in session expired — please try again.');
    const t = await tokenRequest({
      grant_type: 'authorization_code',
      code: p.get('code'),
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: saved.verifier,
    });
    store('lumen.pkce', null);
    this.save(t);
    return true;
  },

  save(t) {
    const prev = this.tokens || {};
    store('lumen.tokens', {
      access_token: t.access_token,
      refresh_token: t.refresh_token || prev.refresh_token,
      expires_at: Date.now() + (t.expires_in || 3600) * 1000,
    });
  },

  async getToken() {
    const t = this.tokens;
    if (!t) throw new AuthError();
    if (Date.now() < t.expires_at - 60_000) return t.access_token;
    return this.refresh();
  },

  refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const t = this.tokens;
          if (!t?.refresh_token) throw new AuthError();
          this.save(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: this.clientId }));
          return this.tokens.access_token;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  },

  logout() { store('lumen.tokens', null); },
};

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_grant') auth.logout();
    const msg = data.error_description || data.error || 'Spotify sign-in failed.';
    // only real credential problems end the session; server hiccups just fail this request
    throw res.status === 400 || res.status === 401 ? new AuthError(msg) : new Error(msg);
  }
  return data;
}
