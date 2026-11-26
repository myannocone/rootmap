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

/** NFL week runs Tuesday through Monday Night. Not a Thursday-origin index. */
const NFL_WEEK_INDEX = { tue: 0, wed: 1, thu: 2, fri: 3, sat: 4, sun: 5, mon: 6 };

function finiteInstant(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function etSnapshot(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = String(map.weekday || '').slice(0, 3).toLowerCase();
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  return {
    weekday,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)
  };
}

function weekdayClock(text) {
  const source = String(text || '');
  const day = source.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)/i);
  if (!day) return null;
  const key = day[1].slice(0, 3).toLowerCase();
  if (NFL_WEEK_INDEX[key] == null) return null;
  const clock = source.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  let minutes = 12 * 60;
  if (clock) {
    let hour = Number(clock[1]) % 12;
    if (/p/i.test(clock[3])) hour += 12;
    minutes = hour * 60 + Number(clock[2] || 0);
  }
  return { day: key, minutes };
}

function directKickoff(game) {
  return finiteInstant(game?.kickoff)
    ?? finiteInstant(game?.date)
    ?? finiteInstant(game?.startTime)
    ?? finiteInstant(game?.start);
}

/**
 * True kickoff instant. A missing ISO date still sorts inside the slate week
 * (Tuesday through Monday) when the status text names a weekday, so a
 * Wednesday game is not pushed after Monday Night.
 */
function kickoffSortKey(game, anchorMs) {
  const direct = directKickoff(game);
  if (direct != null) return direct;
  const clock = weekdayClock(`${game?.kickoff || ''} ${game?.status || ''} ${game?.time || ''}`);
  if (!clock) return Number.POSITIVE_INFINITY;
  const day = NFL_WEEK_INDEX[clock.day];
  if (!Number.isFinite(anchorMs)) return day * 1440 + clock.minutes;
  const anchor = etSnapshot(anchorMs);
  const anchorDay = NFL_WEEK_INDEX[anchor.weekday];
  if (anchorDay == null) return day * 1440 + clock.minutes;
  const weekStart = anchorMs - anchorDay * 86400000 - anchor.minutes * 60000;
  return weekStart + day * 86400000 + clock.minutes * 60000;
}

/** True kickoff instant. Missing timestamps sort after every real kickoff. */
export function kickoffMillis(value) {
  if (value && typeof value === 'object') return kickoffSortKey(value, directKickoff(value));
  return finiteInstant(value) ?? Number.POSITIVE_INFINITY;
}

/** Earliest kickoff first. Wednesday precedes Thursday; Monday Night is last. */
export function compareGamesByKickoff(a, b) {
  const anchor = directKickoff(a) ?? directKickoff(b);
  return kickoffSortKey(a, anchor) - kickoffSortKey(b, anchor);
}

/** Game Slate and Jump to Game order: kickoff ascending, then away/home. */
export function sortGamesByKickoff(games) {
  const list = [...(games || [])];
  const anchor = list.reduce((best, game) => {
    const ms = directKickoff(game);
    if (ms == null) return best;
    return best == null || ms < best ? ms : best;
  }, null);
  return list.sort((a, b) => {
    const delta = kickoffSortKey(a, anchor) - kickoffSortKey(b, anchor);
    if (delta) return delta;
    return String(a?.away || '').localeCompare(String(b?.away || ''))
      || String(a?.home || '').localeCompare(String(b?.home || ''));
  });
}
