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

/** Numeric Yahoo league id shared by API (`414.l.123`) and scrape (`123`) rows. */
export function yahooLeagueNumOf(league) {
  if (!league || typeof league !== 'object') return '';
  const key = yahooLeagueIdOf(league);
  if (key) {
    const fromKey = key.match(/\.l\.(\d+)/i);
    if (fromKey) return fromKey[1];
  }
  const raw = String(league.yahooLeagueId || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const fromRaw = raw.match(/\.l\.(\d+)/i);
  if (fromRaw) return fromRaw[1];
  const id = String(league.id || '');
  const embedded = id.match(/\.l\.(\d+)/i);
  if (embedded) return embedded[1];
  // yahoo-123456 or yahoo-123456-7 (never treat the trailing team id as the league).
  const scrape = id.match(/^yahoo-(\d+)(?:-\d+)?$/i);
  return scrape ? scrape[1] : '';
}

/** Numeric Yahoo team id from team_key, yahooTeamId, or scrape id suffix. */
export function yahooTeamNumOf(league) {
  if (!league || typeof league !== 'object') return '';
  const raw = String(league.yahooTeamId || league.teamKey || league.teamId || '').trim();
  if (raw.includes('.t.')) return raw.split('.t.').pop() || '';
  if (/^\d+$/.test(raw)) return raw;
  const id = String(league.id || '');
  const scrape = id.match(/^yahoo-(?:\d+\.l\.)?\d+-(\d+)$/i) || id.match(/^yahoo-\d+-(\d+)$/i);
  return scrape ? scrape[1] : '';
}

function yahooTeamNameKey(league) {
  return String(league?.myTeamName || league?.teamName || league?.userTeam?.name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Prefer a real Yahoo league name over the section header cached in localStorage. */
export function preferYahooLeagueName(...candidates) {
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name && !isGenericYahooLeagueName(name)) return name;
  }
  return '';
}

/**
 * Stable league + team identity so Yahoo API (`yahoo-414.l.123`) and scrape
 * (`yahoo-123-1`) rows collapse to one board entry.
 */
export function canonicalLeagueIdentity(league) {
  if (!league || typeof league !== 'object') return '';
  const platform = String(league.platform || '').toLowerCase();
  const yahooNum = yahooLeagueNumOf(league);
  const yahooTeam = yahooTeamNumOf(league);
  const teamName = yahooTeamNameKey(league);
  if (platform.includes('yahoo') || yahooNum || /^yahoo-/i.test(String(league.id || ''))) {
    if (!yahooNum) return '';
    return `yahoo:${yahooNum}:${yahooTeam || teamName || 'team'}`;
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
  const starters = (league?.portfolio || league?.userTeam?.starters || []).length
    + (league?.threats || league?.oppTeam?.starters || []).length;
  const title = String(league?.leagueName || league?.name || '');
  const hasFullKey = Boolean(yahooLeagueIdOf(league) || String(league?.leagueKey || '').includes('.l.'));
  return starters * 10
    + (title && !isGenericYahooLeagueName(title) ? 3 : 0)
    + (hasFullKey ? 2 : 0)
    + (yahooTeamNumOf(league) ? 1 : 0);
}

function mergeDuplicateLeague(existing, incoming) {
  const primary = leagueRichness(existing) >= leagueRichness(incoming) ? existing : incoming;
  const secondary = primary === existing ? incoming : existing;
  const custom = String(existing?.customLeagueName || incoming?.customLeagueName || '').trim();
  const display = String(existing?.displayName || incoming?.displayName || custom).trim();
  const leagueKey = existing?.leagueKey || incoming?.leagueKey || primary.leagueKey || '';
  const yahooLeagueId = existing?.yahooLeagueId || incoming?.yahooLeagueId || primary.yahooLeagueId || leagueKey;
  const preferredId = leagueKey && String(leagueKey).includes('.l.')
    ? `yahoo-${leagueKey}`
    : (existing?.id || incoming?.id);
  return {
    ...secondary,
    ...primary,
    id: preferredId,
    customLeagueName: custom,
    displayName: display,
    yahooLeagueId,
    leagueKey: leagueKey || yahooLeagueId,
    yahooTeamId: existing?.yahooTeamId || incoming?.yahooTeamId || primary.yahooTeamId,
    teamKey: existing?.teamKey || incoming?.teamKey || primary.teamKey,
    sleeperLeagueId: existing?.sleeperLeagueId || incoming?.sleeperLeagueId,
    espnLeagueId: existing?.espnLeagueId || incoming?.espnLeagueId,
    espnTeamId: existing?.espnTeamId || incoming?.espnTeamId
  };
}

function yahooTeamsCompatible(a, b) {
  const teamA = yahooTeamNumOf(a);
  const teamB = yahooTeamNumOf(b);
  if (teamA && teamB) return teamA === teamB;
  const nameA = yahooTeamNameKey(a);
  const nameB = yahooTeamNameKey(b);
  if (nameA && nameB) return nameA === nameB;
  // Only one side has identity — treat as the same team for scrape/API merges.
  return true;
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

  // Second pass: collapse Yahoo rows that share a league number but split on
  // missing team ids (API has `.t.1`, scrape only has the nickname).
  const collapsed = [];
  out.forEach((league) => {
    const yahooNum = yahooLeagueNumOf(league);
    const isYahoo = String(league?.platform || '').toLowerCase().includes('yahoo')
      || Boolean(yahooNum)
      || /^yahoo-/i.test(String(league?.id || ''));
    if (!isYahoo || !yahooNum) {
      collapsed.push(league);
      return;
    }
    const matchIndex = collapsed.findIndex((item) => (
      yahooLeagueNumOf(item) === yahooNum && yahooTeamsCompatible(item, league)
    ));
    if (matchIndex < 0) {
      collapsed.push(league);
      return;
    }
    collapsed[matchIndex] = mergeDuplicateLeague(collapsed[matchIndex], league);
  });

  if (collapsed.length === source.length && collapsed.every((league, index) => league === source[index])) {
    return source;
  }
  return collapsed;
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
  return dedupeImportedLeagues(leagues.map((league) => {
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
  }));
}
