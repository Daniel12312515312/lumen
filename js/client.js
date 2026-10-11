// Holds the active data source: the real Spotify API or the offline demo.
export let sp = null;
export let isDemo = false;

export function setClient(client, demo = false) {
  sp = client;
  isDemo = demo;
}
