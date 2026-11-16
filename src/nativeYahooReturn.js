import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { isGenericYahooLeagueName, preferYahooLeagueName } from './utils/yahooSync';

const LEAGUES_KEY = 'rootmap_leagues';

function mergeOne(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const name = preferYahooLeagueName(next.leagueName, next.name, prev.leagueName, prev.name);
  return {
    ...prev,
    ...next,
    id: prev.id || next.id,
    name,
    leagueName: name,
    myTeamName: preferYahooLeagueName(next.myTeamName, prev.myTeamName) || name
  };
}

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
    if (!league?.id) return;
    byId.set(String(league.id), mergeOne(byId.get(String(league.id)), league));
  });
  incoming.forEach((league) => {
    if (!league) return;
    const leagueKey = String(league.leagueKey || league.yahooLeagueId || '');
    if (!leagueKey) return;
    byId.forEach((saved, id) => {
      const savedKey = String(saved.leagueKey || saved.yahooLeagueId || '');
      if (savedKey !== leagueKey || id === String(league.id)) return;
      if (isGenericYahooLeagueName(saved.name) || isGenericYahooLeagueName(saved.leagueName)) {
        byId.set(id, mergeOne(saved, { ...league, id: saved.id }));
      }
    });
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
