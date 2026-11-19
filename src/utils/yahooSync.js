/**
 * Web Yahoo refresh via /api/sync (cookie OAuth tokens).
 * Overwrites cached "My Teams & Leagues" names and week points.
 */

const GENERIC_YAHOO_SECTION_RE = /^(my\s*teams?\s*(?:&|and)\s*leagues?|my\s*teams?|my\s*leagues?|yahoo\s*league(?:\s*\d+)?|league(?:\s*\d+)?|mail|inbox|e-?mail|account|my\s*account|sign\s*in|sign\s*out|log\s*in|log\s*out|settings|home|news|profile|notifications?|menu|nav)$/i;

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

function yahooToken(value) {
  const text = String(value || '').trim();
  if (!text || isGenericYahooLeagueName(text)) return '';
  if (/^(my team|opponent|team\s*\d+)$/i.test(text)) return '';
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function yahooRecordToken(league) {
  const record = league?.myRecord || league?.userTeam?.record || league?.record;
  if (!record) return '';
  if (typeof record === 'string') {
    const match = record.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
    return match ? `${Number(match[1])}-${Number(match[2])}-${Number(match[3])}` : '';
  }
  const wins = record.wins ?? record.w;
  const losses = record.losses ?? record.l;
  if (wins == null || losses == null) return '';
  const ties = record.ties ?? record.t ?? 0;
  return `${Number(wins)}-${Number(losses)}-${Number(ties)}`;
}

/** team + opponent + record, used only when a Yahoo league id was never stored. */
export function yahooMatchupFingerprint(league) {
  const team = yahooToken(league?.myTeamName || league?.teamName || league?.userTeam?.name);
  const opp = yahooToken(league?.oppTeamName || league?.opponent || league?.oppTeam?.name);
  if (!team || !opp) return '';
  return `${team}|${opp}|${yahooRecordToken(league)}`;
}

function isYahooRow(league) {
  return String(league?.platform || '').toLowerCase().includes('yahoo')
    || Boolean(yahooLeagueNumOf(league))
    || /^yahoo-/i.test(String(league?.id || ''));
}

function yahooRowsSame(a, b) {
  if (!isYahooRow(a) || !isYahooRow(b)) return false;
  const numA = yahooLeagueNumOf(a);
  const numB = yahooLeagueNumOf(b);
  if (numA && numB) return numA === numB;
  const fingerA = yahooMatchupFingerprint(a);
  const fingerB = yahooMatchupFingerprint(b);
  if (!fingerA || !fingerB) return false;
  const [teamA, oppA, recA] = fingerA.split('|');
  const [teamB, oppB, recB] = fingerB.split('|');
  if (teamA !== teamB || oppA !== oppB) return false;
  if (recA && recB && recA !== recB) return false;
  return true;
}

function titlePartIsLeague(part) {
  const text = String(part || '').trim();
  if (!text || text.length > 60 || isGenericYahooLeagueName(text)) return '';
  if (/yahoo|fantasy|football|week\s*\d+|mail|inbox|account|settings|news|profile/i.test(text)) return '';
  return text;
}

/** Pull a real league title out of a capture's title, og:title, or embedded JSON. */
export function extractYahooLeagueTitle(result) {
  const html = String(result?.html || '');
  const blobs = [result?.leagueName, result?.title, result?.ogTitle, result?.pageText];
  for (const blob of blobs) {
    const line = String(blob || '').match(/(?:^|\n)\s*League:\s*([^\n<]{2,60})/i);
    const titled = titlePartIsLeague(line?.[1]);
    if (titled) return titled;
  }
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const docTitle = html.match(/<title>([^<]+)<\/title>/i);
  const titledSources = [og?.[1], docTitle?.[1], result?.title, result?.ogTitle];
  for (const source of titledSources) {
    const parts = String(source || '').split(/\s[-|–—]\s/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const titled = titlePartIsLeague(part);
      if (titled) return titled;
    }
  }
  const packed = `${html}\n${result?.pageText || ''}`;
  const patterns = [
    /"league_key"\s*:\s*"\d+\.l\.\d+"[\s\S]{0,280}?"name"\s*:\s*"([^"\\]{2,60})"/,
    /"name"\s*:\s*"([^"\\]{2,60})"[\s\S]{0,280}?"league_key"\s*:\s*"\d+\.l\.\d+"/,
    /"league_name"\s*:\s*"([^"\\]{2,60})"/
  ];
  for (const pattern of patterns) {
    const match = packed.match(pattern);
    const titled = titlePartIsLeague(match?.[1]);
    if (titled) return titled;
  }
  return '';
}

/** Real league title, then the fantasy team nickname. Never "League 3". */
export function resolvedYahooLeagueName(candidates, teamName) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    const name = String(candidate || '').trim();
    if (name && !isGenericYahooLeagueName(name)) return name;
  }
  const team = String(teamName || '').trim();
  if (team && team !== 'My Team' && !isGenericYahooLeagueName(team)) return team;
  return 'League';
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
  if (platform.includes('yahoo') || yahooNum || /^yahoo-/i.test(String(league.id || ''))) {
    // One board row per Yahoo league. Team id stays on the row, but it is not the identity.
    if (yahooNum) return `yahoo:${yahooNum}`;
    const fingerprint = yahooMatchupFingerprint(league);
    if (fingerprint) return `yahoo:match:${fingerprint}`;
    return '';
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
  const title = String(league?.leagueName || league?.name || '').trim();
  const teamKey = yahooToken(league?.myTeamName || league?.teamName || league?.userTeam?.name);
  const realTitle = title
    && !isGenericYahooLeagueName(title)
    && yahooToken(title) !== teamKey;
  const hasFullKey = Boolean(yahooLeagueIdOf(league) || String(league?.leagueKey || '').includes('.l.'));
  return starters * 10
    + (realTitle ? 8 : 0)
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

  // Second pass: same canonical league id, or the same team/opponent/record
  // when a cached row never stored `449.l.<id>`.
  const collapsed = [];
  out.forEach((league) => {
    if (!isYahooRow(league)) {
      collapsed.push(league);
      return;
    }
    const matchIndex = collapsed.findIndex((item) => yahooRowsSame(item, league));
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
