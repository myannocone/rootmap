import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import {
  dedupeImportedLeagues,
  preferYahooLeagueName,
  preferYahooLeagueOverTeam
} from './utils/yahooSync';

const LEAGUES_KEY = 'rootmap_leagues';

function mergeOne(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const teamName = preferYahooLeagueName(next.myTeamName, prev.myTeamName, next.teamName, prev.teamName);
  const name = preferYahooLeagueOverTeam(
    teamName,
    next.leagueName,
    next.name,
    prev.leagueName,
    prev.name
  );
  return {
    ...prev,
    ...next,
    id: prev.id || next.id,
    name,
    leagueName: name,
    teamName,
    myTeamName: teamName || 'My Team',
    customLeagueName: prev.customLeagueName || next.customLeagueName || '',
    displayName: prev.displayName || next.displayName || prev.customLeagueName || next.customLeagueName || ''
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
  localStorage.setItem(LEAGUES_KEY, JSON.stringify(dedupeImportedLeagues([...byId.values()])));
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
