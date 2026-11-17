import { randomBytes } from 'node:crypto';
import { activeOrProjected, isActiveYahooSlot } from '../src/utils/activeLineup.js';
import { resolveNflTeam } from '../src/utils/leagueParser.js';
import { displayPlayerPosition } from '../src/utils/playerIdentity.js';
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

/**
 * Yahoo XML→JSON nests the same fields under unpredictable numeric indices
 * (e.g. player[0][13].player_points[0].total). Prefer this over hardcoded paths.
 */
export function findYahooKey(obj, targetKey, seen = new Set()) {
  if (typeof obj !== 'object' || obj === null) return null;
  if (seen.has(obj)) return null;
  seen.add(obj);
  if (Object.prototype.hasOwnProperty.call(obj, targetKey)) return obj[targetKey];
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const result = findYahooKey(obj[key], targetKey, seen);
    if (result !== null) return result;
  }
  return null;
}

/** Resolve a Yahoo `{total}` (or array/numeric-key wrap) under a named field anywhere in `node`. */
function totalFromYahooKey(node, key) {
  const hit = findYahooKey(node, key);
  if (hit == null) return null;
  const raw = yahooTotalRaw(hit);
  if (raw == null) return null;
  const number = parseFloat(raw);
  return Number.isFinite(number) ? number : null;
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
    findYahooKey(merged, 'editorial_team_abbr'),
    findYahooKey(root, 'editorial_team_abbr'),
    merged?.editorial_team_abbr,
    yahooStringField(root, 'editorial_team_abbr'),
    findYahooKey(merged, 'editorial_team_key'),
    findYahooKey(root, 'editorial_team_key'),
    merged?.editorial_team_key,
    yahooStringField(root, 'editorial_team_key'),
    findYahooKey(merged, 'editorial_team_full_name'),
    findYahooKey(root, 'editorial_team_full_name'),
    merged?.editorial_team_full_name,
    yahooStringField(root, 'editorial_team_full_name'),
    findYahooKey(root, 'editorial_team_url_name'),
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

function readPlayerPoints(root, merged) {
  // Recurse for player_points / projections — never assume player[N][M] indices.
  let actual = totalFromYahooKey(merged, 'player_points');
  if (actual == null) actual = totalFromYahooKey(root, 'player_points');
  if (actual == null) actual = totalFromYahooKey(merged, 'fantasy_points');
  if (actual == null) actual = totalFromYahooKey(root, 'fantasy_points');
  // Some Yahoo shapes nest player_points under player_stats.
  if (actual == null) {
    const stats = findYahooKey(merged, 'player_stats') ?? findYahooKey(root, 'player_stats');
    if (stats) actual = totalFromYahooKey(stats, 'player_points');
  }

  let proj = totalFromYahooKey(merged, 'player_projected_points');
  if (proj == null) proj = totalFromYahooKey(root, 'player_projected_points');
  if (proj == null) proj = totalFromYahooKey(merged, 'projected_points');
  if (proj == null) proj = totalFromYahooKey(root, 'projected_points');
  if (proj == null) {
    const projected = findYahooKey(merged, 'player_projected_stats') ?? findYahooKey(root, 'player_projected_stats');
    if (projected) proj = totalFromYahooKey(projected, 'player_projected_points')
      ?? totalFromYahooKey(projected, 'player_points');
  }
  return { actual, proj };
}

function yahooNameText(nameNode) {
  if (nameNode == null) return '';
  if (typeof nameNode === 'string') return nameNode.trim();
  if (typeof nameNode !== 'object') return '';
  const full = nameNode.full;
  if (typeof full === 'string' && full.trim()) return full.trim();
  const joined = [nameNode.first, nameNode.last].filter((part) => typeof part === 'string' && part.trim()).join(' ');
  return joined.trim();
}

export function mapYahooPlayer(player, week) {
  const root = player?.player ?? findYahooKey(player, 'player') ?? player;
  const merged = mergeYahoo(root);
  const selected = findYahooKey(merged, 'selected_position') ?? findYahooKey(root, 'selected_position');
  const slot = selectedSlot(selected != null ? { selected_position: selected } : merged);
  const nameNode = findYahooKey(merged, 'name') ?? findYahooKey(root, 'name');
  const rawName = yahooNameText(nameNode) || yahooStringField(root, 'name') || '';
  const name = String(rawName).trim();
  if (!name) return null;
  const primary = String(
    findYahooKey(merged, 'primary_position')
    ?? findYahooKey(root, 'primary_position')
    ?? merged.primary_position
    ?? ''
  ).toUpperCase();
  const display = String(
    findYahooKey(merged, 'display_position')
    ?? findYahooKey(root, 'display_position')
    ?? merged.display_position
    ?? ''
  ).toUpperCase().split(',')[0].trim();
  const rawPosition = primary || display || slot;
  const isDefense = rawPosition === 'DEF' || rawPosition === 'D/ST' || rawPosition === 'DST' || slot === 'DEF';
  let nflTeam = extractYahooTeamAbbr(root, merged);
  // Yahoo D/ST often returns mascot-only names ("Bills") with no editorial_team_abbr.
  if (!nflTeam) {
    nflTeam = resolveNflTeam(name) || '';
  }
  if (!nflTeam && isDefense) {
    const last = typeof nameNode === 'object' && nameNode ? (nameNode.last || nameNode.first) : '';
    nflTeam = resolveNflTeam(String(last || '').trim()) || '';
  }
  const displayName = isDefense && !/d\/st|defense/i.test(name) ? `${name} D/ST` : name;
  const { actual, proj } = readPlayerPoints(root, merged);
  const position = isDefense
    ? 'D/ST'
    : displayPlayerPosition({ position: rawPosition, slot });
  const isStarter = isActiveYahooSlot(slot);
  // Yahoo returns 0 (or omits totals) until kickoff — never treat projection as actual points.
  // IDP (`DP`) and D/ST use the same player_points.total field as skill positions.
  const actualPoints = actual != null ? actual : 0;
  return {
    name: displayName,
    slot: isDefense ? 'D/ST' : (slot || position),
    position,
    nflTeam,
    team: nflTeam,
    points: actualPoints,
    projected: proj,
    projPoints: proj,
    actualPoints,
    scoringSource: 'yahoo',
    yahooNative: true,
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
  return totalFromYahooKey(node, parentKey);
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

function isLeagueMetadataName(value, named) {
  if (!named || isGenericYahooSectionName(named)) return false;
  // Real league rows carry settings fields; team nicknames sit on team_key rows.
  if (value.team_key && !value.league_key && value.league_id == null && value.num_teams == null) {
    return false;
  }
  return (
    value.league_key != null
    || value.league_id != null
    || value.num_teams != null
    || value.current_week != null
    || value.scoring_type
    || value.league_type
    || value.start_week != null
    || value.end_week != null
  );
}

function findRealLeagueName(node, leagueKey) {
  let found = '';
  walkYahoo(node, (value) => {
    if (found || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const named = typeof value.name === 'string' ? value.name.trim() : '';
    if (!named || isGenericYahooSectionName(named)) return;
    if (leagueKey && String(value.league_key || '') === leagueKey) {
      found = named;
      return;
    }
    if (isLeagueMetadataName(value, named)) found = named;
  });
  return found;
}

function leagueNameFromMerged(merged, fallbackNode, leagueKey) {
  const direct = String(merged?.name || '').trim();
  if (direct && !isGenericYahooSectionName(direct) && !merged?.team_key) return direct;
  // Numeric-key Yahoo wraps often leave mergeYahoo without a top-level `name`.
  const deepName = yahooNameText(findYahooKey(fallbackNode, 'name') ?? findYahooKey(merged, 'name'));
  if (deepName && !isGenericYahooSectionName(deepName)) {
    const keyHit = String(
      findYahooKey(fallbackNode, 'league_key')
      ?? findYahooKey(merged, 'league_key')
      ?? merged?.league_key
      ?? ''
    ).trim();
    if (!leagueKey || !keyHit || keyHit === leagueKey) {
      if (!merged?.team_key || merged?.league_key || findYahooKey(fallbackNode, 'num_teams') != null) {
        return deepName;
      }
    }
  }
  const fromTree = findRealLeagueName(fallbackNode, leagueKey)
    || findRealLeagueName(merged, leagueKey)
    || recordName(fallbackNode, 'league_key');
  if (fromTree && !isGenericYahooSectionName(fromTree)) return fromTree;
  return '';
}

export function parseLeagues(body) {
  const leagues = [];
  const seen = new Set();

  // Prefer explicit `{ league: [...] }` wrappers so section headers ("My Teams & Leagues") do not win.
  // Yahoo nests real names like "BCliff Football" / "Mantasy" on the league metadata object
  // (league_key + name + num_teams), distinct from team.name ("YANNACONDA 🐍").
  walkYahoo(body, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !node.league) return;
    const merged = mergeYahoo(node.league);
    const leagueKey = String(
      merged.league_key || findYahooKey(node.league, 'league_key') || ''
    ).trim();
    if (!leagueKey.includes('.l.') || seen.has(leagueKey)) return;
    const name = leagueNameFromMerged(merged, node.league, leagueKey);
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
    const name = leagueNameFromMerged(mergeYahoo(node), node, leagueKey);
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
    const teamKey = ownRecord(node, 'team_key') || String(findYahooKey(node, 'team_key') || '').trim();
    if (!teamKey || !teamKey.includes('.t.') || seen.has(teamKey)) return;
    const name = recordName(node, 'team_key') || yahooNameText(findYahooKey(node, 'name'));
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
  const fantasy = body?.fantasy_content || body;
  const teamNode = findYahooKey(fantasy, 'team')
    ?? body?.fantasy_content?.team
    ?? body?.fantasy_content?.league
    ?? fantasy;
  const rosterRoot = mergeYahoo(teamNode);
  const rosterNode = findYahooKey(teamNode, 'roster') ?? rosterRoot.roster ?? rosterRoot;
  const roster = mergeYahoo(rosterNode);
  const playersNode = findYahooKey(rosterNode, 'players')
    || findYahooKey(roster, 'players')
    || findYahooKey(teamNode, 'players')
    || roster.players
    || rosterRoot.players;
  const entries = collectionItems(playersNode);
  const list = entries.length
    ? entries
    : (Array.isArray(playersNode) ? playersNode : []);
  return list
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

function teamMetaParts(teamNode) {
  if (Array.isArray(teamNode)) return teamNode;
  if (teamNode && typeof teamNode === 'object' && Array.isArray(teamNode.team)) return teamNode.team;
  return teamNode ? [teamNode] : [];
}

/** Read one scoreboard side without leaking the sibling team's name/points/odds. */
function readTeamSide(teamNode) {
  const parts = teamMetaParts(teamNode);
  let teamKey = '';
  let name = '';
  let logo = '';
  let standing = null;
  let winOdds = null;

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const bundle = Array.isArray(part) ? part : [part];
    for (const item of bundle) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (!teamKey && item.team_key) teamKey = String(item.team_key).trim();
      if (!name && typeof item.name === 'string' && item.name.trim() && !item.manager_id) {
        name = item.name.trim();
      }
      if (!logo && item.team_logos) {
        const logos = collectionItems(item.team_logos);
        const first = logos[0]?.team_logo || logos[0] || item.team_logos?.team_logo || item.team_logos;
        const url = first?.url || (typeof first === 'string' ? first : '');
        if (url) logo = String(url);
      }
      if (!standing && item.team_standings) {
        const standings = mergeYahoo(item.team_standings);
        const outcome = mergeYahoo(standings.outcome_totals || standings);
        const wins = finiteNumber(outcome.wins);
        const losses = finiteNumber(outcome.losses);
        if (wins != null && losses != null) {
          standing = {
            wins,
            losses,
            ties: finiteNumber(outcome.ties) || 0,
            rank: finiteNumber(standings.rank ?? item.rank)
          };
        }
      }
      if (winOdds == null && item.win_probability != null) {
        winOdds = finiteNumber(item.win_probability);
      }
    }
    const mergedPart = mergeYahoo(part);
    if (!teamKey && mergedPart.team_key) teamKey = String(mergedPart.team_key).trim();
    if (!name && typeof mergedPart.name === 'string' && mergedPart.name.trim()) name = mergedPart.name.trim();
    if (winOdds == null && mergedPart.win_probability != null) winOdds = finiteNumber(mergedPart.win_probability);
  }

  if (!teamKey) {
    teamKey = ownRecord(teamNode, 'team_key') || String(findYahooKey(teamNode, 'team_key') || '').trim();
  }
  if (!teamKey) return null;

  if (!name) {
    // Prefer a string team nickname near team_key — never a manager name object.
    name = recordName(teamNode, 'team_key');
  }
  if (!name) {
    for (const part of parts) {
      const hit = Array.isArray(part)
        ? part.find((item) => item && typeof item.name === 'string' && item.name.trim())
        : (part && typeof part.name === 'string' ? part : null);
      if (hit?.name) {
        name = String(hit.name).trim();
        break;
      }
    }
  }

  if (!standing) {
    const outcome = findYahooKey(teamNode, 'outcome_totals');
    if (outcome && typeof outcome === 'object') {
      const wins = finiteNumber(outcome.wins);
      const losses = finiteNumber(outcome.losses);
      if (wins != null && losses != null) {
        standing = {
          wins,
          losses,
          ties: finiteNumber(outcome.ties) || 0,
          rank: finiteNumber(findYahooKey(teamNode, 'rank'))
        };
      }
    }
  }
  if (!standing) {
    walkYahoo(teamNode, (value) => {
      if (standing || !value || typeof value !== 'object' || Array.isArray(value)) return;
      if (value.manager_id || value.managers || value.manager) return;
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
  }

  if (winOdds == null) winOdds = finiteNumber(findYahooKey(teamNode, 'win_probability'));
  if (!logo) {
    const logoNode = findYahooKey(teamNode, 'team_logo') || findYahooKey(teamNode, 'team_logos');
    const url = logoNode?.url
      || logoNode?.team_logo?.url
      || (typeof logoNode === 'string' ? logoNode : '');
    if (url) logo = String(url);
  }

  // Scope point totals to this team node only (never the sibling matchup side).
  const score = nestedTotal(teamNode, 'team_points');
  const proj = nestedTotal(teamNode, 'team_projected_points');
  return {
    teamKey,
    name: name || '',
    logo: logo || '',
    score: score != null ? score : null,
    proj: proj != null ? proj : null,
    winOdds: winOdds != null ? winOdds : null,
    record: standing ? { wins: standing.wins, losses: standing.losses, ties: standing.ties } : null,
    rank: standing?.rank || null
  };
}

async function fetchLeagueMeta(token, leagueKey) {
  try {
    const body = await yahooGet(`/league/${leagueKey}`, token);
    const parsed = parseLeagues(body);
    const hit = parsed.find((league) => league.leagueKey === leagueKey) || parsed[0] || null;
    if (hit?.name && !isGenericYahooSectionName(hit.name)) return hit;
    // Direct /league/{key} payloads are often a flat league array without collection wrappers.
    const leagueNode = findYahooKey(body, 'league') ?? body?.fantasy_content?.league;
    const merged = mergeYahoo(leagueNode);
    const name = leagueNameFromMerged(merged, leagueNode, leagueKey)
      || String(merged.name || yahooNameText(findYahooKey(leagueNode, 'name')) || '').trim();
    const key = String(
      findYahooKey(leagueNode, 'league_key') ?? merged.league_key ?? leagueKey
    ).trim();
    if (name && !isGenericYahooSectionName(name)) {
      return {
        leagueKey: key,
        name,
        week: finiteNumber(findYahooKey(leagueNode, 'current_week') ?? merged.current_week),
        season: String(findYahooKey(leagueNode, 'season') ?? merged.season ?? '')
      };
    }
    return hit;
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
      .map((entry) => {
        // Yahoo wraps each side as { team: [metaArray, pointsObject] } — keep sides isolated.
        const teamNode = entry?.team ?? entry;
        return readTeamSide(teamNode);
      })
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
    // Strictly use the opposing scoreboard side — never copy mine onto opp.
    const oppTeamName = (
      scoreboard.opp?.name
      && scoreboard.opp.name !== myTeamName
      && scoreboard.opp.teamKey
      && scoreboard.opp.teamKey !== teamKey
    ) ? scoreboard.opp.name : (scoreboard.opp?.name && scoreboard.opp.teamKey !== teamKey ? scoreboard.opp.name : '');
    const resolvedOppName = oppTeamName || (scoreboard.opp?.teamKey && scoreboard.opp.teamKey !== teamKey ? (scoreboard.opp.name || 'Opponent') : 'Opponent');
    // Always resolve league metadata separately from the team name ("YANNACONDA" ≠ "BCliff Football").
    let leagueMeta = league;
    const needsLeagueName = !leagueMeta?.name
      || isGenericYahooSectionName(leagueMeta.name)
      || leagueMeta.name === myTeamName
      || leagueMeta.name === resolvedOppName;
    if (needsLeagueName) {
      const fetched = await fetchLeagueMeta(token, leagueKey);
      if (fetched?.name
        && !isGenericYahooSectionName(fetched.name)
        && fetched.name !== myTeamName
        && fetched.name !== resolvedOppName) {
        leagueMeta = { ...(leagueMeta || {}), ...fetched };
        leagueByKey.set(leagueKey, leagueMeta);
      }
    }
    const resolvedLeagueName = (leagueMeta?.name
      && !isGenericYahooSectionName(leagueMeta.name)
      && leagueMeta.name !== myTeamName
      && leagueMeta.name !== resolvedOppName)
      ? leagueMeta.name
      : '';
    // Never store the fantasy team name as the league name.
    const leagueName = resolvedLeagueName || 'Yahoo League';
    const myRoster = startingLineup(roster).map((player) => ({ ...player }));
    const theirRoster = startingLineup(oppRoster).map((player) => ({ ...player }));
    // Sum Yahoo actuals only — never projected — so unplayed MNF starters stay at 0.
    const starterTotal = (players) => players.reduce((sum, player) => {
      const actual = finiteNumber(player?.actualPoints);
      if (actual != null) return sum + actual;
      return sum + (finiteNumber(player?.points) || 0);
    }, 0);
    const starterProjTotal = (players) => players.reduce((sum, player) => {
      const proj = finiteNumber(player?.projPoints ?? player?.projected);
      return sum + (proj != null ? proj : 0);
    }, 0);
    const myStarterScore = starterTotal(myRoster);
    const oppStarterScore = starterTotal(theirRoster);
    const myStarterProj = starterProjTotal(myRoster);
    const oppStarterProj = starterProjTotal(theirRoster);
    const myBoardScore = finiteNumber(scoreboard.mine?.score);
    const oppBoardScore = (
      scoreboard.opp?.teamKey
      && scoreboard.opp.teamKey !== teamKey
    ) ? finiteNumber(scoreboard.opp?.score) : null;
    const myBoardProj = finiteNumber(scoreboard.mine?.proj);
    const oppBoardProj = (
      scoreboard.opp?.teamKey
      && scoreboard.opp.teamKey !== teamKey
    ) ? finiteNumber(scoreboard.opp?.proj) : null;
    const myWinOdds = finiteNumber(scoreboard.mine?.winOdds);
    const oppWinOdds = (
      scoreboard.opp?.teamKey
      && scoreboard.opp.teamKey !== teamKey
    ) ? finiteNumber(scoreboard.opp?.winOdds) : null;
    const yahooStatsOk = rosterHasWeekStats(myRoster)
      || rosterHasWeekStats(theirRoster)
      || myBoardScore != null
      || myBoardProj != null;
    const myScore = preferScore(myBoardScore, myStarterScore, 0);
    const oppScore = preferScore(oppBoardScore, oppStarterScore, 0);
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
      teamName: myTeamName,
      platform: 'Yahoo',
      scoringSource: 'yahoo',
      yahooNative: true,
      yahooStatsOk,
      season: leagueMeta?.season || league?.season || '2026',
      // Prefer Yahoo scoreboard team_points / team_projected_points totals.
      myScore,
      oppScore,
      myProj: preferScore(myBoardProj, myStarterProj, null),
      oppProj: preferScore(oppBoardProj, oppStarterProj, null),
      myProjected: preferScore(myBoardProj, myStarterProj, null),
      oppProjected: preferScore(oppBoardProj, oppStarterProj, null),
      myWinOdds,
      oppWinOdds,
      myTeamName,
      oppTeamName: resolvedOppName,
      opponent: resolvedOppName,
      myLogo: scoreboard.mine?.logo || '',
      oppLogo: (scoreboard.opp?.teamKey !== teamKey ? scoreboard.opp?.logo : '') || '',
      myRecord: scoreboard.mine?.record || null,
      oppRecord: (scoreboard.opp?.teamKey !== teamKey ? scoreboard.opp?.record : null) || null,
      myRank: scoreboard.mine?.rank || null,
      oppRank: (scoreboard.opp?.teamKey !== teamKey ? scoreboard.opp?.rank : null) || null,
      userTeam: {
        name: myTeamName,
        logo: scoreboard.mine?.logo || '',
        winOdds: myWinOdds,
        starters: myRoster.map((player) => ({ ...player }))
      },
      oppTeam: {
        name: resolvedOppName,
        logo: (scoreboard.opp?.teamKey !== teamKey ? scoreboard.opp?.logo : '') || '',
        winOdds: oppWinOdds,
        starters: theirRoster.map((player) => ({ ...player }))
      },
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

  // Raw samples so we can verify nested player_points / team_points keys (33.16, 11.30, etc.).
  const rawPlayerEntry = (() => {
    const fantasy = rosterBody?.fantasy_content || rosterBody;
    const teamNode = findYahooKey(fantasy, 'team')
      ?? rosterBody?.fantasy_content?.team
      ?? rosterBody?.fantasy_content?.league;
    const rosterNode = findYahooKey(teamNode, 'roster') ?? mergeYahoo(teamNode).roster;
    const playersNode = findYahooKey(rosterNode, 'players')
      || findYahooKey(teamNode, 'players');
    return collectionItems(playersNode)[0] || null;
  })();
  const rawScoreboardTeam = (() => {
    let hit = null;
    walkYahoo(scoreboardBody, (node) => {
      if (hit || !node || typeof node !== 'object' || Array.isArray(node) || !node.teams) return;
      const side = collectionItems(node.teams)[0];
      if (side) hit = side?.team || side;
    });
    return hit;
  })();

  if (rawPlayerEntry) {
    console.info('[yahoo-inspect] raw player entry keys', Object.keys(rawPlayerEntry?.player || rawPlayerEntry || {}));
    console.info('[yahoo-inspect] player_points', findYahooKey(rawPlayerEntry, 'player_points'));
    console.info('[yahoo-inspect] player_projected_points', findYahooKey(rawPlayerEntry, 'player_projected_points'));
  }
  if (rawScoreboardTeam) {
    console.info('[yahoo-inspect] raw scoreboard team', summarizeYahooNode(rawScoreboardTeam));
    console.info('[yahoo-inspect] team_points', findYahooKey(rawScoreboardTeam, 'team_points'));
  }

  return {
    week,
    nflWeek,
    parsedLeagues,
    parsedTeams: parsedTeams.map((team) => ({ teamKey: team.teamKey, name: team.name, leagueKey: team.leagueKey })),
    sampleLeagueNameHit: findFirstYahooField(leagueBody, 'name'),
    sampleLeagueKeyHit: findFirstYahooField(leagueBody, 'league_key'),
    leagueObjectSample: summarizeYahooNode(findFirstYahooField(leagueBody, 'league')?.value || leagueBody?.fantasy_content),
    rawPlayerEntry: summarizeYahooNode(rawPlayerEntry),
    rawScoreboardTeam: summarizeYahooNode(rawScoreboardTeam),
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
      idpParsed: parsedRoster.filter((player) => {
        const slot = String(player?.slot || player?.position || '').toUpperCase();
        return slot === 'DP' || slot === 'DB' || slot === 'DL' || slot === 'LB' || slot === 'DT' || slot === 'DE' || slot === 'S' || slot === 'CB';
      }).slice(0, 5),
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
