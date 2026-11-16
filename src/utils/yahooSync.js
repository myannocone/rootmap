/**
 * Web Yahoo refresh via /api/sync (cookie OAuth tokens).
 * Overwrites cached "My Teams & Leagues" names and week points.
 */

const GENERIC_YAHOO_SECTION_RE = /^(my\s*teams?\s*(?:&|and)\s*leagues?|my\s*teams?|my\s*leagues?|yahoo\s*league)$/i;

export function isGenericYahooLeagueName(name) {
  return GENERIC_YAHOO_SECTION_RE.test(String(name || '').trim());
}

export function yahooLeagueIdOf(league) {
  if (!league || typeof league !== 'object') return '';
  if (league.leagueKey) return String(league.leagueKey);
  if (league.yahooLeagueId) {
    const raw = String(league.yahooLeagueId);
    return raw.includes('.l.') ? raw : '';
  }
  const id = String(league.id || '');
  const match = id.match(/^yahoo-(.+\.l\.\d+)/i);
  return match ? match[1] : '';
}

/** Prefer a real Yahoo league name over the section header cached in localStorage. */
export function preferYahooLeagueName(...candidates) {
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name && !isGenericYahooLeagueName(name)) return name;
  }
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name) return name;
  }
  return '';
}

function yahooNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** League header name that is never the fantasy team nickname. */
export function preferYahooLeagueOverTeam(teamName, ...leagueCandidates) {
  const teamKey = yahooNameKey(teamName);
  for (const candidate of leagueCandidates) {
    const name = String(candidate || '').trim();
    if (!name || isGenericYahooLeagueName(name)) continue;
    if (teamKey && yahooNameKey(name) === teamKey) continue;
    return name;
  }
  for (const candidate of leagueCandidates) {
    const name = String(candidate || '').trim();
    if (name && !isGenericYahooLeagueName(name) && yahooNameKey(name) !== teamKey) return name;
  }
  return 'Yahoo League';
}

/**
 * Fetch the latest Yahoo leagues from /api/sync using HttpOnly cookies.
 * Returns null when no Yahoo session is available (401).
 */
export async function syncYahooLeaguesFromApi({ week } = {}) {
  const params = new URLSearchParams();
  if (week != null && Number(week) >= 1) params.set('week', String(week));
  const query = params.toString();
  const response = await fetch(query ? `/api/sync?${query}` : '/api/sync', {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(data.error || data.details || `Yahoo sync failed (${response.status})`);
  }
  const leagues = Array.isArray(data.leagues) ? data.leagues : [];
  return leagues.map((league) => {
    const teamName = preferYahooLeagueName(league.myTeamName, league.teamName, league.userTeam?.name);
    const leagueName = preferYahooLeagueOverTeam(
      teamName,
      league.leagueName,
      league.name
    );
    return {
      ...league,
      name: leagueName,
      leagueName,
      teamName,
      myTeamName: teamName || league.myTeamName
    };
  });
}
