/**
 * Shared matchup lineup ordering + pairing.
 * Pair by roster slot type (QB vs QB), never by raw array index.
 */

const BENCH_SLOTS = new Set(['BN', 'IR', 'IR+', 'NA', 'TAXI', 'BENCH', 'BE']);

/** Display / sort priority for starter slots. Lower = earlier. */
const SLOT_RANK = {
  QB: 10,
  RB: 20,
  WR: 30,
  TE: 40,
  'RB/WR': 50,
  'WR/TE': 55,
  FLEX: 60,
  'W/R/T': 60,
  'W/R': 60,
  OP: 70,
  SUPERFLEX: 75,
  'Q/W/R/T': 75,
  DT: 80,
  DE: 81,
  DL: 82,
  LB: 83,
  CB: 84,
  S: 85,
  DB: 86,
  DP: 87,
  IDP: 87,
  D: 87,
  K: 90,
  PK: 90,
  DEF: 100,
  'D/ST': 100,
  DST: 100
};

const SLOT_FAMILY = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  'RB/WR': 'RB/WR',
  'WR/TE': 'WR/TE',
  FLEX: 'FLEX',
  'W/R/T': 'FLEX',
  'W/R': 'FLEX',
  UTIL: 'FLEX',
  OP: 'OP',
  SUPERFLEX: 'SUPERFLEX',
  'Q/W/R/T': 'SUPERFLEX',
  DT: 'DP',
  DE: 'DP',
  DL: 'DP',
  LB: 'DP',
  CB: 'DP',
  S: 'DP',
  DB: 'DP',
  DP: 'DP',
  IDP: 'DP',
  D: 'DP',
  K: 'K',
  PK: 'K',
  DEF: 'DEF',
  'D/ST': 'DEF',
  DST: 'DEF'
};

export function normalizeLineupSlot(slot, position = '') {
  const raw = String(slot || position || '').toUpperCase().trim();
  if (!raw) return '';
  if (raw === 'D/ST' || raw === 'DST' || raw === 'DEF') return 'D/ST';
  if (raw === 'W/R/T' || raw === 'W/R' || raw === 'UTIL') return 'FLEX';
  if (raw === 'PK') return 'K';
  if (raw === 'BE' || raw === 'BENCH') return 'BN';
  if (raw === 'D' || raw === 'IDP') return 'DP';
  return raw;
}

export function slotFamily(slot, position = '') {
  const key = normalizeLineupSlot(slot, position);
  return SLOT_FAMILY[key] || key || '';
}

export function slotSortRank(slot, position = '') {
  const key = normalizeLineupSlot(slot, position);
  if (SLOT_RANK[key] != null) return SLOT_RANK[key];
  const family = slotFamily(key);
  if (SLOT_RANK[family] != null) return SLOT_RANK[family];
  return 500;
}

export function isBenchSlot(slot) {
  const key = normalizeLineupSlot(slot);
  return BENCH_SLOTS.has(key);
}

export function displaySlotLabel(slot, position = '') {
  const key = normalizeLineupSlot(slot, position);
  if (!key) return '—';
  if (key === 'DEF' || key === 'DST') return 'D/ST';
  if (key === 'IDP' || key === 'D') return 'DP';
  return key;
}

/**
 * Stable starter order: by slot rank, then original index.
 */
export function sortStartersBySlot(players) {
  return (players || [])
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player && player.isStarter !== false && !isBenchSlot(player.slot))
    .sort((a, b) => {
      const rankDiff = slotSortRank(a.player.slot, a.player.position) - slotSortRank(b.player.slot, b.player.position);
      if (rankDiff !== 0) return rankDiff;
      return a.index - b.index;
    })
    .map(({ player }) => player);
}

/**
 * Build the ordered slot template for a league.
 * Prefers platform roster positions; otherwise derives from both sides' starter slots.
 */
export function lineupSlotTemplate(rosterPositions, mine = [], opp = []) {
  const fromSettings = (rosterPositions || [])
    .map((slot) => normalizeLineupSlot(slot))
    .filter((slot) => slot && !isBenchSlot(slot));
  if (fromSettings.length) return fromSettings;

  const counts = new Map();
  const note = (player) => {
    const slot = normalizeLineupSlot(player?.slot, player?.position);
    if (!slot || isBenchSlot(slot)) return;
    counts.set(slot, (counts.get(slot) || 0) + 1);
  };
  (mine || []).forEach(note);
  (opp || []).forEach(note);

  const merged = new Map();
  [...(mine || []), ...(opp || [])].forEach((player) => {
    const slot = normalizeLineupSlot(player?.slot, player?.position);
    if (!slot || isBenchSlot(slot)) return;
    // Keep max occupancy per concrete slot label across sides.
    const mineCount = (mine || []).filter((row) => normalizeLineupSlot(row?.slot, row?.position) === slot).length;
    const oppCount = (opp || []).filter((row) => normalizeLineupSlot(row?.slot, row?.position) === slot).length;
    merged.set(slot, Math.max(mineCount, oppCount, counts.get(slot) || 0));
  });

  const slots = [];
  [...merged.entries()]
    .sort((a, b) => slotSortRank(a[0]) - slotSortRank(b[0]))
    .forEach(([slot, count]) => {
      for (let i = 0; i < count; i += 1) slots.push(slot);
    });
  return slots;
}

const SPECIFIC_IDP_SLOTS = new Set(['DT', 'DE', 'DL', 'LB', 'CB', 'S', 'DB']);

function takeForTemplateRow(pool, slot, index) {
  const pinned = pool.findIndex((player) => Number.isInteger(player?.lineupIndex) && player.lineupIndex === index);
  if (pinned >= 0) {
    const [player] = pool.splice(pinned, 1);
    return player;
  }
  const wantSlot = normalizeLineupSlot(slot);
  const exact = pool.findIndex((player) => (
    !Number.isInteger(player?.lineupIndex)
    && normalizeLineupSlot(player?.slot, player?.position) === wantSlot
  ));
  if (exact >= 0) {
    const [player] = pool.splice(exact, 1);
    return player;
  }
  // DT/DE/LB stay on their own labels. Generic FLEX / DP / D/ST can still share a family.
  if (SPECIFIC_IDP_SLOTS.has(wantSlot)) return null;
  const want = slotFamily(slot);
  const familyIndex = pool.findIndex((player) => (
    !Number.isInteger(player?.lineupIndex)
    && slotFamily(player?.slot, player?.position) === want
  ));
  if (familyIndex < 0) return null;
  const [player] = pool.splice(familyIndex, 1);
  return player;
}

function pushLineupRow(rows, slot, minePlayer, oppPlayer) {
  rows.push({
    key: `${slot}-${rows.length}-${minePlayer?.name || 'empty'}-${oppPlayer?.name || 'empty'}`,
    slot: displaySlotLabel(slot, minePlayer?.position || oppPlayer?.position),
    mine: minePlayer,
    opp: oppPlayer
  });
}

/**
 * Pair starters for matchup UI: same slot label on each row.
 * Players pinned with lineupIndex stay on that roster slot (empty holes stay empty).
 * Leftovers each get their own row so a DT never slides onto an LB.
 */
export function pairStartersBySlot(mine, opp, rosterPositions = null) {
  const leftPool = sortStartersBySlot(mine).slice();
  const rightPool = sortStartersBySlot(opp).slice();
  const template = lineupSlotTemplate(rosterPositions, leftPool, rightPool);
  const rows = [];

  template.forEach((slot, index) => {
    const minePlayer = takeForTemplateRow(leftPool, slot, index);
    const oppPlayer = takeForTemplateRow(rightPool, slot, index);
    if (!minePlayer && !oppPlayer) return;
    pushLineupRow(rows, slot, minePlayer, oppPlayer);
  });

  leftPool.forEach((minePlayer) => {
    pushLineupRow(rows, minePlayer?.slot || '', minePlayer, null);
  });
  rightPool.forEach((oppPlayer) => {
    pushLineupRow(rows, oppPlayer?.slot || '', null, oppPlayer);
  });

  return rows;
}

/**
 * Pregame "live" totals must not include projection placeholders.
 * Only count actualPoints (or points when the player is live/final).
 */
export function starterScoredPoints(player) {
  if (!player) return 0;
  const actual = Number(player.actualPoints);
  if (Number.isFinite(actual)) return actual;
  if (player.isLive || player.gameStatus === 'IN_PROGRESS' || player.gameStatus === 'FINAL' || player.isFinal) {
    const points = Number(player.points);
    return Number.isFinite(points) ? points : 0;
  }
  return 0;
}

export function starterProjectedPoints(player) {
  if (!player) return 0;
  const proj = Number(player.projPoints ?? player.projectedPoints ?? player.projected);
  if (Number.isFinite(proj)) return proj;
  if (player.isLive || player.gameStatus === 'IN_PROGRESS' || player.gameStatus === 'FINAL' || player.isFinal) {
    return 0;
  }
  const points = Number(player.points);
  return Number.isFinite(points) ? points : 0;
}
