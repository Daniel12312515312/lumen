// Turns raw Spotify Web API objects into the small shapes the UI uses.
// The demo client builds these shapes directly.

export function pickImage(images, size = 300) {
  if (!images || !images.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 640) - (b.width || 640));
  const fit = sorted.find(i => (i.width || 640) >= size);
  return (fit || sorted[sorted.length - 1]).url;
}

function decode(s) {
  if (!s) return '';
  const d = new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html');
  return (d.body.textContent || '').trim();
}

export function nAlbumRef(a) {
  if (!a) return { id: null, uri: null, name: '', image: null, imageLarge: null };
  if ('imageLarge' in a) return a; // already normalized
  return { id: a.id, uri: a.uri, name: a.name || '', image: pickImage(a.images, 300), imageLarge: pickImage(a.images, 640) };
}

export function nTrack(t, albumOverride) {
  if (!t) return null;
  const isEp = t.type === 'episode';
  const artists = isEp
    ? (t.show ? [{ id: t.show.id, uri: t.show.uri, name: t.show.name }] : [])
    : (t.artists || []).map(a => ({ id: a.id, uri: a.uri, name: a.name }));
  const album = t.album ? nAlbumRef(t.album)
    : isEp ? nAlbumRef({ name: t.show?.name, images: t.images || t.show?.images })
    : nAlbumRef(albumOverride);
  return {
    type: t.type || 'track',
    id: t.id,
    uri: t.uri,
    name: t.name || 'Unknown',
    duration: t.duration_ms || 0,
    explicit: !!t.explicit,
    artists,
    album,
    trackNumber: t.track_number,
    isLocal: !!t.is_local,
    isPlayable: t.is_playable !== false,
  };
}

export function nPlaylist(p) {
  if (!p) return null;
  const page = p.items || p.tracks;
  return {
    type: 'playlist',
    id: p.id,
    uri: p.uri,
    name: p.name || 'Playlist',
    description: decode(p.description),
    image: pickImage(p.images, 300),
    imageLarge: pickImage(p.images, 640),
    owner: p.owner?.display_name || p.owner?.id || '',
    ownerId: p.owner?.id || '',
    total: page && typeof page.total === 'number' ? page.total : null,
  };
}

export function nAlbum(a) {
  if (!a) return null;
  return {
    type: 'album',
    id: a.id,
    uri: a.uri,
    name: a.name || 'Album',
    artists: (a.artists || []).map(x => ({ id: x.id, uri: x.uri, name: x.name })),
    image: pickImage(a.images, 300),
    imageLarge: pickImage(a.images, 640),
    year: (a.release_date || '').slice(0, 4),
    albumType: a.album_type || 'album',
    total: a.total_tracks || 0,
  };
}

export function nArtist(a) {
  if (!a) return null;
  return {
    type: 'artist',
    id: a.id,
    uri: a.uri,
    name: a.name || 'Artist',
    image: pickImage(a.images, 300),
    imageLarge: pickImage(a.images, 900),
    genres: a.genres || [],
  };
}

export function nPlayback(d) {
  if (!d) return null;
  return {
    isPlaying: !!d.is_playing,
    progress: d.progress_ms || 0,
    item: nTrack(d.item),
    shuffle: !!d.shuffle_state,
    repeat: d.repeat_state || 'off',
    device: d.device ? {
      id: d.device.id, name: d.device.name, type: d.device.type,
      volume: d.device.volume_percent, supportsVolume: !!d.device.supports_volume,
    } : null,
    context: d.context ? { uri: d.context.uri, type: d.context.type } : null,
  };
}
