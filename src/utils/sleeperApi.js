import { resolveNflTeam } from './leagueParser.js';
import { sortStartersBySlot } from './matchupLineup.js';
import { canonTeamCode, displayPlayerPosition, normalizePlayerMatchName } from './playerIdentity.js';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const PLAYERS_CACHE_KEY = 'sleeper_nfl_players';
const SLEEPER_SEASON = '2026';
const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI']);

let playerDirectoryCache = null;
let playerDirectoryPromise = null;

async function sleeperGet(path) {
  const response = await fetch(`${SLEEPER_BASE}${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Sleeper request failed (${response.status})`);
  return response.json();
}

export async function lookupSleeperUser(username) {
  const handle = String(username || '').trim();
  if (!handle) throw new Error('Enter a Sleeper username.');
  const user = await sleeperGet(`/user/${encodeURIComponent(handle)}`);
  if (!user?.user_id) throw new Error('No Sleeper user found for that username.');
  return user;
}

export async function fetchUserSleeperLeagues(userId, season = SLEEPER_SEASON) {
  const leagues = await sleeperGet(`/user/${userId}/leagues/nfl/${season}`);
  if (!Array.isArray(leagues)) return [];
  return leagues.map((league) => ({
    id: String(league.league_id),
    name: String(league.name || 'Sleeper League').trim() || 'Sleeper League',
    rosterPositions: league.roster_positions || [],
    scoringSettings: league.scoring_settings || null,
    status: league.status || ''
  }));
}

const POINT_KEYS = ['pts_ppr', 'pts_half_ppr', 'pts_std'];

export function sleeperScoringKey(settings) {
  const rec = Number(settings?.rec);
  if (!Number.isFinite(rec)) return 'pts_ppr';
  if (rec >= 1) return 'pts_ppr';
  if (rec >= 0.5) return 'pts_half_ppr';
  return 'pts_std';
}

function packPointLine(line) {
  if (!line || typeof line !== 'object') return null;
  const packed = {};
  POINT_KEYS.forEach((key) => {
    const value = Number(line[key]);
    if (Number.isFinite(value)) packed[key] = value;
  });
  return Object.keys(packed).length ? packed : null;
}

function pickPoint(packed, scoringKey) {
  if (!packed) return null;
  const value = packed[scoringKey] ?? packed.pts_ppr ?? packed.pts_half_ppr ?? packed.pts_std;
  return value == null ? null : Number(value);
}

const NON_PLAY_STAT_KEYS = new Set([
  'gms_active',
  'gp',
  'pos_rank_std',
  'pos_rank_ppr',
  'pos_rank_half_ppr',
  ...POINT_KEYS
]);

export function sleeperLineStarted(line) {
  if (!line || typeof line !== 'object') return false;
  const points = Number(line.pts_ppr ?? line.pts_std ?? line.pts_half_ppr);
  if (Number.isFinite(points) && points > 0) return true;
  return Object.entries(line).some(([key, value]) => (
    !NON_PLAY_STAT_KEYS.has(key) && Number(value) > 0
  ));
}

function normalizePlayerName(name) {
  return normalizePlayerMatchName(name);
}

function sleeperTeam(value) {
  return canonTeamCode(value) || String(value || '').trim().toUpperCase();
}

export function buildSleeperLiveIndex(stats, projections, players = {}, onlyIds = null) {
  const byId = {};
  const byName = {};
  const ids = Array.isArray(onlyIds)
    ? onlyIds.map(String)
    : Object.keys(stats || {});
  ids.forEach((id) => {
    const actual = packPointLine(stats?.[id]);
    const proj = packPointLine(projections?.[id]);
    if (!actual && !proj) return;
    const meta = players?.[id] || {};
    const record = {
      started: sleeperLineStarted(stats?.[id]),
      actual,
      proj,
      team: resolveNflTeam(meta.team) || sleeperTeam(meta.team)
    };
    byId[String(id)] = record;
    const name = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ');
    const key = normalizePlayerName(name);
    if (!key) return;
    const teamKey = record.team ? `${key}|${record.team}` : '';
    if (teamKey) byName[teamKey] = record;
    const existing = byName[key];
    if (!existing || (record.started && !existing.started)) byName[key] = record;
  });
  return { byId, byName };
}

export function sleeperScoreSignature(bundle) {
  return Object.keys(bundle?.byId || {}).sort().map((id) => {
    const row = bundle.byId[id];
    const actual = row?.actual || {};
    const proj = row?.proj || {};
    return [
      id,
      row?.started ? 1 : 0,
      actual.pts_ppr ?? '',
      actual.pts_half_ppr ?? '',
      actual.pts_std ?? '',
      proj.pts_ppr ?? '',
      proj.pts_half_ppr ?? '',
      proj.pts_std ?? ''
    ].join(':');
  }).join('|');
}

export async function fetchNflState() {
  const state = await sleeperGet('/state/nfl');
  const week = Number(state?.week);
  const season = String(state?.season || SLEEPER_SEASON);
  return {
    week: Number.isFinite(week) && week > 0 ? week : 9,
    season,
    seasonType: state?.season_type || 'regular'
  };
}

export async function fetchSleeperLiveScores({ season = SLEEPER_SEASON, week = 9, ids = null } = {}) {
  const weekNumber = Number(week);
  const onlyIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : null;
  if (onlyIds && !onlyIds.length) return { byId: {}, byName: {} };
  const [stats, projections, players] = await Promise.all([
    sleeperGet(`/stats/nfl/regular/${season}/${weekNumber}`).catch(() => ({})),
    sleeperGet(`/projections/nfl/regular/${season}/${weekNumber}`).catch(() => ({})),
    onlyIds ? Promise.resolve({}) : prefetchSleeperPlayers().catch(() => ({}))
  ]);
  return buildSleeperLiveIndex(stats || {}, projections || {}, players || {}, onlyIds);
}

export function sleeperLiveNumbers(player, bundle) {
  if (!player || !bundle) return null;
  const byId = player.sleeperId ? bundle.byId?.[String(player.sleeperId)] : null;
  const nameKey = normalizePlayerName(player.name);
  const team = resolveNflTeam(player.nflTeam || player.team) || sleeperTeam(player.nflTeam || player.team);
  // Prefer id, then name+team. Never fall back to bare name when the player already
  // has a team — that was assigning wrong NFL clubs (e.g. A.J. Brown → NE).
  const byName = team
    ? bundle.byName?.[`${nameKey}|${team}`]
    : bundle.byName?.[nameKey];
  const live = byId || byName;
  if (!live) return null;
  const key = player.scoringKey || 'pts_ppr';
  return {
    started: Boolean(live.started),
    actual: pickPoint(live.actual, key),
    proj: pickPoint(live.proj, key),
    team: resolveNflTeam(live.team) || sleeperTeam(live.team) || null
  };
}

export function prefetchSleeperPlayers() {
  if (playerDirectoryCache) return Promise.resolve(playerDirectoryCache);
  if (!playerDirectoryPromise) playerDirectoryPromise = loadSleeperPlayers();
  return playerDirectoryPromise;
}

async function loadSleeperPlayers() {
  if (playerDirectoryCache) return playerDirectoryCache;
  try {
    const cached = sessionStorage.getItem(PLAYERS_CACHE_KEY);
    if (cached) {
      playerDirectoryCache = JSON.parse(cached);
      return playerDirectoryCache;
    }
  } catch {
    // session cache is optional
  }

  const players = await sleeperGet('/players/nfl');
  playerDirectoryCache = players && typeof players === 'object' ? players : {};
  try {
    sessionStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(playerDirectoryCache));
  } catch {
    // the directory is large; memory cache still covers this session
  }
  return playerDirectoryCache;
}

export async function fetchSleeperMatchupBundle(leagueId, week) {
  const [rosters, users, matchups] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`),
    sleeperGet(`/league/${leagueId}/users`),
    sleeperGet(`/league/${leagueId}/matchups/${week}`)
  ]);
  return {
    rosters: Array.isArray(rosters) ? rosters : [],
    users: Array.isArray(users) ? users : [],
    matchups: Array.isArray(matchups) ? matchups : []
  };
}

function teamLabel(user, fallback = 'Sleeper Team') {
  const named = String(user?.metadata?.team_name || '').trim();
  if (named) return named;
  const display = String(user?.display_name || '').trim();
  if (display) return display;
  return fallback;
}

function userForRoster(users, roster) {
  const ownerId = roster?.owner_id;
  const direct = (users || []).find((entry) => entry.user_id === ownerId);
  if (direct) return direct;
  const coOwners = Array.isArray(roster?.co_owners) ? roster.co_owners.map(String) : [];
  return (users || []).find((entry) => coOwners.includes(String(entry.user_id))) || null;
}

function rosterForUser(rosters, userId) {
  const uid = String(userId || '');
  const owned = (rosters || []).find((entry) => String(entry.owner_id) === uid);
  if (owned) return owned;
  return (rosters || []).find((entry) => (
    Array.isArray(entry?.co_owners) && entry.co_owners.map(String).includes(uid)
  )) || null;
}

function startingSlots(rosterPositions) {
  return (rosterPositions || []).filter((slot) => !BENCH_SLOTS.has(String(slot || '').toUpperCase()));
}

export async function fetchSleeperLeague(leagueId) {
  const league = await sleeperGet(`/league/${leagueId}`);
  if (!league?.league_id) return null;
  return {
    id: String(league.league_id),
    name: String(league.name || 'Sleeper League').trim() || 'Sleeper League',
    rosterPositions: league.roster_positions || [],
    scoringSettings: league.scoring_settings || null,
    status: league.status || ''
  };
}

function isDefense(playerId, meta, slot) {
  const position = String(meta?.position || slot || '').toUpperCase();
  if (position === 'DEF' || position === 'DST' || position === 'D/ST') return true;
  return /^[A-Za-z]{2,3}$/.test(String(playerId || '')) && !meta?.full_name;
}

function matchupPlayerPoints(matchup, playerId, starterIndex, { allowStarterIndex = false } = {}) {
  const id = String(playerId);
  const fromPlayers = matchup?.players_points?.[id] ?? matchup?.players_points?.[playerId];
  if (fromPlayers != null && fromPlayers !== '') {
    const number = Number(fromPlayers);
    if (Number.isFinite(number)) return number;
  }
  if (!allowStarterIndex || !Number.isInteger(starterIndex) || starterIndex < 0) return null;
  const starterAtIndex = matchup?.starters?.[starterIndex];
  if (String(starterAtIndex) !== id) return null;
  const fromStarter = matchup?.starters_points?.[starterIndex];
  if (fromStarter == null || fromStarter === '') return null;
  const number = Number(fromStarter);
  return Number.isFinite(number) ? number : null;
}

function matchupHasLiveScore(matchup) {
  if (Number(matchup?.points) > 0) return true;
  return matchup?.custom_points != null && matchup.custom_points !== '' && Number(matchup.custom_points) !== 0;
}

function scoreForStarter(playerId, starterIndex, matchup, stats, projections, scoringKey, { starter = false } = {}) {
  const id = String(playerId);
  const statLine = stats?.[id];
  const genericActual = pickPoint(packPointLine(statLine), scoringKey);
  const projected = pickPoint(packPointLine(projections?.[id]), scoringKey);
  // players_points / starters_points are this matchup week in the league's scoring.
  // Generic pts_* is only a fallback, and only at the starter's original slot index.
  const matchupPoints = matchupPlayerPoints(matchup, playerId, starterIndex, { allowStarterIndex: starter });
  const started = sleeperLineStarted(statLine)
    || (matchupHasLiveScore(matchup) && Number.isFinite(matchupPoints) && matchupPoints > 0);
  const actualPoints = started
    ? (Number.isFinite(matchupPoints) ? matchupPoints : genericActual)
    : null;
  const points = actualPoints != null
    ? actualPoints
    : (Number.isFinite(projected) ? projected : 0);
  return {
    points: Number.isFinite(Number(points)) ? Number(points) : 0,
    projPoints: Number.isFinite(projected) ? projected : null,
    actualPoints: actualPoints != null && Number.isFinite(Number(actualPoints)) ? Number(actualPoints) : null,
    isLive: Boolean(started && actualPoints != null),
    scoringKey
  };
}

function starterFromId(playerId, slotHint, score, players) {
  if (playerId == null || playerId === '' || String(playerId) === '0') return null;
  const meta = players?.[playerId] || players?.[String(playerId)] || {};
  const defense = isDefense(playerId, meta, slotHint);
  const hinted = String(slotHint || '').trim();
  // Keep the roster slot label (FLEX, FLEX, LB, DL). Only invent D/ST when the slot is unknown.
  const slot = hinted || (defense ? 'D/ST' : (meta.position || 'FLEX'));
  const position = defense
    ? 'D/ST'
    : displayPlayerPosition({ position: meta.position || slot, slot });
  const teamRaw = meta.team || (defense ? String(playerId).toUpperCase() : '');
  const nflTeam = resolveNflTeam(teamRaw) || sleeperTeam(teamRaw) || '';
  const person = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim();
  const name = defense
    ? `${meta.last_name || meta.first_name || nflTeam || playerId} D/ST`
    : (person || `Player ${playerId}`);
  return {
    name,
    sleeperId: String(playerId),
    slot,
    position,
    nflTeam,
    team: nflTeam,
    points: score.points,
    projPoints: score.projPoints,
    actualPoints: score.actualPoints,
    isLive: score.isLive,
    scoringKey: score.scoringKey,
    inRedZone: false,
    gameClock: 'Scheduled',
    bigPlay: null,
    isStarter: true
  };
}

function realPlayerIds(ids) {
  return (ids || []).map((id) => String(id)).filter((id) => id && id !== '0');
}

function alignStarterSlots(ids, slots) {
  // Sleeper's starters array is index-aligned with starting roster_positions.
  // Empty slots are "0" and must stay in place so later players do not shift left.
  return (Array.isArray(ids) ? ids : []).map((id, index) => ({
    id: String(id ?? ''),
    slot: slots[index] || '',
    index
  })).filter((row) => row.id && row.id !== '0');
}

function lineupFromAligned(rows, matchup, players, stats, projections, scoringKey, isStarter) {
  return (rows || []).map((row) => {
    const player = starterFromId(
      row.id,
      row.slot,
      scoreForStarter(row.id, row.index, matchup, stats, projections, scoringKey, { starter: isStarter }),
      players
    );
    if (!player) return null;
    return {
      ...player,
      isStarter,
      lineupIndex: isStarter ? row.index : undefined
    };
  }).filter(Boolean);
}

function weekLineup(matchup, roster, slots, players, stats, projections, scoringKey) {
  // Prefer this week's matchup.starters (aligned with roster_positions).
  // Fall back to roster.starters only when the week matchup has not been posted yet.
  // Never invent a "best available" lineup from the full roster — that is what caused
  // bench studs to appear as starters in Matchups.
  const weekRows = alignStarterSlots(matchup?.starters, slots);
  const rosterRows = alignStarterSlots(roster?.starters, slots);
  const usingProjected = weekRows.length === 0 && rosterRows.length > 0;
  const rows = weekRows.length ? weekRows : rosterRows;
  const starters = sortStartersBySlot(
    lineupFromAligned(rows, matchup, players, stats, projections, scoringKey, true)
      .map((player) => ({ ...player, projectedStart: usingProjected, isStarter: true }))
  );
  const chosen = new Set(rows.map((row) => row.id));
  const benchIds = realPlayerIds(roster?.players).filter((id) => !chosen.has(id));
  const bench = lineupFromAligned(
    benchIds.map((id) => ({ id, slot: '', index: -1 })),
    matchup,
    players,
    stats,
    projections,
    scoringKey,
    false
  ).map((player) => ({ ...player, isStarter: false, lineupIndex: undefined }));
  return { players: starters, bench, projected: usingProjected };
}

function sumProj(players) {
  return (players || []).reduce((sum, player) => {
    const proj = Number(player?.projPoints);
    return sum + (Number.isFinite(proj) ? proj : 0);
  }, 0);
}

export function mapSleeperLeague({
  league,
  userId,
  week,
  rosters,
  users,
  matchups,
  players,
  weekStats = {},
  weekProjections = {}
}) {
  const roster = rosterForUser(rosters, userId);
  const user = userForRoster(users, roster) || (users || []).find((entry) => String(entry.user_id) === String(userId));
  const userTeamName = teamLabel(user, 'My Team');
  const slots = startingSlots(league?.rosterPositions || league?.roster_positions);
  const weekMatchup = roster
    ? (matchups || []).find((entry) => entry.roster_id === roster.roster_id)
    : null;
  const opponents = weekMatchup?.matchup_id == null
    ? []
    : (matchups || []).filter((entry) => (
      entry.matchup_id === weekMatchup.matchup_id && entry.roster_id !== roster.roster_id
    ));

  const scoringKey = sleeperScoringKey(league?.scoringSettings || league?.scoring_settings);
  const mineLineup = weekLineup(weekMatchup, roster, slots, players, weekStats, weekProjections, scoringKey);
  const mine = mineLineup.players.map((player) => ({
    ...player,
    ownership: 1,
    isThreat: false,
    gameClock: `Week ${week}`
  }));
  const mineBench = mineLineup.bench.map((player) => ({
    ...player,
    ownership: 1,
    isThreat: false,
    isStarter: false,
    gameClock: `Week ${week}`
  }));

  const oppStarters = [];
  const oppBench = [];
  const seen = new Set();
  let oppProjected = false;
  opponents.forEach((opponent) => {
    const oppRosterEntry = (rosters || []).find((entry) => entry.roster_id === opponent.roster_id);
    const oppLineup = weekLineup(opponent, oppRosterEntry, slots, players, weekStats, weekProjections, scoringKey);
    if (oppLineup.projected) oppProjected = true;
    oppLineup.players.forEach((player) => {
      if (seen.has(player.sleeperId)) return;
      seen.add(player.sleeperId);
      oppStarters.push({
        ...player,
        ownership: 0,
        isThreat: true,
        gameClock: `Week ${week}`
      });
    });
    oppLineup.bench.forEach((player) => {
      if (seen.has(player.sleeperId)) return;
      seen.add(player.sleeperId);
      oppBench.push({
        ...player,
        ownership: 0,
        isThreat: true,
        isStarter: false,
        gameClock: `Week ${week}`
      });
    });
  });

  const oppNames = opponents.map((opponent, index) => {
    const oppRoster = (rosters || []).find((entry) => entry.roster_id === opponent.roster_id);
    const oppUser = userForRoster(users, oppRoster);
    return teamLabel(oppUser, `Team ${oppRoster?.roster_id || index + 1}`);
  }).filter(Boolean);
  const oppTeamName = oppNames.length ? oppNames.join(' & ') : 'No matchup';
  const rankedRosters = [...(rosters || [])].sort((a, b) => {
    const aw = Number(a?.settings?.wins) || 0;
    const bw = Number(b?.settings?.wins) || 0;
    if (bw !== aw) return bw - aw;
    return (Number(b?.settings?.fpts) || 0) - (Number(a?.settings?.fpts) || 0);
  });
  const recordFor = (entry) => entry ? {
    wins: Number(entry.settings?.wins) || 0,
    losses: Number(entry.settings?.losses) || 0,
    ties: Number(entry.settings?.ties) || 0
  } : null;
  const rankFor = (entry) => {
    const index = rankedRosters.findIndex((item) => item.roster_id === entry?.roster_id);
    return index >= 0 ? index + 1 : null;
  };
  const oppRoster = opponents.length
    ? (rosters || []).find((entry) => entry.roster_id === opponents[0].roster_id)
    : null;
  const myProj = sumProj(mine);
  const oppProj = sumProj(oppStarters);
  const weekScore = (matchup, starters) => {
    const board = Number(matchup?.custom_points ?? matchup?.points);
    const starterActuals = (starters || []).reduce((sum, player) => {
      const actual = Number(player?.actualPoints);
      return sum + (Number.isFinite(actual) ? actual : 0);
    }, 0);
    if (Number.isFinite(board) && board > 0) return board;
    if (starterActuals > 0) return starterActuals;
    return Number.isFinite(board) ? board : 0;
  };

  return {
    id: `sleeper-${league.id}`,
    sleeperLeagueId: String(league.id),
    sleeperUserId: String(userId || ''),
    lineupWeek: Number(week),
    lineupProjected: Boolean(mineLineup.projected || oppProjected),
    rosterPositions: slots.length ? slots : (league.rosterPositions || league.roster_positions || []),
    scoringSettings: league.scoringSettings || league.scoring_settings || null,
    name: league.name,
    platform: 'Sleeper',
    season: SLEEPER_SEASON,
    myScore: weekScore(weekMatchup, mine),
    oppScore: (() => {
      if (!opponents.length) return 0;
      if (opponents.length === 1) return weekScore(opponents[0], oppStarters);
      const board = opponents.reduce((sum, opponent) => {
        const value = Number(opponent?.custom_points ?? opponent?.points);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      return board > 0 ? board : weekScore(null, oppStarters);
    })(),
    myProj,
    oppProj,
    myProjected: myProj,
    oppProjected: oppProj,
    myTeamName: userTeamName,
    oppTeamName,
    opponent: oppTeamName,
    myRecord: recordFor(roster),
    oppRecord: recordFor(oppRoster),
    myRank: rankFor(roster),
    oppRank: rankFor(oppRoster),
    bench: mineBench,
    userTeam: { name: userTeamName, starters: mine, bench: mineBench },
    oppTeam: { name: oppTeamName, starters: oppStarters, bench: oppBench },
    portfolio: mine,
    threats: oppStarters
  };
}

export async function syncSleeperLeagues({ userId, leagues, week }) {
  const selected = (leagues || []).filter(Boolean);
  if (!selected.length) throw new Error('Select at least one league.');
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
    throw new Error('Enter an NFL week from 1 to 18.');
  }
  const [players, weekStats, weekProjections] = await Promise.all([
    prefetchSleeperPlayers(),
    sleeperGet(`/stats/nfl/regular/${SLEEPER_SEASON}/${weekNumber}`).catch(() => ({})),
    sleeperGet(`/projections/nfl/regular/${SLEEPER_SEASON}/${weekNumber}`).catch(() => ({}))
  ]);
  const mapped = [];
  for (const league of selected) {
    const leagueId = league.id || league.sleeperLeagueId;
    const needsMeta = !league.rosterPositions?.length || !league.scoringSettings;
    const freshMeta = needsMeta ? await fetchSleeperLeague(leagueId).catch(() => null) : null;
    const resolved = {
      ...league,
      id: String(leagueId),
      name: freshMeta?.name || league.name,
      rosterPositions: league.rosterPositions?.length
        ? league.rosterPositions
        : (freshMeta?.rosterPositions || []),
      scoringSettings: league.scoringSettings || freshMeta?.scoringSettings || null
    };
    const bundle = await fetchSleeperMatchupBundle(resolved.id, weekNumber);
    mapped.push(mapSleeperLeague({
      league: resolved,
      userId,
      week: weekNumber,
      players,
      weekStats: weekStats || {},
      weekProjections: weekProjections || {},
      ...bundle
    }));
  }
  return mapped;
}
