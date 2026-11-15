/** Shared player name / team / position identity for cross-league merge. */

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

const FLEXISH = new Set(['FLEX', 'OP', 'RB/WR', 'WR/TE', 'W/R/T', 'W/R', 'UTIL', 'BN', 'BENCH']);

export function canonTeamCode(team) {
  const raw = String(team || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!raw) return '';
  const key = TEAM_ALIASES[raw] || raw;
  return NFL_TEAMS.has(key) ? key : '';
}

/** Strip Jr/Sr/II/punctuation/casing for match keys. */
export function normalizePlayerMatchName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMatchPosition(position, slot = '') {
  const pos = String(position || '').toUpperCase().trim();
  const slotKey = String(slot || '').toUpperCase().trim();
  if (pos === 'DEF' || pos === 'DST' || pos === 'D/ST' || slotKey === 'DEF' || slotKey === 'D/ST' || slotKey === 'DST') {
    return 'D/ST';
  }
  if (pos && !FLEXISH.has(pos)) return pos.split(',')[0].trim();
  if (slotKey && !FLEXISH.has(slotKey)) {
    if (slotKey === 'DEF' || slotKey === 'DST') return 'D/ST';
    return slotKey.split(',')[0].trim();
  }
  return pos && !FLEXISH.has(pos) ? pos : (pos || slotKey || '');
}

/** Prefer real position over FLEX/OP slot labels for UI. */
export function displayPlayerPosition(player) {
  const pos = String(player?.position || '').toUpperCase().trim();
  const slot = String(player?.slot || '').toUpperCase().trim();
  if (pos === 'DEF' || pos === 'DST' || pos === 'D/ST' || slot === 'DEF' || slot === 'D/ST' || slot === 'DST') {
    return 'D/ST';
  }
  if (pos && !FLEXISH.has(pos)) return pos.split(',')[0].trim();
  if (slot && !FLEXISH.has(slot)) return slot === 'DEF' || slot === 'DST' ? 'D/ST' : slot.split(',')[0].trim();
  return pos || slot || '';
}

export function playerPosTeamLabel(player) {
  const pos = displayPlayerPosition(player);
  const team = canonTeamCode(player?.nflTeam || player?.team) || String(player?.nflTeam || player?.team || '').toUpperCase().trim();
  if (pos && team) return `${pos} • ${team}`;
  if (pos) return pos;
  if (team) return team;
  return '';
}

export function preferFiniteNumber(current, incoming, { preferPositive = false } = {}) {
  const next = incoming == null || incoming === '' ? null : Number(incoming);
  if (next == null || !Number.isFinite(next)) return current;
  const prev = current == null || current === '' ? null : Number(current);
  if (prev == null || !Number.isFinite(prev)) return next;
  if (preferPositive) {
    if (next > 0 && !(prev > 0)) return next;
    if (prev > 0 && !(next > 0)) return prev;
  }
  return next;
}

export function preferTeamCode(current, incoming) {
  const next = canonTeamCode(incoming);
  if (next) return next;
  const prev = canonTeamCode(current);
  if (prev) return prev;
  const rawNext = String(incoming || '').trim();
  if (rawNext) return rawNext.toUpperCase();
  return String(current || '').trim();
}

export function playerMatchKey(name, position, slot = '') {
  const nameKey = normalizePlayerMatchName(name);
  const posKey = normalizeMatchPosition(position, slot);
  return `${nameKey}|${posKey}`;
}

export function positionsCompatible(positionA, slotA, positionB, slotB) {
  const a = normalizeMatchPosition(positionA, slotA);
  const b = normalizeMatchPosition(positionB, slotB);
  if (!a || !b) return true;
  if (FLEXISH.has(a) || FLEXISH.has(b)) return true;
  return a === b;
}
