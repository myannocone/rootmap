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

function clientEspnUrl({ season, leagueId, week, forceRefresh = false }) {
  const bust = forceRefresh ? `&forceRefresh=1&_=${Date.now()}` : '';
  if (import.meta.env.DEV) {
    return `/api/espn/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${espnViewQuery(week)}${bust}`;
  }
  const params = new URLSearchParams({
    leagueId: String(leagueId),
    season: String(season),
    week: String(week)
  });
  if (forceRefresh) {
    params.set('forceRefresh', '1');
    params.set('_', String(Date.now()));
  }
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

export async function fetchEspnLeague({
  leagueId,
  season = 2026,
  week = 9,
  swid = '',
  espnS2 = '',
  forceRefresh = false
}) {
  const id = String(leagueId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Enter an ESPN league ID.');
  const { year, weekNumber } = assertSeasonAndWeek(season, week);
  const session = espnSessionCookies(swid, espnS2);
  const url = clientEspnUrl({ season: year, leagueId: id, week: weekNumber, forceRefresh });
  const headers = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache'
  };
  if (session) {
    headers['X-SWID'] = encodeURIComponent(session.swid);
    headers['X-ESPN-S2'] = encodeURIComponent(session.espnS2);
  }
  let response;
  try {
    response = await fetch(url, { headers, cache: 'no-store' });
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

function sideActualPoints(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
  // totalPointsLive is ESPN's live projection (points already scored plus remaining
  // projections). Using it as the team score counts unplayed statSourceId 1 lines.
  // totalPoints is the matchup actual when the request is scoped to scoringPeriodId.
  return finiteNumber(side.totalPoints);
}

function pointsByPeriod(team, weekNumber, field) {
  const map = team?.[field];
  if (!map || typeof map !== 'object') return null;
  return finiteNumber(map[weekNumber] ?? map[String(weekNumber)]);
}

function dedupeStarters(starters) {
  const seen = new Set();
  return (starters || []).filter((player) => {
    if (!player || player.isStarter === false) return false;
    const key = String(player.espnPlayerId || player.name || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boardIsInflated(board, starterSum, starters) {
  if (board == null || !(starterSum > 0)) return false;
  const count = (starters || []).length;
  if (count >= 6 && board > starterSum * 1.15 + 1) return true;
  return board > 400 && board > starterSum * 1.5;
}

function sideWeeklyProjection(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
  return finiteNumber(side.totalProjectedPointsLive)
    ?? finiteNumber(side.totalProjectedPoints)
    ?? null;
}

function sumStarterActuals(starters) {
  return (starters || []).reduce((sum, player) => {
    if (player?.unplayed === true || player?.hasActualLine === false) return sum;
    const actual = finiteNumber(player?.actualPoints);
    if (actual != null) return sum + actual;
    if (player?.isLive || player?.hasActualLine === true) {
      const points = finiteNumber(player?.points);
      const proj = finiteNumber(player?.projPoints ?? player?.projectedPoints);
      if (points != null && proj != null && points === proj) return sum;
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

function matchupSide(game, teamId) {
  if (teamId == null || teamId === '') return null;
  const mine = String(teamId);
  if (game && sideTeamId(game.home) === mine) return game.home;
  if (game && sideTeamId(game.away) === mine) return game.away;
  return null;
}

function weeklyMatchupScore(game, team, teamId, starters, weekNumber) {
  const unique = dedupeStarters(starters);
  const starterActuals = sumStarterActuals(unique);
  const anyActualLine = unique.some((player) => player?.hasActualLine === true);
  const weekPoints = pointsByPeriod(team, weekNumber, 'pointsByScoringPeriod');
  const side = matchupSide(game, teamId);
  const season = finiteNumber(team?.points);
  const period = sideActualPoints(side);
  const periodIsSeason = period != null && season != null && season > 0 && Math.abs(period - season) < 0.05;
  let board = weekPoints != null
    ? weekPoints
    : (period != null && !periodIsSeason ? period : null);
  // No statSourceId 0 lines yet — a non-zero team total here is a projection or season rollup.
  if (!anyActualLine && !(starterActuals > 0)) return 0;
  if (board != null && board > 400 && !(starterActuals > 0)) board = null;
  if (!(starterActuals > 0)) return 0;
  if (board == null || board === 0 || boardIsInflated(board, starterActuals, unique)) return starterActuals;
  return board;
}

function weeklyMatchupProjection(game, team, teamId, starters, weekNumber) {
  const unique = dedupeStarters(starters);
  const starterProj = sumStarterProjections(unique);
  const weekProj = pointsByPeriod(team, weekNumber, 'projectedPointsByScoringPeriod');
  const side = matchupSide(game, teamId);
  let board = weekProj != null ? weekProj : sideWeeklyProjection(side);
  if (board != null && board > 400 && !(starterProj > 0)) board = null;
  if (board != null && board > 0 && !boardIsInflated(board, starterProj, unique)) return board;
  if (starterProj > 0) return starterProj;
  return board ?? null;
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
  // appliedTotal is the fantasy-point line for this statSourceId + scoringPeriodId.
  // appliedStatTotal on a roster pool is often season-to-date, so it is only a fallback.
  const raw = stat.appliedTotal != null && stat.appliedTotal !== ''
    ? stat.appliedTotal
    : stat.appliedStatTotal;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function statsForEntry(player, entry) {
  const lists = [
    player?.stats,
    entry?.playerPoolEntry?.player?.stats,
    entry?.stats,
    entry?.playerPoolEntry?.stats
  ];
  const merged = [];
  const seen = new Set();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((stat) => {
      if (!stat || typeof stat !== 'object') return;
      const key = [
        stat.id,
        stat.externalId,
        stat.statSourceId,
        stat.scoringPeriodId,
        stat.statSplitTypeId,
        stat.appliedTotal
      ].join(':');
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(stat);
    });
  });
  return merged;
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
  const matches = (Array.isArray(stats) ? stats : []).filter((stat) => (
    stat
    && Number(stat.statSourceId) === sourceId
    && Number(stat.scoringPeriodId) === weekNumber
  ));
  // statSplitTypeId 1 is the scoring-period line. Never take the max across splits —
  // a second line is often a season or duplicated rollup.
  const preferred = statTotal(matches.find((stat) => Number(stat.statSplitTypeId) === 1));
  if (preferred != null) return preferred;
  const totals = matches.map((stat) => statTotal(stat)).filter((value) => value != null);
  if (!totals.length) return null;
  const positive = totals.filter((value) => value > 0);
  if (!positive.length) return 0;
  return Math.min(...positive);
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

function espnScore(stats, weekNumber) {
  const actualStat = findWeekStat(stats, weekNumber, 0);
  const actual = bestWeekStatTotal(stats, weekNumber, 0);
  const projected = bestWeekStatTotal(stats, weekNumber, 1);
  // statSourceId 0 for this scoringPeriodId is the only actual line.
  // A missing line, or a 0 with an empty box score, means the player has not played.
  // Never copy statSourceId 1 (projection) into actualPoints or points.
  const hasActualLine = statLineStarted(actualStat) || (actual != null && actual > 0);
  const actualPoints = hasActualLine ? (actual ?? 0) : 0;
  return {
    points: actualPoints,
    projPoints: projected,
    projectedPoints: projected,
    actualPoints,
    hasActualLine,
    unplayed: !hasActualLine,
    isLive: Boolean(hasActualLine && actualPoints > 0)
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
  const score = espnScore(statsForEntry(player, entry), weekNumber);
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
    projectedPoints: score.projectedPoints,
    actualPoints: score.actualPoints,
    hasActualLine: score.hasActualLine,
    unplayed: score.unplayed,
    scoringSource: 'espn',
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
  const rows = [];
  const seen = new Map();
  (entries || []).forEach((entry) => {
    const player = starterFromEntry(entry, weekNumber);
    if (!player) return;
    const tagged = {
      ...player,
      ownership: side === 'mine' ? 1 : 0,
      isThreat: side !== 'mine'
    };
    const key = String(player.espnPlayerId || player.name || '');
    if (!key || !seen.has(key)) {
      seen.set(key, rows.length);
      rows.push(tagged);
      return;
    }
    const index = seen.get(key);
    if (!rows[index].isStarter && tagged.isStarter) rows[index] = tagged;
  });
  return rows;
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
  const myProj = weeklyMatchupProjection(game, team, team.id, mine, weekNumber);
  const oppProj = weeklyMatchupProjection(game, opponent, opponent?.id, opp, weekNumber);
  return {
    id: `espn-${id}`,
    espnLeagueId: id,
    espnTeamId: String(teamId),
    scoringSource: 'espn',
    lineupWeek: weekNumber,
    lineupProjected: Boolean(mineLineup.projected || oppLineup.projected),
    rosterPositions: espnRosterPositions(league),
    name: String(league?.settings?.name || '').trim() || `ESPN ${id}`,
    platform: 'ESPN',
    season: String(season),
    myScore: weeklyMatchupScore(game, team, team.id, mine, weekNumber),
    oppScore: weeklyMatchupScore(game, opponent, opponent?.id, opp, weekNumber),
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
