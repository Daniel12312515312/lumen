// Hash routes look like  #/<tab>/<type>/<id>  e.g. #/library/playlist/37i9dQ…
export const TABS = ['home', 'search', 'library'];
export const navStack = [];

export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const tab = TABS.includes(parts[0]) ? parts[0] : 'home';
  const rest = TABS.includes(parts[0]) ? parts.slice(1) : [];
  return { tab, type: rest[0] || null, id: rest[1] || null, key: '#/' + [tab, ...rest.map(encodeURIComponent)].join('/') };
}

export const currentTab = () => parseRoute().tab;

/** Open a sub-page inside the current tab, e.g. go('album/123'). */
export function go(path) { location.hash = `#/${currentTab()}/${path}`; }
export function goTab(tab) { location.hash = `#/${tab}`; }
export function back() {
  if (navStack.length > 1) history.back();
  else goTab(currentTab());
}
