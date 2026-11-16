import { resolveNflTeam } from './leagueParser.js';

const TEAM_ALIASES = {
  WSH: 'WAS',
  JAC: 'JAX',
  LA: 'LAR',
  OAK: 'LV',
  SD: 'LAC',
  ARZ: 'ARI',
  GBP: 'GB',
  GNB: 'GB',
  KAN: 'KC',
  NOR: 'NO',
  TAM: 'TB',
  SFO: 'SF',
  NWE: 'NE'
};

const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'
]);

/** Normalize an NFL abbreviation (aliases + uppercase). Empty / FA stay blank. */
export function canonTeamCode(team) {
  const raw = String(team || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!raw || raw === 'FA' || raw === 'FREE' || raw === 'NONE') return '';
  const key = TEAM_ALIASES[raw] || raw;
  return NFL_TEAMS.has(key) ? key : '';
}

export function normalizePlayerMatchName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMatchPosition(position, slot = '') {
  const pos = String(position || '').toUpperCase().trim().split(',')[0].trim();
  const slotKey = String(slot || '').toUpperCase().trim().split(',')[0].trim();
  if ([pos, slotKey].some((value) => value === 'DEF' || value === 'DST' || value === 'D/ST')) return 'D/ST';
  if (pos && pos !== 'FLEX' && pos !== 'OP') return pos;
  if (slotKey && slotKey !== 'FLEX' && slotKey !== 'OP' && slotKey !== 'BN') return slotKey;
  return pos || slotKey || '';
}

function sleeperPlayerName(meta) {
  return meta?.full_name || [meta?.first_name, meta?.last_name].filter(Boolean).join(' ').trim();
}

function sleeperPlayerPosition(meta) {
  const pos = String(meta?.position || meta?.fantasy_positions?.[0] || '').toUpperCase();
  if (pos === 'DEF' || pos === 'DST') return 'D/ST';
  return pos;
}

/**
 * Build name / name|position indexes from a Sleeper `/players/nfl` dictionary.
 * Prefer active NFL players when names collide.
 */
export function buildSleeperTeamIndex(players) {
  const byName = new Map();
  const byNamePos = new Map();
  if (!players || typeof players !== 'object') {
    return { byName, byNamePos };
  }

  const remember = (map, key, team, rank) => {
    if (!key || !team) return;
    const existing = map.get(key);
    if (!existing || rank > existing.rank) map.set(key, { team, rank });
  };

  Object.values(players).forEach((meta) => {
    if (!meta || typeof meta !== 'object') return;
    const team = canonTeamCode(meta.team) || resolveNflTeam(meta.team);
    if (!team) return;
    const nameKey = normalizePlayerMatchName(sleeperPlayerName(meta));
    if (!nameKey) return;
    const posKey = normalizeMatchPosition(sleeperPlayerPosition(meta));
    const active = meta.active === true || meta.status === 'Active' || meta.team;
    const rank = (active ? 4 : 0) + (meta.search_rank != null ? Math.max(0, 1000 - Number(meta.search_rank || 1000)) / 1000 : 0);
    remember(byName, nameKey, team, rank);
    if (posKey) remember(byNamePos, `${nameKey}|${posKey}`, team, rank);
  });

  return { byName, byNamePos };
}

let cachedIndex = null;
let cachedSource = null;

export function sleeperTeamIndexFrom(players) {
  if (!players || typeof players !== 'object') return { byName: new Map(), byNamePos: new Map() };
  if (cachedSource === players && cachedIndex) return cachedIndex;
  cachedSource = players;
  cachedIndex = buildSleeperTeamIndex(players);
  return cachedIndex;
}

export function lookupTeamFromSleeper(name, position = '', slot = '', players = null, index = null) {
  const table = index || (players ? sleeperTeamIndexFrom(players) : null);
  if (!table) return '';
  const nameKey = normalizePlayerMatchName(name);
  if (!nameKey) return '';
  const posKey = normalizeMatchPosition(position, slot);
  if (posKey) {
    const hit = table.byNamePos.get(`${nameKey}|${posKey}`);
    if (hit?.team) return hit.team;
  }
  return table.byName.get(nameKey)?.team || '';
}

export function needsTeamBackfill(team) {
  const raw = String(team || '').trim();
  if (!raw) return true;
  const upper = raw.toUpperCase();
  if (upper === 'FA' || upper === 'FREE' || upper === 'NONE' || upper === 'N/A') return true;
  return !canonTeamCode(raw) && !resolveNflTeam(raw);
}

/** Fill blank / FA team codes from mascot/city names, abbreviation, or Sleeper directory. */
export function backfillPlayerTeam(player, players = null, index = null) {
  if (!player || typeof player !== 'object') return player;
  const current = canonTeamCode(player.nflTeam || player.team) || resolveNflTeam(player.nflTeam || player.team);
  if (current && !needsTeamBackfill(current)) {
    if (player.nflTeam !== current || player.team !== current) {
      return { ...player, nflTeam: current, team: current };
    }
    return player;
  }
  // Yahoo D/ST entries are often mascot-only ("Bills", "Texans") with a blank team.
  const fromName = resolveNflTeam(player.name);
  const fromSleeper = lookupTeamFromSleeper(
    player.name,
    player.position,
    player.slot,
    players,
    index
  );
  const team = fromName || canonTeamCode(fromSleeper) || fromSleeper;
  if (!team) return player;
  return { ...player, nflTeam: team, team };
}

export function backfillPlayersTeam(list, players = null, index = null) {
  return (list || []).map((player) => backfillPlayerTeam(player, players, index));
}
