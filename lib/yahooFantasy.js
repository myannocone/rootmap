import { randomBytes } from 'node:crypto';
import { activeOrProjected, isActiveYahooSlot } from '../src/utils/activeLineup.js';
import { resolveNflTeam } from '../src/utils/leagueParser.js';
import { backfillPlayersTeam, canonTeamCode, sleeperTeamIndexFrom } from '../src/utils/playerTeam.js';

/** Yahoo editorial_team_key ids (nfl.t.N) — same numbering ESPN uses for NFL. */
const YAHOO_TEAM_BY_ID = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
};

const YAHOO_AUTH = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';
const YAHOO_SCOPE = 'fspt-r';
const YAHOO_LEAGUES_PATH = '/users;use_login=1/games;game_keys=nfl/leagues';
const STATE_COOKIE = 'yahoo_oauth_state';
const APP_COOKIE = 'yahoo_return_app';
const ACCESS_COOKIE = 'yahoo_access_token';
const REFRESH_COOKIE = 'yahoo_refresh_token';
const ACCESS_MAX_AGE = 3600;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

function requestHost(req) {
  return String(req?.headers?.host || '').split(',')[0].trim();
}

function requestIsLocal(req) {
  return /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)(:\d+)?$/i.test(requestHost(req));
}

export function requestIsSecure(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return !requestIsLocal(req);
}

export function yahooRedirectUri(req) {
  if (req && requestIsLocal(req)) {
    return `http://${requestHost(req)}/api/auth/yahoo/callback`;
  }
  const configured = String(process.env.YAHOO_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const appUrl = String(process.env.APP_URL || 'https://rootmap-wine.vercel.app').trim().replace(/\/+$/, '');
  return `${appUrl}/api/auth/callback`;
}

export function collectionItems(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  return Object.keys(node)
    .filter((key) => key !== 'count' && /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => node[key]);
}

export function mergeYahoo(value) {
  if (Array.isArray(value)) {
    return value.reduce((acc, part) => Object.assign(acc, mergeYahoo(part)), {});
  }
  if (value && typeof value === 'object') return { ...value };
  return {};
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function selectedSlot(player) {
  const selected = player?.selected_position;
  if (!selected) return '';
  if (typeof selected === 'string') return selected.toUpperCase();
  if (Array.isArray(selected)) {
    const hit = selected.find((entry) => entry?.position) || selected[0];
    return String(hit?.position || '').toUpperCase();
  }
  if (selected.position) return String(selected.position).toUpperCase();
  const nested = Object.values(selected).find((entry) => entry && typeof entry === 'object' && entry.position);
  return String(nested?.position || '').toUpperCase();
}

function yahooStringField(node, field) {
  let found = '';
  walkYahoo(node, (value) => {
    if (found || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const text = value[field];
    if (typeof text === 'string' && text.trim()) found = text.trim();
    else if (Array.isArray(text)) {
      const hit = text.find((entry) => typeof entry === 'string' && entry.trim());
      if (hit) found = hit.trim();
    }
  });
  return found;
}

function yahooTeamFromKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/(?:^|\.)t\.(\d+)$/i) || text.match(/^(\d+)$/);
  if (!match) return '';
  return YAHOO_TEAM_BY_ID[Number(match[1])] || '';
}

function extractYahooTeamAbbr(root, merged) {
  const candidates = [
    merged?.editorial_team_abbr,
    yahooStringField(root, 'editorial_team_abbr'),
    yahooStringField(merged, 'editorial_team_abbr'),
    merged?.editorial_team_key,
    yahooStringField(root, 'editorial_team_key'),
    yahooStringField(merged, 'editorial_team_key'),
    merged?.editorial_team_full_name,
    yahooStringField(root, 'editorial_team_full_name'),
    yahooStringField(root, 'editorial_team_url_name')
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    if (typeof candidate === 'object') continue;
    const fromKey = yahooTeamFromKey(candidate);
    if (fromKey) return fromKey;
    const resolved = canonTeamCode(candidate) || resolveNflTeam(candidate);
    if (resolved) return resolved;
    const upper = String(candidate).trim().toUpperCase();
    if (/^[A-Z]{2,3}$/.test(upper) && upper !== 'FA') return canonTeamCode(upper) || upper;
  }
  return '';
}

/**
 * Yahoo XML→JSON often wraps point totals as:
 *   { total: "18.42" }
 * or:
 *   [{ coverage_type: "week", week: "10" }, { total: "18.42" }]
 * or numeric-key objects:
 *   { "0": { total: "18.42" }, coverage_type: "week" }
 */
function yahooTotalRaw(node) {
  if (node == null || node === '') return null;
  if (typeof node !== 'object') {
    const number = Number(node);
    return Number.isFinite(number) ? node : null;
  }
  if (Array.isArray(node)) {
    const merged = mergeYahoo(node);
    if (merged && merged.total != null && merged.total !== '') return merged.total;
    for (const part of node) {
      const hit = yahooTotalRaw(part);
      if (hit != null) return hit;
    }
    return null;
  }
  if (node.total != null && node.total !== '') return node.total;
  // Numeric-key Yahoo wraps inside the points node itself.
  const keyed = collectionItems(node);
  if (keyed.length) {
    for (const part of keyed) {
      const hit = yahooTotalRaw(part);
      if (hit != null) return hit;
    }
  }
  return null;
}

/** Public helper: parse Yahoo point total from object or array-of-objects shapes. */
export function extractYahooTotal(node) {
  const raw = yahooTotalRaw(node);
  if (raw == null) return 0;
  return parseFloat(raw) || 0;
}

function yahooPointTotal(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (!Array.isArray(node) && node[key] != null) {
    const raw = yahooTotalRaw(node[key]);
    if (raw != null) return parseFloat(raw) || 0;
  }
  return nestedTotal(node, key);
}

function readPlayerPoints(root, merged) {
  let actual = yahooPointTotal(merged, 'player_points');
  if (actual == null) actual = yahooPointTotal(root, 'player_points');
  if (actual == null) actual = yahooPointTotal(merged, 'fantasy_points');
  if (actual == null) actual = yahooPointTotal(root, 'fantasy_points');

  let proj = yahooPointTotal(merged, 'player_projected_points');
  if (proj == null) proj = yahooPointTotal(root, 'player_projected_points');
  if (proj == null) proj = yahooPointTotal(merged, 'projected_points');
  if (proj == null) proj = yahooPointTotal(root, 'projected_points');
  return { actual, proj };
}

export function mapYahooPlayer(player, week) {
  const root = player?.player || player;
  const merged = mergeYahoo(root);
  const slot = selectedSlot(merged);
  const rawName = merged.name?.full
    || [merged.name?.first, merged.name?.last].filter(Boolean).join(' ')
    || yahooStringField(root, 'name')
    || '';
  const name = String(typeof rawName === 'string' ? rawName : (rawName?.full || '')).trim();
  if (!name) return null;
  const position = String(merged.display_position || merged.primary_position || slot).toUpperCase();
  const isDefense = position === 'DEF' || position === 'D/ST' || position === 'DST' || slot === 'DEF';
  let nflTeam = extractYahooTeamAbbr(root, merged);
  // Yahoo D/ST often returns mascot-only names ("Bills") with no editorial_team_abbr.
  if (!nflTeam) {
    nflTeam = resolveNflTeam(name) || '';
  }
  if (!nflTeam && isDefense) {
    nflTeam = resolveNflTeam(String(merged.name?.last || merged.name?.first || '').trim()) || '';
  }
  const displayName = isDefense && !/d\/st|defense/i.test(name) ? `${name} D/ST` : name;
  const { actual, proj } = readPlayerPoints(root, merged);
  const isStarter = isActiveYahooSlot(slot);
  return {
    name: displayName,
    slot: isDefense ? 'D/ST' : (slot || position),
    position: isDefense ? 'D/ST' : position,
    nflTeam,
    team: nflTeam,
    points: actual != null ? actual : (proj ?? 0),
    projected: proj,
    projPoints: proj,
    actualPoints: actual,
    isStarter,
    inRedZone: false,
    gameClock: `Week ${week}`,
    bigPlay: null
  };
}

function walkYahoo(node, visit, seen = new Set(), depth = 0) {
  if (node == null || depth > 12) return;
  if (typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  visit(node);
  const entries = Array.isArray(node) ? node.map((child, index) => [String(index), child]) : Object.entries(node);
  entries.forEach(([key, child]) => {
    if (key === 'managers' || key === 'manager') return;
    walkYahoo(child, visit, seen, depth + 1);
  });
}

function stringFields(node, field) {
  const found = [];
  walkYahoo(node, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (typeof value[field] === 'string' && value[field].trim()) found.push(value[field].trim());
  });
  return found;
}

function firstNumberField(node, field) {
  let found = null;
  walkYahoo(node, (value) => {
    if (found != null || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const number = finiteNumber(value[field]);
    if (number != null) found = number;
  });
  return found;
}

function nestedTotal(node, parentKey) {
  let found = null;
  walkYahoo(node, (value) => {
    if (found != null || !value || typeof value !== 'object' || Array.isArray(value)) return;
    if (value[parentKey] == null) return;
    const raw = yahooTotalRaw(value[parentKey]);
    if (raw != null) found = parseFloat(raw) || 0;
  });
  return found;
}

function ownRecord(node, field) {
  const keys = [...new Set(stringFields(node, field))];
  if (keys.length !== 1) return '';
  return keys[0];
}

/** Yahoo nests a parent section label ("My Teams & Leagues") above real league objects. */
const GENERIC_YAHOO_SECTION_RE = /^(my\s*teams?\s*(?:&|and)\s*leagues?|my\s*teams?|my\s*leagues?|leagues?|games?)$/i;

export function isGenericYahooSectionName(name) {
  return GENERIC_YAHOO_SECTION_RE.test(String(name || '').trim());
}

function nameForKey(node, keyField) {
  if (!node || typeof node !== 'object') return '';
  const parts = Array.isArray(node) ? node : [node];
  let sibling = '';
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (Array.isArray(part)) {
      const nested = nameForKey(part, keyField);
      if (nested && !isGenericYahooSectionName(nested)) return nested;
      continue;
    }
    const named = typeof part.name === 'string' ? part.name.trim() : '';
    if (!named || isGenericYahooSectionName(named)) continue;
    if (part[keyField]) return named;
    if (!sibling && !part.league_key && !part.team_key && !part.teams && !part.team && !part.roster) {
      sibling = named;
    }
  }
  return sibling;
}

function recordName(node, keyField) {
  const direct = nameForKey(node, keyField);
  if (direct && !isGenericYahooSectionName(direct)) return direct;
  if (node && typeof node === 'object') {
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const named = nameForKey(child, keyField);
      if (named && !isGenericYahooSectionName(named)) return named;
    }
  }
  return '';
}

function findRealLeagueName(node, leagueKey) {
  let found = '';
  walkYahoo(node, (value) => {
    if (found || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const named = typeof value.name === 'string' ? value.name.trim() : '';
    if (!named || isGenericYahooSectionName(named)) return;
    if (String(value.league_key || '') === leagueKey) {
      found = named;
      return;
    }
    if (
      value.league_id != null
      || value.num_teams != null
      || value.current_week != null
      || value.scoring_type
      || value.league_type
    ) {
      found = named;
    }
  });
  return found;
}

export function parseLeagues(body) {
  const leagues = [];
  const seen = new Set();

  // Prefer explicit `{ league: [...] }` wrappers so section headers do not win.
  walkYahoo(body, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !node.league) return;
    const merged = mergeYahoo(node.league);
    const leagueKey = String(merged.league_key || '').trim();
    if (!leagueKey.includes('.l.') || seen.has(leagueKey)) return;
    let name = String(merged.name || '').trim();
    if (!name || isGenericYahooSectionName(name)) {
      name = findRealLeagueName(node.league, leagueKey) || recordName(node, 'league_key');
    }
    if (!name || isGenericYahooSectionName(name)) return;
    seen.add(leagueKey);
    leagues.push({
      leagueKey,
      name,
      week: finiteNumber(merged.current_week) ?? firstNumberField(node, 'current_week'),
      season: String(merged.season || stringFields(node, 'season')[0] || '')
    });
  });

  if (leagues.length) return leagues;

  // Fallback for flatter payloads without a `league` wrapper.
  walkYahoo(body, (node) => {
    const leagueKey = ownRecord(node, 'league_key');
    if (!leagueKey || !leagueKey.includes('.l.') || seen.has(leagueKey)) return;
    const name = recordName(node, 'league_key');
    if (!name || isGenericYahooSectionName(name)) return;
    seen.add(leagueKey);
    leagues.push({
      leagueKey,
      name,
      week: firstNumberField(node, 'current_week'),
      season: stringFields(node, 'season')[0] || ''
    });
  });
  return leagues;
}

export function parseTeams(body) {
  const teams = [];
  const seen = new Set();
  walkYahoo(body, (node) => {
    const teamKey = ownRecord(node, 'team_key');
    if (!teamKey || !teamKey.includes('.t.') || seen.has(teamKey)) return;
    const name = recordName(node, 'team_key');
    if (!name) return;
    seen.add(teamKey);
    teams.push({
      teamKey,
      name,
      leagueKey: teamKey.split('.t.')[0]
    });
  });
  return teams;
}

export function parseRoster(body, week) {
  const teamNode = body?.fantasy_content?.team ?? body?.fantasy_content?.league;
  const rosterRoot = mergeYahoo(teamNode);
  const roster = mergeYahoo(rosterRoot.roster);
  const playersNode = roster.players || roster['0']?.players || rosterRoot.players;
  return collectionItems(playersNode)
    .map((entry) => mapYahooPlayer(entry, week))
    .filter(Boolean);
}

function rosterHasWeekStats(roster) {
  return (roster || []).some((player) => player?.actualPoints != null || player?.projPoints != null);
}

function rosterStatScore(roster) {
  return (roster || []).reduce((sum, player) => (
    sum
    + Math.abs(Number(player?.actualPoints) || 0)
    + Math.abs(Number(player?.projPoints) || 0)
  ), 0);
}

async function fetchYahooRoster(token, teamKey, week) {
  const key = String(teamKey || '').trim();
  if (!key) return [];
  const paths = [
    `/team/${key}/roster;week=${week}/players/stats;type=week;week=${week}`,
    `/team/${key}/roster;week=${week}/players/stats;type=week;week=${week};show_projected_stats=1`,
    `/team/${key}/roster;week=${week}/players/stats`,
    `/team/${key}/roster/players/stats;type=week;week=${week}`,
    `/team/${key}/roster;week=${week}/players`,
    `/team/${key}/roster;week=${week}`
  ];
  let best = [];
  let bestScore = -1;
  let lastError = null;
  for (const path of paths) {
    try {
      const body = await yahooGet(path, token);
      const roster = parseRoster(body, week);
      if (!roster.length) continue;
      const score = rosterStatScore(roster);
      if (rosterHasWeekStats(roster) && score > 0) return roster;
      if (score > bestScore) {
        best = roster;
        bestScore = score;
      } else if (!best.length) {
        best = roster;
        bestScore = score;
      }
    } catch (err) {
      lastError = err;
      if (err?.status === 401 || err?.status === 403) throw err;
    }
  }
  if (best.length) return best;
  if (lastError) throw lastError;
  return [];
}

async function fetchTeamWeekPoints(token, teamKey, week) {
  const key = String(teamKey || '').trim();
  if (!key) return { score: null, proj: null };
  try {
    const body = await yahooGet(`/team/${key}/stats;type=week;week=${week}`, token);
    return {
      score: nestedTotal(body, 'team_points'),
      proj: nestedTotal(body, 'team_projected_points')
    };
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) throw err;
    return { score: null, proj: null };
  }
}

function readTeamSide(teamNode) {
  const teamKey = ownRecord(teamNode, 'team_key');
  if (!teamKey) return null;
  let standing = null;
  walkYahoo(teamNode, (value) => {
    if (standing || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const totals = value.outcome_totals;
    if (!totals || typeof totals !== 'object') return;
    const wins = finiteNumber(totals.wins);
    const losses = finiteNumber(totals.losses);
    if (wins == null || losses == null) return;
    standing = {
      wins,
      losses,
      ties: finiteNumber(totals.ties) || 0,
      rank: finiteNumber(value.rank)
    };
  });
  const score = nestedTotal(teamNode, 'team_points');
  const proj = nestedTotal(teamNode, 'team_projected_points');
  return {
    teamKey,
    name: recordName(teamNode, 'team_key'),
    score: score != null ? score : null,
    proj: proj != null ? proj : null,
    record: standing ? { wins: standing.wins, losses: standing.losses, ties: standing.ties } : null,
    rank: standing?.rank || null
  };
}

async function fetchLeagueMeta(token, leagueKey) {
  try {
    const body = await yahooGet(`/league/${leagueKey}`, token);
    const parsed = parseLeagues(body);
    return parsed.find((league) => league.leagueKey === leagueKey) || parsed[0] || null;
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) throw err;
    return null;
  }
}

export function parseScoreboard(body, myTeamKey) {
  const matchups = [];
  walkYahoo(body, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !node.teams) return;
    const sides = collectionItems(node.teams)
      .map((entry) => readTeamSide(entry?.team || entry))
      .filter(Boolean);
    if (sides.length === 2 && sides[0].teamKey !== sides[1].teamKey) matchups.push(sides);
  });
  const wanted = String(myTeamKey || '');
  const hit = matchups.find((sides) => sides.some((side) => side.teamKey === wanted));
  if (!hit) return { mine: null, opp: null };
  return {
    mine: hit.find((side) => side.teamKey === wanted) || null,
    opp: hit.find((side) => side.teamKey !== wanted) || null
  };
}

export function parseMatchup(body, myTeamKey) {
  return parseScoreboard(body, myTeamKey);
}

function yahooUrl(path) {
  const url = new URL(`${YAHOO_API}${path}`);
  url.searchParams.set('format', 'json');
  return url;
}

async function yahooGet(path, token) {
  const response = await fetch(yahooUrl(path), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(yahooFailureMessage(response.status, body, text));
    error.status = response.status;
    throw error;
  }
  return body;
}

function yahooFailureMessage(status, body, text) {
  const description = body?.error?.description || body?.error_description || '';
  if (status === 401) {
    return 'Yahoo access expired. Connect Yahoo again so RootMap can refresh your leagues.';
  }
  if (status === 403 || /not authorized/i.test(description) || /not authorized/i.test(text || '')) {
    return 'Yahoo signed you in, then blocked the league read. This app still needs Fantasy Sports approval in the Yahoo developer console.';
  }
  if (description) return `Yahoo could not load the leagues. ${description}`;
  return `Yahoo could not load the leagues (${status}).`;
}

export async function refreshYahooAccessToken(refreshToken) {
  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YAHOO_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    const error = new Error('Missing Yahoo Client ID or Client Secret in .env');
    error.status = 500;
    throw error;
  }
  const token = String(refreshToken || '').trim();
  if (!token) {
    const error = new Error('Yahoo refresh token is missing. Connect Yahoo again.');
    error.status = 401;
    throw error;
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', token);
  const response = await fetch(YAHOO_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || 'Token refresh failed';
    const error = new Error(`Yahoo could not refresh access. ${detail}`);
    error.status = response.status || 401;
    throw error;
  }
  return data;
}

async function currentNflWeek() {
  try {
    const response = await fetch('https://api.sleeper.app/v1/state/nfl');
    if (response.ok) {
      const state = await response.json();
      const week = Number(state?.week);
      if (week >= 1 && week <= 18) return week;
    }
  } catch {
    // the dated fallback stays on the current NFL week
  }
  return 9;
}

function startingLineup(players) {
  return activeOrProjected(players);
}

let sleeperPlayersCache = null;
let sleeperPlayersPromise = null;

async function fetchSleeperPlayersDictionary() {
  if (sleeperPlayersCache) return sleeperPlayersCache;
  if (!sleeperPlayersPromise) {
    sleeperPlayersPromise = (async () => {
      try {
        const response = await fetch('https://api.sleeper.app/v1/players/nfl');
        if (!response.ok) return {};
        const body = await response.json();
        return body && typeof body === 'object' ? body : {};
      } catch {
        return {};
      }
    })().then((players) => {
      sleeperPlayersCache = players;
      return players;
    }).finally(() => {
      sleeperPlayersPromise = null;
    });
  }
  return sleeperPlayersPromise;
}

function applyTeamBackfillToLeague(league, players, index) {
  if (!league) return league;
  const fill = (list) => backfillPlayersTeam(list, players, index);
  const portfolio = fill(league.portfolio || league.starters || league.userTeam?.starters || []);
  const threats = fill(league.threats || league.opponentStarters || league.oppTeam?.starters || []);
  return {
    ...league,
    portfolio,
    threats,
    starters: portfolio.map((player) => ({ ...player })),
    opponentStarters: threats.map((player) => ({ ...player })),
    userTeam: league.userTeam
      ? { ...league.userTeam, starters: portfolio.map((player) => ({ ...player })) }
      : league.userTeam,
    oppTeam: league.oppTeam
      ? { ...league.oppTeam, starters: threats.map((player) => ({ ...player })) }
      : league.oppTeam
  };
}

export async function backfillYahooLeagueTeams(leagues) {
  const list = Array.isArray(leagues) ? leagues : [];
  if (!list.length) return list;
  const players = await fetchSleeperPlayersDictionary();
  const index = sleeperTeamIndexFrom(players);
  return list.map((league) => applyTeamBackfillToLeague(league, players, index));
}

function preferScore(boardValue, starterValue, fallback = 0) {
  const board = finiteNumber(boardValue);
  if (board != null && board !== 0) return board;
  const starters = finiteNumber(starterValue);
  if (starters != null && starters !== 0) return starters;
  return board ?? starters ?? fallback;
}

export async function importYahooLeagues(token, { week: weekOverride } = {}) {
  const requestedWeek = Number(weekOverride);
  const [leagueBody, teamBody, nflWeek] = await Promise.all([
    yahooGet(YAHOO_LEAGUES_PATH, token),
    yahooGet('/users;use_login=1/games;game_keys=nfl/teams', token),
    currentNflWeek()
  ]);
  const leagues = parseLeagues(leagueBody);
  const teams = parseTeams(teamBody);
  const leagueByKey = new Map(leagues.map((league) => [league.leagueKey, { ...league }]));

  const mapped = [];
  for (const sourceTeam of teams) {
    const teamKey = String(sourceTeam.teamKey || '');
    const leagueKey = teamKey.includes('.t.') ? teamKey.split('.t.')[0] : String(sourceTeam.leagueKey || '');
    if (!teamKey || !leagueKey) continue;
    const league = leagueByKey.get(leagueKey) || null;
    const leagueWeek = Number(league?.week);
    const week = (requestedWeek >= 1 && requestedWeek <= 18)
      ? requestedWeek
      : (leagueWeek >= 1 && leagueWeek <= 18 ? leagueWeek : nflWeek);
    let roster = [];
    let scoreboard = { mine: null, opp: null };
    let oppRoster = [];
    try {
      roster = await fetchYahooRoster(token, teamKey, week);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) throw err;
      roster = [];
    }
    try {
      const boardBody = await yahooGet(`/league/${leagueKey}/scoreboard;week=${week}`, token);
      scoreboard = parseScoreboard(boardBody, teamKey);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) throw err;
      scoreboard = { mine: null, opp: null };
    }
    if (!scoreboard.opp?.name) {
      try {
        const matchupBody = await yahooGet(`/team/${teamKey}/matchups;week=${week}`, token);
        const fromTeam = parseMatchup(matchupBody, teamKey);
        scoreboard = {
          mine: scoreboard.mine?.name ? scoreboard.mine : fromTeam.mine,
          opp: scoreboard.opp?.name ? scoreboard.opp : fromTeam.opp
        };
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) throw err;
        scoreboard = { mine: scoreboard.mine, opp: scoreboard.opp };
      }
    }
    // Fill missing team totals from /team/.../stats;type=week when scoreboard totals are empty.
    if (finiteNumber(scoreboard.mine?.score) == null || finiteNumber(scoreboard.mine?.score) === 0
      || finiteNumber(scoreboard.mine?.proj) == null) {
      const mineStats = await fetchTeamWeekPoints(token, teamKey, week);
      scoreboard = {
        ...scoreboard,
        mine: scoreboard.mine
          ? {
            ...scoreboard.mine,
            score: preferScore(scoreboard.mine.score, mineStats.score),
            proj: finiteNumber(scoreboard.mine.proj) ?? mineStats.proj
          }
          : scoreboard.mine
      };
    }
    const opponentKey = scoreboard.opp?.teamKey || '';
    if (opponentKey) {
      try {
        oppRoster = await fetchYahooRoster(token, opponentKey, week);
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) throw err;
        oppRoster = [];
      }
      if (finiteNumber(scoreboard.opp?.score) == null || finiteNumber(scoreboard.opp?.score) === 0
        || finiteNumber(scoreboard.opp?.proj) == null) {
        const oppStats = await fetchTeamWeekPoints(token, opponentKey, week);
        scoreboard = {
          ...scoreboard,
          opp: scoreboard.opp
            ? {
              ...scoreboard.opp,
              score: preferScore(scoreboard.opp.score, oppStats.score),
              proj: finiteNumber(scoreboard.opp.proj) ?? oppStats.proj
            }
            : scoreboard.opp
        };
      }
    }
    const myTeamName = sourceTeam.name || scoreboard.mine?.name || 'My Team';
    const oppTeamName = scoreboard.opp?.name || 'Opponent';
    let leagueMeta = league;
    if (!leagueMeta?.name || isGenericYahooSectionName(leagueMeta.name)) {
      const fetched = await fetchLeagueMeta(token, leagueKey);
      if (fetched?.name && !isGenericYahooSectionName(fetched.name)) {
        leagueMeta = { ...(leagueMeta || {}), ...fetched };
        leagueByKey.set(leagueKey, leagueMeta);
      }
    }
    const leagueName = (leagueMeta?.name && !isGenericYahooSectionName(leagueMeta.name))
      ? leagueMeta.name
      : myTeamName;
    const myRoster = startingLineup(roster).map((player) => ({ ...player }));
    const theirRoster = startingLineup(oppRoster).map((player) => ({ ...player }));
    const starterTotal = (players) => players.reduce((sum, player) => sum + (Number(player?.points) || 0), 0);
    const starterProjTotal = (players) => players.reduce((sum, player) => {
      const proj = finiteNumber(player?.projPoints ?? player?.projected);
      return sum + (proj != null ? proj : 0);
    }, 0);
    const myStarterScore = starterTotal(myRoster);
    const oppStarterScore = starterTotal(theirRoster);
    const myStarterProj = starterProjTotal(myRoster);
    const oppStarterProj = starterProjTotal(theirRoster);
    const myBoardScore = finiteNumber(scoreboard.mine?.score);
    const oppBoardScore = finiteNumber(scoreboard.opp?.score);
    const myBoardProj = finiteNumber(scoreboard.mine?.proj);
    const oppBoardProj = finiteNumber(scoreboard.opp?.proj);
    mapped.push({
      id: `yahoo-${leagueKey}`,
      leagueKey,
      yahooLeagueId: leagueKey,
      teamKey,
      yahooTeamId: teamKey,
      lineupWeek: week,
      lineupProjected: myRoster.some((player) => player.projectedStart) || theirRoster.some((player) => player.projectedStart),
      name: leagueName,
      leagueName,
      platform: 'Yahoo',
      season: leagueMeta?.season || league?.season || '2026',
      myScore: preferScore(myBoardScore, myStarterScore, 0),
      oppScore: preferScore(oppBoardScore, oppStarterScore, 0),
      myProj: preferScore(myBoardProj, myStarterProj, null),
      oppProj: preferScore(oppBoardProj, oppStarterProj, null),
      myTeamName,
      oppTeamName,
      opponent: oppTeamName,
      myRecord: scoreboard.mine?.record || null,
      oppRecord: scoreboard.opp?.record || null,
      myRank: scoreboard.mine?.rank || null,
      oppRank: scoreboard.opp?.rank || null,
      userTeam: { name: myTeamName, starters: myRoster.map((player) => ({ ...player })) },
      oppTeam: { name: oppTeamName, starters: theirRoster.map((player) => ({ ...player })) },
      portfolio: myRoster,
      threats: theirRoster,
      starters: myRoster.map((player) => ({ ...player })),
      opponentStarters: theirRoster.map((player) => ({ ...player }))
    });
  }
  return backfillYahooLeagueTeams(mapped);
}

function summarizeYahooNode(node, depth = 0) {
  if (node == null || depth > 4) return node == null ? node : typeof node;
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.slice(0, 4).map((entry) => summarizeYahooNode(entry, depth + 1));
  }
  const out = {};
  Object.keys(node).slice(0, 24).forEach((key) => {
    out[key] = summarizeYahooNode(node[key], depth + 1);
  });
  return out;
}

function findFirstYahooField(node, field, depth = 0, seen = new Set()) {
  if (node == null || depth > 14 || typeof node !== 'object') return null;
  if (seen.has(node)) return null;
  seen.add(node);
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, field)) {
    return { field, value: node[field], parentKeys: Object.keys(node).slice(0, 20) };
  }
  const entries = Array.isArray(node) ? node : Object.values(node);
  for (const child of entries) {
    const hit = findFirstYahooField(child, field, depth + 1, seen);
    if (hit) return hit;
  }
  return null;
}

/** Dump raw Yahoo JSON paths for leagues / scoreboard / roster stats (debug). */
export async function inspectYahooPayload(token, { week: weekOverride } = {}) {
  const nflWeek = await currentNflWeek();
  const week = (Number(weekOverride) >= 1 && Number(weekOverride) <= 18) ? Number(weekOverride) : nflWeek;
  const leagueBody = await yahooGet(YAHOO_LEAGUES_PATH, token);
  const teamBody = await yahooGet('/users;use_login=1/games;game_keys=nfl/teams', token);
  const parsedLeagues = parseLeagues(leagueBody);
  const parsedTeams = parseTeams(teamBody);
  const sampleTeam = parsedTeams[0] || null;
  const leagueKey = sampleTeam?.leagueKey || parsedLeagues[0]?.leagueKey || '';
  const teamKey = sampleTeam?.teamKey || '';

  let rosterBody = null;
  let rosterPath = '';
  let scoreboardBody = null;
  let teamStatsBody = null;
  const rosterPathsTried = [];

  if (teamKey) {
    const paths = [
      `/team/${teamKey}/roster;week=${week}/players/stats;type=week;week=${week}`,
      `/team/${teamKey}/roster;week=${week}/players/stats`,
      `/team/${teamKey}/roster;week=${week}`
    ];
    for (const path of paths) {
      rosterPathsTried.push(path);
      try {
        rosterBody = await yahooGet(path, token);
        rosterPath = path;
        if (findFirstYahooField(rosterBody, 'player_points')) break;
      } catch (err) {
        rosterPathsTried.push(`FAIL ${path}: ${err?.message || err}`);
      }
    }
    try {
      teamStatsBody = await yahooGet(`/team/${teamKey}/stats;type=week;week=${week}`, token);
    } catch {
      teamStatsBody = null;
    }
  }
  if (leagueKey) {
    try {
      scoreboardBody = await yahooGet(`/league/${leagueKey}/scoreboard;week=${week}`, token);
    } catch {
      scoreboardBody = null;
    }
  }

  const parsedRoster = rosterBody ? parseRoster(rosterBody, week) : [];
  const scoreboard = scoreboardBody ? parseScoreboard(scoreboardBody, teamKey) : { mine: null, opp: null };

  return {
    week,
    nflWeek,
    parsedLeagues,
    parsedTeams: parsedTeams.map((team) => ({ teamKey: team.teamKey, name: team.name, leagueKey: team.leagueKey })),
    sampleLeagueNameHit: findFirstYahooField(leagueBody, 'name'),
    sampleLeagueKeyHit: findFirstYahooField(leagueBody, 'league_key'),
    leagueObjectSample: summarizeYahooNode(findFirstYahooField(leagueBody, 'league')?.value || leagueBody?.fantasy_content),
    matchupTeamSample: {
      scoreboardMine: scoreboard.mine,
      scoreboardOpp: scoreboard.opp,
      team_points: findFirstYahooField(scoreboardBody, 'team_points'),
      team_projected_points: findFirstYahooField(scoreboardBody, 'team_projected_points'),
      teamStats_points: findFirstYahooField(teamStatsBody, 'team_points'),
      teamStats_projected: findFirstYahooField(teamStatsBody, 'team_projected_points')
    },
    playerPointsSample: {
      rosterPath,
      rosterPathsTried,
      player_points: findFirstYahooField(rosterBody, 'player_points'),
      player_projected_points: findFirstYahooField(rosterBody, 'player_projected_points'),
      firstParsedPlayer: parsedRoster[0] || null,
      parsedPlayerCount: parsedRoster.length,
      parsedStatPlayers: parsedRoster.filter((player) => player.actualPoints != null || player.projPoints != null).length
    },
    rawKeys: {
      leagueTop: leagueBody?.fantasy_content ? Object.keys(leagueBody.fantasy_content) : [],
      rosterTop: rosterBody?.fantasy_content ? Object.keys(rosterBody.fantasy_content) : [],
      scoreboardTop: scoreboardBody?.fantasy_content ? Object.keys(scoreboardBody.fantasy_content) : []
    }
  };
}

function readCookie(req, name) {
  const raw = String(req.headers?.cookie || '');
  const hit = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!hit) return '';
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return hit.slice(name.length + 1);
  }
}

export async function resolveYahooAccessToken(req, { forceRefresh = true } = {}) {
  const access = readCookie(req, ACCESS_COOKIE);
  const refresh = readCookie(req, REFRESH_COOKIE);
  if (forceRefresh && refresh) {
    const tokenData = await refreshYahooAccessToken(refresh);
    return {
      accessToken: tokenData.access_token,
      tokenData: {
        ...tokenData,
        refresh_token: tokenData.refresh_token || refresh
      }
    };
  }
  if (access) return { accessToken: access, tokenData: null };
  if (refresh) {
    const tokenData = await refreshYahooAccessToken(refresh);
    return {
      accessToken: tokenData.access_token,
      tokenData: {
        ...tokenData,
        refresh_token: tokenData.refresh_token || refresh
      }
    };
  }
  const error = new Error('Yahoo access expired. Connect Yahoo again.');
  error.status = 401;
  throw error;
}

export function yahooTokenSetCookieHeaders(secure, tokenData) {
  return tokenCookies(secure, tokenData);
}

function sendHtml(res, status, html, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(html);
}

function cookie(name, value, maxAge, secure = true) {
  const secureFlag = secure ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearYahooCookies(secure = true) {
  return [cookie(STATE_COOKIE, '', 0, secure), cookie(APP_COOKIE, '', 0, secure)];
}

function tokenCookies(secure, tokenData) {
  const cookies = clearYahooCookies(secure);
  const access = String(tokenData?.access_token || '');
  const refresh = String(tokenData?.refresh_token || '');
  const accessAge = Number(tokenData?.expires_in);
  if (access) cookies.push(cookie(ACCESS_COOKIE, access, Number.isFinite(accessAge) && accessAge > 0 ? accessAge : ACCESS_MAX_AGE, secure));
  if (refresh) cookies.push(cookie(REFRESH_COOKIE, refresh, REFRESH_MAX_AGE, secure));
  return cookies;
}

function grantedFantasyRead(tokenData) {
  const scope = String(tokenData?.scope || '').trim();
  if (!scope) return true;
  return scope.split(/\s+/).includes('fspt-r');
}

function wantsJson(req) {
  return req.query?.format === 'json' || String(req.headers?.accept || '').includes('application/json');
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
}

export function renderErrorPage(message) {
  const safe = String(message || 'Yahoo sign-in did not finish.').replace(/[&<>]/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]
  ));
  return `<!DOCTYPE html>
<html lang="en">
<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RootMap</title></head>
<body style="margin:0;background:#020617;color:#f8fafc;font-family:system-ui,sans-serif">
  <main style="max-width:24rem;margin:4rem auto;padding:1.25rem">
    <h1 style="font-size:1.25rem">Yahoo did not connect</h1>
    <p>${safe}</p>
    <p><a href="/" style="color:#c4b5fd">Back to RootMap</a></p>
  </main>
</body>
</html>`;
}

export function renderImportPage(leagues, { returnToApp = false } = {}) {
  const payload = JSON.stringify(leagues).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RootMap</title></head>
<body style="margin:0;background:#020617;color:#f8fafc;font-family:system-ui,sans-serif">
  <main style="max-width:24rem;margin:4rem auto;padding:1.25rem">
    <h1 style="font-size:1.25rem">Saving your Yahoo leagues on this phone…</h1>
  </main>
  <script>
    (function () {
      var incoming = ${payload};
      var key = 'rootmap_leagues';
      var genericRe = /^(my\\s*teams?\\s*(?:&|and)\\s*leagues?|my\\s*teams?|my\\s*leagues?)$/i;
      function isGeneric(name) {
        return genericRe.test(String(name || '').trim());
      }
      function preferName() {
        for (var i = 0; i < arguments.length; i++) {
          var name = String(arguments[i] || '').trim();
          if (name && !isGeneric(name)) return name;
        }
        for (var j = 0; j < arguments.length; j++) {
          var fallback = String(arguments[j] || '').trim();
          if (fallback) return fallback;
        }
        return '';
      }
      function mergeOne(prev, next) {
        if (!next) return prev;
        if (!prev) return next;
        var name = preferName(next.leagueName, next.name, prev.leagueName, prev.name);
        return Object.assign({}, prev, next, {
          id: prev.id || next.id,
          name: name,
          leagueName: name,
          myTeamName: preferName(next.myTeamName, prev.myTeamName) || name
        });
      }
      try {
        var existing = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(existing)) existing = [];
        var byId = new Map();
        existing.forEach(function (league, index) {
          if (!league) return;
          byId.set(league.id ? String(league.id) : ('legacy-' + index), league);
        });
        incoming.forEach(function (league) {
          if (!league || !league.id) return;
          byId.set(String(league.id), mergeOne(byId.get(String(league.id)), league));
        });
        // Also replace any leftover generic-named Yahoo rows that share a leagueKey.
        incoming.forEach(function (league) {
          if (!league) return;
          var leagueKey = String(league.leagueKey || league.yahooLeagueId || '');
          if (!leagueKey) return;
          byId.forEach(function (saved, id) {
            var savedKey = String(saved.leagueKey || saved.yahooLeagueId || '');
            if (savedKey !== leagueKey) return;
            if (id === String(league.id)) return;
            if (isGeneric(saved.name) || isGeneric(saved.leagueName)) {
              byId.set(id, mergeOne(saved, Object.assign({}, league, { id: saved.id })));
            }
          });
        });
        localStorage.setItem(key, JSON.stringify(Array.from(byId.values())));
        if (${returnToApp ? 'true' : 'false'}) {
          location.replace('rootmap://yahoo-synced#' + encodeURIComponent(JSON.stringify(incoming)));
          return;
        }
        location.replace('/?yahoo=synced&count=' + incoming.length);
      } catch (err) {
        document.body.insertAdjacentHTML('beforeend', '<p style="max-width:24rem;margin:1rem auto;padding:0 1.25rem">This browser blocked saving the leagues. Turn off private browsing and try Connect Yahoo again.</p>');
      }
    })();
  </script>
</body>
</html>`;
}

export function startYahooLogin(req, res) {
  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YAHOO_CLIENT_SECRET || '').trim();
  const json = wantsJson(req);
  if (!clientId) {
    if (json) {
      sendJson(res, 500, { error: 'Missing Yahoo Client ID in .env' });
      return;
    }
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client ID in .env'));
    return;
  }
  if (!clientSecret) {
    if (json) {
      sendJson(res, 500, { error: 'Missing Yahoo Client Secret in .env' });
      return;
    }
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client Secret in .env'));
    return;
  }
  const state = randomBytes(16).toString('hex');
  const redirectUri = yahooRedirectUri(req);
  const authUrl = new URL(YAHOO_AUTH);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', YAHOO_SCOPE);
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('language', 'en-us');
  authUrl.searchParams.set('state', state);
  const secure = requestIsSecure(req);
  const cookies = [cookie(STATE_COOKIE, state, 600, secure)];
  if (req.query?.app === '1') cookies.push(cookie(APP_COOKIE, '1', 600, secure));
  if (json) {
    sendJson(res, 200, { url: authUrl.toString() }, { 'Set-Cookie': cookies });
    return;
  }
  res.setHeader('Set-Cookie', cookies);
  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

export async function completeYahooOAuth(req, res) {
  const error = req.query?.error;
  const code = req.query?.code;
  const state = req.query?.state;
  const expected = readCookie(req, STATE_COOKIE);
  const secure = requestIsSecure(req);
  const clearCookies = { 'Set-Cookie': clearYahooCookies(secure) };
  if (error) {
    sendHtml(res, 400, renderErrorPage('Yahoo cancelled the sign-in.'), clearCookies);
    return;
  }
  if (!code) {
    sendHtml(res, 400, renderErrorPage('Yahoo did not return a sign-in code.'), clearCookies);
    return;
  }
  if (!expected || state !== expected) {
    sendHtml(res, 400, renderErrorPage('This sign-in link expired. Tap Connect Yahoo and try again.'), clearCookies);
    return;
  }

  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YAHOO_CLIENT_SECRET || '').trim();
  if (!clientId) {
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client ID in .env'), clearCookies);
    return;
  }
  if (!clientSecret) {
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client Secret in .env'), clearCookies);
    return;
  }

  let tokenData = null;
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenParams = new URLSearchParams();
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('redirect_uri', yahooRedirectUri(req));
    tokenParams.set('code', String(code));
    const tokenRes = await fetch(YAHOO_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });
    tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      const detail = tokenData.error_description || tokenData.error || 'Token exchange failed';
      sendHtml(res, 400, renderErrorPage(`Yahoo could not finish sign-in. ${detail} The Yahoo app redirect URI must be ${yahooRedirectUri(req)}.`), clearCookies);
      return;
    }
    const storedTokens = { 'Set-Cookie': tokenCookies(secure, tokenData) };
    if (!grantedFantasyRead(tokenData)) {
      sendHtml(res, 400, renderErrorPage('Yahoo signed you in without Fantasy Sports read access. Connect Yahoo again and allow fantasy sports when Yahoo asks.'), storedTokens);
      return;
    }
    const returnToApp = readCookie(req, APP_COOKIE) === '1';
    const leagues = await importYahooLeagues(tokenData.access_token);
    if (!leagues.length) {
      sendHtml(res, 200, renderErrorPage('That Yahoo account has no NFL teams to import.'), storedTokens);
      return;
    }
    sendHtml(res, 200, renderImportPage(leagues, { returnToApp }), storedTokens);
  } catch (err) {
    const headers = tokenData?.access_token
      ? { 'Set-Cookie': tokenCookies(secure, tokenData) }
      : clearCookies;
    sendHtml(res, err.status && err.status < 500 ? 400 : 500, renderErrorPage(err.message || 'Yahoo sign-in failed.'), headers);
  }
}
