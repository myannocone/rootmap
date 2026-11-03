import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

const LEAGUES_KEY = 'rootmap_leagues';

function mergeLeagues(incoming) {
  let existing = [];
  try {
    existing = JSON.parse(localStorage.getItem(LEAGUES_KEY) || '[]');
  } catch {
    existing = [];
  }
  if (!Array.isArray(existing)) existing = [];
  const byId = new Map();
  existing.forEach((league, index) => {
    if (!league) return;
    byId.set(league.id ? String(league.id) : `legacy-${index}`, league);
  });
  incoming.forEach((league) => {
    if (league?.id) byId.set(String(league.id), league);
  });
  localStorage.setItem(LEAGUES_KEY, JSON.stringify([...byId.values()]));
}

App.addListener('appUrlOpen', async (event) => {
  const url = String(event?.url || '');
  const hashAt = url.indexOf('#');
  if (!url.startsWith('rootmap://yahoo-synced') || hashAt === -1) return;
  try {
    const incoming = JSON.parse(decodeURIComponent(url.slice(hashAt + 1)));
    if (Array.isArray(incoming)) mergeLeagues(incoming);
  } catch {
    // The board reloads with whatever was already saved.
  }
  try {
    await Browser.close();
  } catch {
    // The sign-in sheet may already be gone.
  }
  window.location.replace('/?yahoo=synced');
});
