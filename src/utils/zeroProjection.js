import { resolveNflTeam } from './leagueParser.js';
import { sleeperLiveNumbers } from './sleeperApi.js';

function phaseOf(game, now = new Date()) {
  const state = String(game?.state || game?.gameStatus || '').toLowerCase();
  const clock = `${game?.status || ''} ${game?.time || ''}`;
  if (state === 'post' || state === 'final' || game?.completed || /\bfinal\b/i.test(clock)) return 'FINAL';
  if (state === 'in' || state === 'in_progress' || /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(clock) || /\bLIVE\b/i.test(clock)) {
    return 'IN_PROGRESS';
  }
  if (state === 'pre' || state === 'upcoming') return 'UPCOMING';
  const kickoff = Date.parse(game?.kickoff || '');
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isFinite(kickoff) && instant >= kickoff) return 'IN_PROGRESS';
  return 'UPCOMING';
}

const BENCH_SLOTS = new Set(['BN', 'IR', 'IR+', 'NA', 'TAXI', 'BENCH']);

function leagueNameOf(league) {
  return league?.name || league?.myTeamName || league?.userTeam?.name || 'My Team';
}

function userStarters(league) {
  const lists = [league?.portfolio, league?.starters, league?.userTeam?.starters];
  const list = lists.find((entry) => Array.isArray(entry)) || [];
  return list.filter((player) => player && player.isThreat !== true && player.ownership !== 0);
}

export function isActiveStarterSlot(player) {
  if (!player?.name || player.isStarter === false) return false;
  const slot = String(player.slot || player.lineupSlot || '').toUpperCase().trim();
  if (BENCH_SLOTS.has(slot)) return false;
  const slotId = Number(player.lineupSlot ?? player.slotId);
  if (slotId === 20 || slotId === 21) return false;
  return true;
}

function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function projectionReading(player, liveScores) {
  const live = sleeperLiveNumbers(player, liveScores);
  const liveProj = numeric(live?.proj);
  if (liveProj != null) return { value: liveProj, known: true };
  const explicit = numeric(player?.projected_points);
  if (explicit != null) return { value: explicit, known: true };
  const named = numeric(player?.projection);
  if (named != null) return { value: named, known: true };
  const stored = numeric(player?.projPoints);
  if (stored == null) return { value: null, known: false };
  if (stored > 0 || player?.sleeperId) return { value: stored, known: true };
  return { value: stored, known: false };
}

function gameForTeam(games, team) {
  const key = resolveNflTeam(team);
  if (!key) return null;
  return (games || []).find((game) => resolveNflTeam(game?.home) === key || resolveNflTeam(game?.away) === key) || null;
}

export function isBeforeKickoff(player, games, now = new Date()) {
  const clock = `${player?.gameClock || ''} ${player?.gameStatus || ''} ${player?.opponent || ''}`;
  if (player?.isBye || player?.gameStatus === 'BYE' || /\bbye\b/i.test(clock)) return false;
  if (player?.gameStatus === 'FINAL' || player?.gameStatus === 'IN_PROGRESS' || player?.isLive) return false;
  if (/\bfinal\b/i.test(clock) || /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(clock) || /\bLIVE\b/i.test(clock)) {
    return false;
  }
  const game = gameForTeam(games, player?.nflTeam || player?.team);
  if (!game) return true;
  const phase = phaseOf(game, now);
  return phase !== 'FINAL' && phase !== 'IN_PROGRESS';
}

export function starterProjectionStatus(player, { games, liveScores, now } = {}) {
  if (!isActiveStarterSlot(player)) return null;
  const reading = projectionReading(player, liveScores);
  const game = gameForTeam(games, player?.nflTeam || player?.team);
  const beforeKickoff = isBeforeKickoff(player, games, now);
  return {
    zero: Boolean(reading.known && reading.value <= 0 && beforeKickoff),
    projection: reading.value,
    known: reading.known,
    kickoff: game?.kickoff || player?.kickoff || null,
    gameClock: game?.time || game?.status || player?.gameClock || ''
  };
}

export function checkZeroProjectionStarters(leagues, options = {}) {
  const alerts = [];
  (leagues || []).forEach((league) => {
    const leagueName = leagueNameOf(league);
    userStarters(league).forEach((player) => {
      const status = starterProjectionStatus(player, options);
      if (!status?.zero) return;
      const nflTeam = resolveNflTeam(player.nflTeam || player.team) || String(player.nflTeam || player.team || '');
      alerts.push({
        id: `${league?.id || leagueName}|${String(player.name).trim().toLowerCase()}|${nflTeam}|${status.kickoff || status.gameClock || ''}`,
        name: player.name,
        nflTeam,
        leagueId: league?.id || '',
        leagueName,
        kickoff: status.kickoff,
        gameClock: status.gameClock,
        projection: status.projection
      });
    });
  });
  return alerts;
}
