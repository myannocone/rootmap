/**
 * Display order for deduplicated players inside a Game Slate card.
 * Impact is the higher of scored and projected points. League count is
 * roots.length when a roots list is present, otherwise the leagues this
 * card was merged from. Name is the last tie-break.
 */

function projectedPointsOf(player) {
  return player?.projectedPoints ?? player?.projPoints ?? player?.projected;
}

export function slateFantasyImpact(player) {
  const actualPoints = player?.actualPoints;
  const projectedPoints = projectedPointsOf(player);
  return Math.max(actualPoints || 0, projectedPoints || 0);
}

export function slatePlayerRoots(player) {
  if (Array.isArray(player?.roots)) return player.roots;
  const leagues = [
    ...(Array.isArray(player?.myLeagues) ? player.myLeagues : []),
    ...(Array.isArray(player?.oppLeagues) ? player.oppLeagues : [])
  ];
  if (leagues.length) return leagues;
  const shareCount = (player?.myShares || 0) + (player?.oppShares || 0);
  return Array.from({ length: Math.max(0, shareCount) });
}

export function compareSlateGamePlayers(a, b) {
  const impactDelta = slateFantasyImpact(b) - slateFantasyImpact(a);
  if (impactDelta) return impactDelta;
  const rootsDelta = slatePlayerRoots(b).length - slatePlayerRoots(a).length;
  if (rootsDelta) return rootsDelta;
  return String(a?.name || '').localeCompare(String(b?.name || ''), 'en', { sensitivity: 'base' });
}

export function sortSlateGamePlayers(players) {
  return [...(players || [])].sort(compareSlateGamePlayers);
}

/** True kickoff instant. Missing timestamps sort after every real kickoff. */
export function kickoffMillis(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/** Earliest kickoff first. Wednesday precedes Thursday; Monday Night is last. */
export function compareGamesByKickoff(a, b) {
  return kickoffMillis(a?.kickoff) - kickoffMillis(b?.kickoff);
}
