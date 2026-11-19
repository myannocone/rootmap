/**
 * Web Yahoo refresh via /api/sync (cookie OAuth tokens).
 * Overwrites cached "My Teams & Leagues" names and week points.
 */

const GENERIC_YAHOO_SECTION_RE = /^(my\s*teams?\s*(?:&|and)\s*leagues?|my\s*teams?|my\s*leagues?|yahoo\s*league|mail|inbox|e-?mail|account|my\s*account|sign\s*in|sign\s*out|log\s*in|log\s*out|settings|home|news|profile|notifications?|menu|nav)$/i;

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
  return '';
}

function identityTail(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? match[1] : '';
}

/** Stable league + team identity so Yahoo scrapes do not list the same team twice. */
export function canonicalLeagueIdentity(league) {
  if (!league || typeof league !== 'object') return '';
  const platform = String(league.platform || '').toLowerCase();
  const yahooKey = yahooLeagueIdOf(league);
  const yahooNumeric = identityTail(yahooKey)
    || identityTail(league.yahooLeagueId)
    || (String(league.id || '').match(/^yahoo-.*?(\d+)$/i) || [])[1]
    || '';
  const yahooTeam = identityTail(league.yahooTeamId || league.teamKey || league.teamId);
  const teamName = String(league.myTeamName || league.teamName || league.userTeam?.name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (platform.includes('yahoo') || yahooKey || /^yahoo-/i.test(String(league.id || ''))) {
    const leaguePart = yahooNumeric || yahooKey;
    if (!leaguePart) return '';
    return `yahoo:${leaguePart}:${yahooTeam || teamName}`;
  }
  if (platform.includes('sleeper') || league.sleeperLeagueId) {
    return `sleeper:${league.sleeperLeagueId || league.id || ''}`;
  }
  if (platform.includes('espn') || league.espnLeagueId) {
    return `espn:${league.espnLeagueId || ''}:${league.espnTeamId || league.teamId || ''}`;
  }
  return league.id ? `id:${league.id}` : '';
}

function leagueRichness(league) {
  const starters = (league?.portfolio || league?.userTeam?.starters || []).length;
  const title = String(league?.leagueName || league?.name || '');
  return starters * 10 + (title && !isGenericYahooLeagueName(title) ? 3 : 0);
}

function mergeDuplicateLeague(existing, incoming) {
  const primary = leagueRichness(existing) >= leagueRichness(incoming) ? existing : incoming;
  const secondary = primary === existing ? incoming : existing;
  const custom = String(existing?.customLeagueName || incoming?.customLeagueName || '').trim();
  const display = String(existing?.displayName || incoming?.displayName || custom).trim();
  return {
    ...secondary,
    ...primary,
    id: existing?.id || incoming?.id,
    customLeagueName: custom,
    displayName: display,
    leagueGroup: existing?.leagueGroup || incoming?.leagueGroup || '',
    yahooLeagueId: existing?.yahooLeagueId || incoming?.yahooLeagueId || primary.yahooLeagueId,
    leagueKey: existing?.leagueKey || incoming?.leagueKey || primary.leagueKey,
    yahooTeamId: existing?.yahooTeamId || incoming?.yahooTeamId || primary.yahooTeamId,
    sleeperLeagueId: existing?.sleeperLeagueId || incoming?.sleeperLeagueId,
    espnLeagueId: existing?.espnLeagueId || incoming?.espnLeagueId,
    espnTeamId: existing?.espnTeamId || incoming?.espnTeamId
  };
}

export function dedupeImportedLeagues(list) {
  const source = Array.isArray(list) ? list.filter(Boolean) : [];
  const out = [];
  const indexByKey = new Map();
  source.forEach((league) => {
    const key = canonicalLeagueIdentity(league);
    if (!key) {
      out.push(league);
      return;
    }
    if (!indexByKey.has(key)) {
      indexByKey.set(key, out.length);
      out.push(league);
      return;
    }
    const index = indexByKey.get(key);
    out[index] = mergeDuplicateLeague(out[index], league);
  });
  if (out.length === source.length && out.every((league, index) => league === source[index])) return source;
  return out;
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
