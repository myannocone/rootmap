/** Free-tier board limit: at most this many leagues may stay active (unchecked = hidden). */
export const MAX_FREE_ACTIVE_LEAGUES = 2;
export const FREE_ACTIVE_LEAGUE_LIMIT = MAX_FREE_ACTIVE_LEAGUES;

const PRO_STORAGE_KEY = 'rootmap_pro';

export function loadIsPro() {
  try {
    return localStorage.getItem(PRO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveIsPro(enabled) {
  try {
    if (enabled) localStorage.setItem(PRO_STORAGE_KEY, '1');
    else localStorage.removeItem(PRO_STORAGE_KEY);
  } catch {
    // preference storage is optional
  }
}

export function activeLeagueCount(leagues, hiddenLeagueIds) {
  const hidden = hiddenLeagueIds instanceof Set
    ? hiddenLeagueIds
    : new Set([...(hiddenLeagueIds || [])].map(String));
  return (leagues || []).filter((league) => !hidden.has(String(league?.id))).length;
}

export function freeActiveBadge(activeCount) {
  const used = Math.max(0, Number(activeCount) || 0);
  return `${used} / ${MAX_FREE_ACTIVE_LEAGUES} Free Active`;
}

/** Hide overflow so a saved free board cannot stay above the 2-league cap. */
export function clampFreeActiveHidden(leagues, hiddenLeagueIds) {
  const hidden = hiddenLeagueIds instanceof Set
    ? new Set([...hiddenLeagueIds].map(String))
    : new Set([...(hiddenLeagueIds || [])].map(String));
  const active = (leagues || []).filter((league) => league && !hidden.has(String(league.id)));
  active.slice(MAX_FREE_ACTIVE_LEAGUES).forEach((league) => {
    hidden.add(String(league.id));
  });
  return hidden;
}
