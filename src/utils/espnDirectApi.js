import { Capacitor } from '@capacitor/core';
import { activeOrProjected, isActiveEspnSlot } from './activeLineup.js';
import { sortStartersBySlot } from './matchupLineup.js';
import { canonTeamCode, displayPlayerPosition } from './playerIdentity.js';
import { SITE_ORIGIN } from './siteOrigin.js';

const ESPN_ORIGIN = 'https://lm-api-reads.fantasy.espn.com';
const ESPN_VIEWS = ['mBoxscore', 'mMatchup', 'mRoster', 'mScoreboard', 'mTeam', 'mSettings'];

const POSITION_BY_ID = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'CB',
  12: 'S',
  13: 'DL',
  14: 'DB',
  16: 'D/ST'
};

const SLOT_BY_ID = {
  0: 'QB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  7: 'OP',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'DL',
  12: 'CB',
  13: 'S',
  14: 'DB',
  15: 'DP',
  16: 'D/ST',
  17: 'K',
  23: 'FLEX'
};

const PRO_TEAM_BY_ID = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU'
};

const PRIVATE_LEAGUE_ERROR = "This ESPN league is private. Ask your commissioner to set 'Viewable to Public' or use the Desktop Extension.";

function espnViewQuery(week) {
  const params = new URLSearchParams();
  // mBoxscore populates schedule[].home/away.rosterForCurrentScoringPeriod — the weekly lineup.
  // mScoreboard/mRoster supply team records + fallback roster entries.
  ESPN_VIEWS.forEach((view) => {
    params.append('view', view);
  });
  params.set('scoringPeriodId', String(week));
  params.set('matchupPeriodId', String(week));
  return params.toString();
}

export function espnLeagueUrl({ season, leagueId, week }) {
  return `${ESPN_ORIGIN}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${espnViewQuery(week)}`;
}

function clientEspnUrl({ season, leagueId, week }) {
  if (import.meta.env.DEV) {
    return `/api/espn/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${espnViewQuery(week)}`;
  }
  const params = new URLSearchParams({
    leagueId: String(leagueId),
    season: String(season),
    week: String(week)
  });
  const path = `/api/espn?${params.toString()}`;
  return Capacitor.isNativePlatform() ? `${SITE_ORIGIN}${path}` : path;
}

function assertSeasonAndWeek(season, week) {
  const year = Number(season);
  const weekNumber = Number(week);
  if (!Number.isInteger(year) || year < 2018 || year > 2035) {
    throw new Error('Enter a season year like 2026.');
  }
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
    throw new Error('Enter an NFL week from 1 to 18.');
  }
  return { year, weekNumber };
}

function cleanCookieValue(value, name) {
  let text = String(value || '').trim().replace(new RegExp(`^${name}=`, 'i'), '').trim();
  text = text.replace(/^["']|["']$/g, '');
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // keep the pasted value
    }
  }
  return text;
}

export function espnSessionCookies(swid, espnS2) {
  const swidValue = cleanCookieValue(swid, 'SWID');
  const s2Value = cleanCookieValue(espnS2, 'espn_s2');
  if (!swidValue && !s2Value) return null;
  if (!swidValue || !s2Value) {
    throw new Error('Enter both SWID and espn_s2, or leave both blank.');
  }
  return { swid: swidValue, espnS2: s2Value };
}

export async function fetchEspnFanLeagues({ swid = '', espnS2 = '' } = {}) {
  let session = null;
  try {
    session = espnSessionCookies(swid, espnS2);
  } catch {
    return [];
  }
  if (!session) return [];
  const path = '/api/discover-espn';
  const url = import.meta.env.DEV || !Capacitor.isNativePlatform()
    ? path
    : `${SITE_ORIGIN}${path}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-SWID': encodeURIComponent(session.swid),
        'X-ESPN-S2': encodeURIComponent(session.espnS2)
      }
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const body = await response.json().catch(() => null);
  const leagues = Array.isArray(body?.leagues) ? body.leagues : [];
  return leagues
    .map((league) => ({
      id: String(league?.id || '').trim(),
      name: String(league?.name || '').trim()
    }))
    .filter((league) => /^\d+$/.test(league.id));
}

export function espnCookieHeader(swid, espnS2) {
  return `SWID=${swid}; espn_s2=${espnS2};`;
}

export async function fetchEspnLeague({ leagueId, season = 2026, week = 9, swid = '', espnS2 = '' }) {
  const id = String(leagueId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Enter an ESPN league ID.');
  const { year, weekNumber } = assertSeasonAndWeek(season, week);
  const session = espnSessionCookies(swid, espnS2);
  const url = clientEspnUrl({ season: year, leagueId: id, week: weekNumber });
  const headers = { Accept: 'application/json' };
  if (session) {
    headers['X-SWID'] = encodeURIComponent(session.swid);
    headers['X-ESPN-S2'] = encodeURIComponent(session.espnS2);
  }
  let response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new Error('Could not reach ESPN.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(session
      ? 'ESPN rejected that SWID and espn_s2. Copy both cookies again from espn.com.'
      : PRIVATE_LEAGUE_ERROR);
  }
  if (response.status === 404) throw new Error('League ID not found.');
  if (!response.ok) throw new Error(`ESPN request failed (${response.status}).`);
  const league = await response.json();
  if (!league || typeof league !== 'object' || !Array.isArray(league.teams)) {
    throw new Error('League ID not found.');
  }
  return league;
}

export function espnTeamName(team) {
  const location = String(team?.location || '').trim();
  const nickname = String(team?.nickname || '').trim();
  const combined = [location, nickname].filter(Boolean).join(' ');
  return combined || String(team?.name || '').trim() || team?.abbrev || `Team ${team?.id ?? ''}`.trim();
}

export function listEspnTeams(league) {
  return (league?.teams || [])
    .map((team) => ({ id: String(team.id), name: espnTeamName(team) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sideTeamId(side) {
  if (side == null) return null;
  if (typeof side === 'number' || typeof side === 'string') return String(side);
  if (side.teamId == null) return null;
  return String(side.teamId);
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function matchupGame(league, team, weekNumber) {
  const games = [
    ...(Array.isArray(team?.schedule) ? team.schedule : []),
    ...(Array.isArray(league?.schedule) ? league.schedule : [])
  ];
  const mine = String(team?.id ?? '');
  return games.find((entry) => entry && Number(entry.matchupPeriodId) === weekNumber && (
    sideTeamId(entry.home) === mine || sideTeamId(entry.away) === mine
  )) || null;
}

function opponentIdFor(league, team, weekNumber) {
  const game = matchupGame(league, team, weekNumber);
  if (!game) return null;
  const mine = String(team?.id ?? '');
  const home = sideTeamId(game.home);
  const away = sideTeamId(game.away);
  if (home === mine) return away;
  if (away === mine) return home;
  return null;
}

function sideWeeklyPoints(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
  const live = finiteNumber(side.totalPointsLive);
  if (live != null) return live;
  const total = finiteNumber(side.totalPoints);
  if (total != null) return total;
  return finiteNumber(side.rosterForCurrentScoringPeriod?.appliedStatTotal);
}

function sideWeeklyProjection(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
  return finiteNumber(side.totalProjectedPointsLive)
    ?? finiteNumber(side.totalProjectedPoints)
    ?? null;
}

function sumStarterActuals(starters) {
  return (starters || []).reduce((sum, player) => {
    const actual = finiteNumber(player?.actualPoints);
    if (actual != null) return sum + actual;
    if (player?.isLive) {
      const points = finiteNumber(player?.points);
      return sum + (points != null ? points : 0);
    }
    return sum;
  }, 0);
}

function sumStarterProjections(starters) {
  return (starters || []).reduce((sum, player) => {
    const proj = finiteNumber(player?.projPoints);
    if (proj != null) return sum + proj;
    return sum;
  }, 0);
}

function weeklyMatchupScore(game, teamId, starters) {
  const starterActuals = sumStarterActuals(starters);
  if (teamId == null || teamId === '') return starterActuals;
  const mine = String(teamId);
  const side = game && sideTeamId(game.home) === mine
    ? game.home
    : (game && sideTeamId(game.away) === mine ? game.away : null);
  const live = sideWeeklyPoints(side);
  // Prefer ESPN board totals when present; otherwise sum starter actuals only
  // (never season appliedStatTotal / projection placeholders).
  if (live != null && live !== 0) return live;
  if (starterActuals > 0) return starterActuals;
  return live ?? 0;
}

function weeklyMatchupProjection(game, teamId, starters) {
  const starterProj = sumStarterProjections(starters);
  if (teamId == null || teamId === '') return starterProj || null;
  const mine = String(teamId);
  const side = game && sideTeamId(game.home) === mine
    ? game.home
    : (game && sideTeamId(game.away) === mine ? game.away : null);
  const board = sideWeeklyProjection(side);
  if (board != null && board > 0) return board;
  return starterProj > 0 ? starterProj : (board ?? null);
}

function playerName(player, defense, nflTeam) {
  const full = String(player?.fullName || '').trim();
  if (full) return full;
  const joined = [player?.firstName, player?.lastName].filter(Boolean).join(' ').trim();
  if (joined) return defense ? `${joined} D/ST` : joined;
  if (defense) return `${nflTeam || 'Team'} D/ST`;
  return '';
}

function statTotal(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const raw = stat.appliedStatTotal != null ? stat.appliedStatTotal : stat.appliedTotal;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function findWeekStat(stats, weekNumber, sourceId) {
  const matches = (Array.isArray(stats) ? stats : []).filter((stat) => (
    stat
    && Number(stat.statSourceId) === sourceId
    && Number(stat.scoringPeriodId) === weekNumber
  ));
  return matches.find((stat) => Number(stat.statSplitTypeId) === 1) || matches[0] || null;
}

function bestWeekStatTotal(stats, weekNumber, sourceId) {
  const preferred = statTotal(findWeekStat(stats, weekNumber, sourceId));
  if (preferred != null && preferred > 0) return preferred;
  let best = preferred;
  (Array.isArray(stats) ? stats : []).forEach((stat) => {
    if (!stat || Number(stat.statSourceId) !== sourceId) return;
    if (Number(stat.scoringPeriodId) !== weekNumber) return;
    const total = statTotal(stat);
    if (total == null) return;
    if (best == null || (total > 0 && !(best > 0)) || total > best) best = total;
  });
  return best;
}

function statLineStarted(stat) {
  if (!stat) return false;
  const total = statTotal(stat);
  if (total != null && total > 0) return true;
  const raw = stat.stats;
  return Boolean(raw && typeof raw === 'object' && Object.keys(raw).length);
}

function espnNflTeam(player, pool) {
  const byId = PRO_TEAM_BY_ID[Number(player?.proTeamId)];
  if (byId) return byId;
  const poolTeam = PRO_TEAM_BY_ID[Number(pool?.proTeamId)];
  if (poolTeam) return poolTeam;
  const abbr = canonTeamCode(
    player?.proTeamAbbreviation
    || player?.proTeam
    || player?.team
    || pool?.proTeamAbbreviation
    || pool?.team
  );
  return abbr || '';
}

function espnScore(player, pool, weekNumber) {
  const actualStat = findWeekStat(player?.stats, weekNumber, 0);
  const actual = bestWeekStatTotal(player?.stats, weekNumber, 0);
  const projected = bestWeekStatTotal(player?.stats, weekNumber, 1);
  // pool.appliedStatTotal is often season-to-date on mRoster — never treat it as weekly proj/actual.
  const weeklyPool = finiteNumber(pool?.appliedStatTotal);
  const started = statLineStarted(actualStat);
  const actualPoints = started ? (actual ?? (weeklyPool != null && weeklyPool > 0 ? weeklyPool : 0)) : null;
  const projPoints = projected;
  const points = actualPoints != null ? actualPoints : (projPoints ?? 0);
  return {
    points,
    projPoints,
    actualPoints,
    isLive: Boolean(started && (actualPoints > 0 || statLineStarted(actualStat)))
  };
}

function starterFromEntry(entry, weekNumber) {
  if (!entry || typeof entry !== 'object') return null;
  const slotId = Number(entry.lineupSlotId);
  const isStarter = isActiveEspnSlot(slotId);
  const pool = entry.playerPoolEntry;
  const player = pool && typeof pool === 'object' ? pool.player : null;
  if (!player || typeof player !== 'object') return null;
  const positionId = Number(player.defaultPositionId);
  const slotLabel = SLOT_BY_ID[slotId] || '';
  const rawPosition = POSITION_BY_ID[positionId] || slotLabel || 'FLEX';
  const defense = rawPosition === 'D/ST' || slotId === 16 || positionId === 16;
  const slot = defense ? 'D/ST' : (slotLabel || rawPosition);
  const position = defense
    ? 'D/ST'
    : displayPlayerPosition({ position: POSITION_BY_ID[positionId] || rawPosition, slot });
  const nflTeam = espnNflTeam(player, pool);
  const name = playerName(player, defense, nflTeam);
  if (!name) return null;
  const score = espnScore(player, pool, weekNumber);
  const espnPlayerId = player.id ?? entry.playerId ?? pool?.id;
  return {
    name,
    espnPlayerId: espnPlayerId != null ? String(espnPlayerId) : undefined,
    slot,
    position,
    nflTeam,
    team: nflTeam,
    points: score.points,
    projPoints: score.projPoints,
    actualPoints: score.actualPoints,
    isLive: score.isLive,
    inRedZone: false,
    gameClock: `Week ${weekNumber}`,
    bigPlay: null,
    isStarter,
    lineupSlotId: Number.isFinite(slotId) ? slotId : null
  };
}

function rosterEntriesForTeam(league, team, weekNumber) {
  const game = matchupGame(league, team, weekNumber);
  const mine = String(team?.id ?? '');
  const side = game && sideTeamId(game.home) === mine
    ? game.home
    : (game && sideTeamId(game.away) === mine ? game.away : null);
  const weekly = side?.rosterForCurrentScoringPeriod?.entries;
  if (Array.isArray(weekly) && weekly.length) return weekly;
  if (Array.isArray(team?.roster?.entries)) return team.roster.entries;
  return [];
}

function playersFromEntries(entries, weekNumber, side) {
  return (entries || [])
    .map((entry) => starterFromEntry(entry, weekNumber))
    .filter(Boolean)
    .map((player) => ({
      ...player,
      ownership: side === 'mine' ? 1 : 0,
      isThreat: side !== 'mine'
    }));
}

function startersAndBench(league, team, weekNumber, side) {
  const entries = rosterEntriesForTeam(league, team, weekNumber);
  const all = playersFromEntries(entries, weekNumber, side);
  const realStarters = sortStartersBySlot(all.filter((player) => player.isStarter));
  const bench = all.filter((player) => !player.isStarter);
  if (realStarters.length) {
    return { starters: realStarters, bench, projected: false };
  }
  // Only invent a projected lineup when ESPN gave us roster rows with no active slots.
  const projected = sortStartersBySlot(activeOrProjected(all));
  return { starters: projected, bench, projected: projected.length > 0 };
}

function espnRosterPositions(league) {
  const slots = league?.settings?.rosterSettings?.lineupSlotCounts;
  if (!slots || typeof slots !== 'object') return [];
  return Object.entries(slots)
    .flatMap(([id, count]) => {
      const slotId = Number(id);
      const n = Number(count) || 0;
      if (!isActiveEspnSlot(slotId) || n <= 0) return [];
      const label = SLOT_BY_ID[slotId];
      if (!label) return [];
      return Array.from({ length: n }, () => label);
    })
    .sort((a, b) => {
      const rank = (slot) => {
        const order = ['QB', 'RB', 'RB/WR', 'WR', 'WR/TE', 'TE', 'FLEX', 'OP', 'DP', 'DT', 'DE', 'LB', 'DL', 'CB', 'S', 'DB', 'D/ST', 'K'];
        const index = order.indexOf(slot);
        return index >= 0 ? index : 99;
      };
      return rank(a) - rank(b);
    });
}

export function mapEspnLeague({ league, leagueId, teamId, week, season = 2026 }) {
  const { weekNumber } = assertSeasonAndWeek(season, week);
  const teams = league?.teams || [];
  const team = teams.find((entry) => String(entry.id) === String(teamId));
  if (!team) throw new Error('Select your team.');
  const game = matchupGame(league, team, weekNumber);
  const opponentKey = opponentIdFor(league, team, weekNumber);
  const opponent = opponentKey == null
    ? null
    : teams.find((entry) => String(entry.id) === String(opponentKey));
  const userTeamName = espnTeamName(team);
  const oppTeamName = opponent ? espnTeamName(opponent) : 'No matchup';
  const espnSide = (entry) => {
    const overall = entry?.record?.overall || {};
    const wins = Number(overall.wins);
    const losses = Number(overall.losses);
    if (!Number.isFinite(wins) || !Number.isFinite(losses)) return { record: null, rank: null };
    const rank = Number(entry.playoffSeed || entry.rankCalculatedFinal || entry.currentProjectedRank);
    return {
      record: { wins, losses, ties: Number(overall.ties) || 0 },
      rank: Number.isFinite(rank) && rank > 0 ? rank : null
    };
  };
  const mineStanding = espnSide(team);
  const oppStanding = espnSide(opponent);
  const mineLineup = startersAndBench(league, team, weekNumber, 'mine');
  const oppLineup = opponent
    ? startersAndBench(league, opponent, weekNumber, 'opp')
    : { starters: [], bench: [], projected: false };
  const mine = mineLineup.starters;
  const opp = oppLineup.starters;
  const id = String(leagueId || league?.id || '').trim();
  const myProj = weeklyMatchupProjection(game, team.id, mine);
  const oppProj = weeklyMatchupProjection(game, opponent?.id, opp);
  return {
    id: `espn-${id}`,
    espnLeagueId: id,
    espnTeamId: String(teamId),
    lineupWeek: weekNumber,
    lineupProjected: Boolean(mineLineup.projected || oppLineup.projected),
    rosterPositions: espnRosterPositions(league),
    name: String(league?.settings?.name || '').trim() || `ESPN ${id}`,
    platform: 'ESPN',
    season: String(season),
    myScore: weeklyMatchupScore(game, team.id, mine),
    oppScore: weeklyMatchupScore(game, opponent?.id, opp),
    myProj,
    oppProj,
    myProjected: myProj,
    oppProjected: oppProj,
    myTeamName: userTeamName,
    oppTeamName,
    opponent: oppTeamName,
    myRecord: mineStanding.record,
    oppRecord: oppStanding.record,
    myRank: mineStanding.rank,
    oppRank: oppStanding.rank,
    bench: mineLineup.bench,
    userTeam: { name: userTeamName, starters: mine, bench: mineLineup.bench },
    oppTeam: { name: oppTeamName, starters: opp, bench: oppLineup.bench },
    portfolio: mine,
    threats: opp
  };
}
