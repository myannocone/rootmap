const BENCH_SLOTS = new Set(['BN', 'IR', 'IR+', 'NA', 'TAXI', 'BENCH']);

const PROJECTED_NEEDS = [
  { slot: 'QB', positions: ['QB'], count: 1 },
  { slot: 'RB', positions: ['RB'], count: 2 },
  { slot: 'WR', positions: ['WR'], count: 2 },
  { slot: 'TE', positions: ['TE'], count: 1 },
  { slot: 'W/R/T', positions: ['RB', 'WR', 'TE'], count: 1 },
  { slot: 'K', positions: ['K', 'PK'], count: 1 },
  { slot: 'DEF', positions: ['DEF', 'D/ST', 'DST'], count: 1 }
];

export function isActiveYahooSlot(slot) {
  const key = String(slot || '').toUpperCase().trim();
  if (!key || BENCH_SLOTS.has(key)) return false;
  return true;
}

export function isActiveEspnSlot(slotId) {
  const id = Number(slotId);
  if (!Number.isFinite(id)) return false;
  if (id === 20 || id === 21) return false;
  return id < 20 || id === 23;
}

function positionKey(player) {
  return String(player?.position || player?.slot || '').toUpperCase().replace('D/ST', 'DEF').replace('DST', 'DEF').replace('PK', 'K');
}

function projection(player) {
  const value = Number(player?.projPoints ?? player?.points ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function projectedStarters(players) {
  const pool = (players || []).filter((player) => player?.name);
  const used = new Set();
  const picked = [];
  PROJECTED_NEEDS.forEach((need) => {
    const eligible = pool
      .filter((player) => !used.has(player) && need.positions.includes(positionKey(player)))
      .sort((a, b) => projection(b) - projection(a));
    eligible.slice(0, need.count).forEach((player) => {
      used.add(player);
      picked.push({
        ...player,
        slot: player.slot || need.slot,
        isStarter: true,
        projectedStart: true
      });
    });
  });
  return picked;
}

export function activeOrProjected(players) {
  const real = (players || []).filter((player) => player?.isStarter && !player.projectedStart);
  if (real.length) return real;
  const projected = projectedStarters(players);
  return projected.length ? projected : [];
}
