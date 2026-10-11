# Lumen

A cleaner, glassy skin for Spotify on Android (made for the Galaxy S25): a home-screen web app
that shows your library, playlists and the current song over a living, blurred album-colour
background, with Beautiful-Lyrics-style glowing synced lyrics.

- Plays through the real Spotify app (Spotify Connect) — Lumen is the remote and the looks.
- Plain HTML/CSS/JS, no build step. Host the folder on any HTTPS static host (GitHub Pages).
- Sign-in: Spotify Authorization Code + PKCE with your own Client ID (Development Mode, Premium).
- Lyrics: [LRCLIB](https://lrclib.net) (line-synced; word timing is estimated, enhanced LRC used when present).
- Demo without Spotify: open `…/?demo`.

Spotify's Development Mode only lists songs of playlists you own or collaborate on; other
playlists can still be played and shuffled.
