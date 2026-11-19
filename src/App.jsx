import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import RootMapLogo from './components/Logo';
import { fetchLiveNFLSlate, gamePhase } from './services/espnScoreboard';
import { FALLBACK_NFL_WEEK, getActiveSlate, getSlateByWeek } from './data/nflSchedule';
import { isEspnMatchupText, parseEspnMatchupText, resolveNflTeam } from './utils/leagueParser';
import {
  displayPlayerPosition,
  normalizePlayerMatchName,
  playerMatchKey,
  playerPosTeamLabel,
  positionsCompatible,
  preferFiniteNumber,
  preferTeamCode
} from './utils/playerIdentity';
import {
  pairStartersBySlot,
  starterProjectedPoints,
  starterScoredPoints
} from './utils/matchupLineup';
import {
  backfillPlayerTeam,
  canonTeamCode,
  needsTeamBackfill,
  sleeperTeamIndexFrom
} from './utils/playerTeam';
import { cleanYahooPlayerName, parseYahooMatchupText } from './utils/yahooPaste';
import {
  fetchNflState,
  fetchSleeperLiveScores,
  fetchUserSleeperLeagues,
  lookupSleeperUser,
  prefetchSleeperPlayers,
  sleeperLiveNumbers,
  sleeperScoreSignature,
  syncSleeperLeagues
} from './utils/sleeperApi';
import { fetchEspnFanLeagues, fetchEspnLeague, listEspnTeams, mapEspnLeague } from './utils/espnDirectApi';
import { ESPN_LOGIN_URL, openNativeEspnLogin, readEspnSession, writeEspnSession } from './utils/espnLogin';
import { openYahooLogin } from './utils/openYahooLogin';
import {
  captureAllYahooLeagueMatchups,
  discoverYahooLeagues,
  fetchYahooMatchupCapture,
  isYahooMatchupHint,
  isYahooSessionExpired,
  leagueFromYahooCapture,
  readYahooSession,
  readYahooSessions,
  YAHOO_MATCHUP_HINT,
  writeYahooSession,
  YahooLogin
} from './utils/yahooNative';
import {
  canonicalLeagueIdentity,
  dedupeImportedLeagues,
  isGenericYahooLeagueName,
  preferYahooLeagueName,
  preferYahooLeagueOverTeam,
  syncYahooLeaguesFromApi,
  yahooLeagueIdOf
} from './utils/yahooSync';
import {
  FREE_ACTIVE_LEAGUE_LIMIT,
  activeLeagueCount,
  freeActiveBadge,
  loadIsPro,
  saveIsPro
} from './utils/proEntitlement';
import { SITE_ORIGIN } from './utils/siteOrigin';
import { Capacitor } from '@capacitor/core';
import {
  notifyCrossFire,
  notifyOutperformerAlert,
  notifyRedZoneAlert,
  notifyZeroProjectionAlerts,
  prepareCrossFireAlerts,
  prepareZeroProjectionAlerts,
  tapHaptic
} from './utils/nativeFeedback';
import { checkZeroProjectionStarters, starterProjectionStatus } from './utils/zeroProjection';
import {
  evaluateMatchupNailbiter,
  hydrateMatchupKickoffs,
  syncFinalSlateNailbiterNotifications
} from './utils/finalSlateNailbiter';
import { syncLineupLockNotifications } from './utils/lineupLockNotifications';
import { notificationSurfaceClass } from './utils/notificationFormatter';
import { readBannerHistory, subscribeInAppBanners } from './utils/inAppBanner';
import { decodeSetupJson, encodeSetupPayload, linkIsLocalOnly, phoneSyncOrigin, setupLinkFor } from './utils/setupSync';

const LEAGUES_STORAGE_KEY = 'rootmap_leagues';
const HIDDEN_LEAGUES_KEY = 'rootmap_hidden_leagues';
const TAB_TIP_KEY = 'rootmap_tab_tips_seen';
const THEME_STORAGE_KEY = 'rootmap_theme';
const TAB_TIPS = {
  matchups: 'RootMap shows who to root for and against across the leagues on your board.',
  'game-slate': 'Game Slate lines up this week’s NFL games with the players those leagues have in.',
  'all-leagues': 'Matchups is this week’s scoreboard for the leagues you left checked.'
};
const ALERT_PREFS_KEY = 'rootmap_gameday_alerts';
const DEFAULT_ALERT_PREFS = {
  lineupRescue: true,
  redZoneTv: true,
  fourthQuarterSweat: true,
  finalSlateNailbiter: true,
  lineupLock: true,
  spoilerFreeDelay: false
};
const REMAINING_STARTER_FALLBACK = 12.5;

const STALE_MOCK_LEAGUE_IDS = new Set(['lg_1', 'l1', 'l2', 'l3', 'l4']);
const STALE_MOCK_LEAGUE_NAMES = new Set([
  'family league',
  'high stakes 12-man',
  'high stakes 12 man',
  'work dynasty',
  'friends ppr'
]);
const MISSING_OPPONENT_NAME = 'Opponent';

const ROOTING_LEGEND = [
  { icon: '🟢', title: 'Root For', detail: 'Started only on your rosters.' },
  { icon: '🔥', title: 'Double Down (2X+ FOR)', detail: 'Started on 2+ of your rosters — multi-league leverage.' },
  { icon: '🚨', title: 'Double Down (2X+ AGAINST)', detail: 'Started by opponents in 2+ leagues — shared threat.' },
  { icon: '🔴', title: 'Root Against', detail: 'Started only by an opponent.' },
  { icon: '⚡', title: 'Cross Fire', detail: 'The same player is in your starters and an opponent’s starters.' },
  { icon: '🎯', title: 'Double Dip', detail: 'Offense vs Opponent DEF (Dual point swing on TDs).' },
  { icon: '⚠️', title: 'Friendly Fire', detail: 'Offense vs Your DEF (Offensive TD reduces defense points).' },
  { icon: '○', title: 'Neutral / Free Agent', detail: 'Not started by you or an opponent in the leagues on the board.' }
];

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

const OFFENSIVE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX']);

function firstPlayerList(...candidates) {
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) return list;
  }
  for (const list of candidates) {
    if (Array.isArray(list)) return list;
  }
  return [];
}

function listedStarters(list) {
  return (list || []).filter((player) => player && player.isStarter !== false);
}

function getLeaguePortfolio(lg) {
  return listedStarters(firstPlayerList(lg?.portfolio, lg?.starters, lg?.userTeam?.starters));
}

function getLeagueThreats(lg) {
  return listedStarters(firstPlayerList(lg?.threats, lg?.opponentStarters, lg?.oppTeam?.starters));
}

function yahooNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function looksLikeYahooTeamName(name, lg) {
  const key = yahooNameKey(name);
  if (!key) return false;
  const teamCandidates = [lg?.myTeamName, lg?.teamName, lg?.userTeam?.name];
  return teamCandidates.some((candidate) => {
    const teamKey = yahooNameKey(candidate);
    return teamKey && teamKey === key;
  });
}

function platformLeagueTitle(lg) {
  const candidates = [lg?.leagueName, lg?.name];
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (!name || isGenericYahooLeagueName(name)) continue;
    // Yahoo sync used to fall back to the team name ("YANNACONDA") as the league name.
    if (looksLikeYahooTeamName(name, lg)) continue;
    return name;
  }
  return '';
}

function getUserTeamName(lg) {
  const team = preferYahooLeagueName(lg?.myTeamName, lg?.userTeam?.name, lg?.teamName);
  if (team && !isGenericYahooLeagueName(team)) return team;
  return team || 'My Team';
}

function getLeagueDisplayName(lg) {
  const custom = String(lg?.customLeagueName || lg?.displayName || '').trim();
  if (custom) return custom;
  const title = platformLeagueTitle(lg);
  if (title) return title;
  // Never surface "Yahoo League · …" boilerplate — prefer the fantasy team nickname.
  const team = getUserTeamName(lg);
  if (team && team !== 'My Team') return team;
  return 'League';
}

function capInflatedWeeklyTotal(board, starterSum, starterCount) {
  if (!(starterSum > 0) || board == null) return null;
  const fullLineup = starterCount >= 6 && board > starterSum * 1.15 + 1;
  const seasonSized = board > 400 && board > starterSum * 1.5;
  if (fullLineup || seasonSized) return starterSum;
  return null;
}

function loadHiddenLeagueIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_LEAGUES_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function loadSeenTips() {
  try {
    const raw = JSON.parse(localStorage.getItem(TAB_TIP_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function sumActiveStarterPoints(starters) {
  // Only count real scored points — never projection placeholders sitting in `points`.
  return listedStarters(starters).reduce((sum, player) => sum + starterScoredPoints(player), 0);
}

function sumActiveStarterProjections(starters) {
  return listedStarters(starters).reduce((sum, player) => sum + starterProjectedPoints(player), 0);
}

function leagueSideScore(league, side = 'my') {
  const top = side === 'opp' ? league?.oppScore : league?.myScore;
  const parsed = finiteNumber(top);
  if (parsed != null && parsed !== 0) return parsed;
  const starters = side === 'opp' ? getLeagueThreats(league) : getLeaguePortfolio(league);
  const fromStarters = sumActiveStarterPoints(starters);
  if (fromStarters > 0) return fromStarters;
  return parsed ?? 0;
}

function leagueFilterLabel(lg, leagues = []) {
  const name = getLeagueDisplayName(lg);
  const duplicates = (leagues || []).filter((other) => getLeagueDisplayName(other) === name);
  if (duplicates.length <= 1) return name;
  const team = getUserTeamName(lg);
  if (team && team !== name) return `${name} · ${team}`;
  return name;
}

function platformMark(platform) {
  const value = String(platform || '').toLowerCase();
  if (value.includes('espn')) return 'E';
  if (value.includes('sleeper')) return 'S';
  if (value.includes('yahoo')) return 'Y';
  return '';
}

function platformLabel(platform) {
  const value = String(platform || '').toLowerCase();
  if (value.includes('espn')) return 'ESPN';
  if (value.includes('sleeper')) return 'Sleeper';
  if (value.includes('yahoo')) return 'Yahoo';
  const raw = String(platform || '').trim();
  return raw || 'League';
}

function PlatformBadge({ platform, isLight }) {
  const mark = platformMark(platform);
  if (!mark) return null;
  return (
    <span
      title={platformLabel(platform)}
      className={`inline-flex w-4 h-4 items-center justify-center rounded text-[8px] font-black shrink-0 ${
        isLight ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-600'
      }`}
    >
      {mark}
    </span>
  );
}

function PlatformPill({ platform, isLight }) {
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide border ${
        isLight ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-600'
      }`}
    >
      {platformLabel(platform)}
    </span>
  );
}

function ordinalRank(value) {
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 1) return '';
  const teen = rank % 100;
  if (teen >= 11 && teen <= 13) return `${rank}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][rank % 10] || 'th';
  return `${rank}${suffix}`;
}

function formatSeasonRecord(record) {
  if (!record) return '';
  if (typeof record === 'string') return record.trim();
  const wins = finiteNumber(record.wins ?? record.w);
  const losses = finiteNumber(record.losses ?? record.l);
  if (wins == null || losses == null) return '';
  if (record.ties == null && record.t == null) return `${wins}-${losses}`;
  const ties = finiteNumber(record.ties ?? record.t) ?? 0;
  return `${wins}-${losses}-${ties}`;
}

function teamSeasonDetail(record, rank) {
  return [formatSeasonRecord(record), ordinalRank(rank)].filter(Boolean).join(' • ');
}

function playerIsByeWeek(player) {
  return Boolean(
    player?.isBye
    || player?.gameStatus === 'BYE'
    || /\bbye\b/i.test(`${player?.gameClock || ''} ${player?.opponent || ''}`)
  );
}

function starterActualLabel(player) {
  if (playerIsByeWeek(player)) return '—';
  const actual = finiteNumber(player?.actualPoints);
  const liveOrFinal = starterIsLive(player) || starterIsFinal(player);
  // Yahoo often stores actualPoints: 0 pre-kickoff; only show a real line once live/final or non-zero.
  if (actual != null && (liveOrFinal || actual !== 0)) return scoreText(actual);
  const points = finiteNumber(player?.points);
  const proj = finiteNumber(player?.projPoints)
    ?? finiteNumber(player?.projected)
    ?? finiteNumber(player?.projectedPoints);
  // points often mirrors projection before kickoff — show proj so rows aren't empty dashes.
  if (points == null || points === 0 || (proj != null && points === proj)) {
    return proj != null ? scoreText(proj) : '—';
  }
  return scoreText(points);
}

function leagueSideRecord(league, side) {
  const team = side === 'opp' ? league?.oppTeam : league?.userTeam;
  const record = side === 'opp'
    ? (league?.oppRecord || team?.record)
    : (league?.myRecord || team?.record);
  const rank = side === 'opp'
    ? (league?.oppRank || team?.rank || team?.standing)
    : (league?.myRank || team?.rank || team?.standing);
  return { record, rank };
}

function starterIsFinal(player) {
  return player?.gameStatus === 'FINAL' || Boolean(player?.isFinal);
}

function starterIsLive(player) {
  return Boolean(player?.isLive || player?.gameStatus === 'IN_PROGRESS' || clockIsLive(player?.gameClock));
}

function starterRemainingProjected(player) {
  if (!player || starterIsFinal(player)) return 0;
  const actual = finiteNumber(player.actualPoints) ?? 0;
  const proj = finiteNumber(player.projPoints)
    ?? finiteNumber(player.projectedPoints)
    ?? finiteNumber(player.projected)
    ?? finiteNumber(player.points);
  if (starterIsLive(player)) {
    if (proj != null) return Math.max(0, proj - actual);
    return Math.max(0, REMAINING_STARTER_FALLBACK - actual);
  }
  if (proj != null) return Math.max(0, proj);
  return REMAINING_STARTER_FALLBACK;
}

function sideLiveProjection(starters, liveScore, leagueProj) {
  const list = listedStarters(starters);
  const live = finiteNumber(liveScore) ?? 0;
  if (list.length) {
    const remaining = list.reduce((sum, player) => sum + starterRemainingProjected(player), 0);
    return { live, remaining, projected: live + remaining };
  }
  const full = finiteNumber(leagueProj);
  if (full != null) {
    const remaining = Math.max(0, full - live);
    return { live, remaining, projected: live + remaining };
  }
  return { live, remaining: 0, projected: live };
}

function yahooWinOddsPair(league) {
  let mine = finiteNumber(league?.myWinOdds ?? league?.winOdds?.mine ?? league?.userTeam?.winOdds);
  let opp = finiteNumber(league?.oppWinOdds ?? league?.winOdds?.opp ?? league?.oppTeam?.winOdds);
  if (mine == null && opp == null) return null;
  // Yahoo API often returns 0–1; DOM scrapes may already be 0–100.
  if (mine != null && mine > 0 && mine <= 1) mine *= 100;
  if (opp != null && opp > 0 && opp <= 1) opp *= 100;
  if (mine == null && opp != null) mine = Math.max(0, 100 - opp);
  if (opp == null && mine != null) opp = Math.max(0, 100 - mine);
  if (mine == null || opp == null) return null;
  const myPct = Math.max(0, Math.min(100, Math.round(mine)));
  return { myPct, oppPct: Math.max(0, Math.min(100, 100 - myPct)) };
}

function matchupOutlook(league) {
  const myLive = leagueSideScore(league, 'my');
  const oppLive = leagueSideScore(league, 'opp');
  const mySide = sideLiveProjection(getLeaguePortfolio(league), myLive, league?.myProj ?? league?.myProjected);
  const oppSide = sideLiveProjection(getLeagueThreats(league), oppLive, league?.oppProj ?? league?.oppProjected);
  const myTotal = mySide.projected;
  const oppTotal = oppSide.projected;
  const yahooOdds = yahooWinOddsPair(league);
  const sum = myTotal + oppTotal;
  const myPct = yahooOdds?.myPct ?? (sum > 0 ? Math.round((myTotal / sum) * 100) : 50);
  const oppPct = yahooOdds?.oppPct ?? (100 - myPct);
  return {
    myLive,
    oppLive,
    myRem: mySide.remaining,
    oppRem: oppSide.remaining,
    myTotal,
    oppTotal,
    myPct,
    oppPct
  };
}

function lineupMatchupRows(mine, opp, rosterPositions = null) {
  return pairStartersBySlot(listedStarters(mine), listedStarters(opp), rosterPositions);
}

function getLeagueBench(league) {
  return firstPlayerList(league?.bench, league?.userTeam?.bench, league?.myBench)
    .filter((player) => player && player.isStarter === false);
}

function leagueDeepLink(league) {
  const platform = String(league?.platform || '').toLowerCase();
  if (platform.includes('espn')) {
    const leagueId = league?.espnLeagueId || league?.leagueId;
    const teamId = league?.espnTeamId || league?.teamId;
    if (!leagueId) return null;
    const query = new URLSearchParams({ leagueId: String(leagueId) });
    if (teamId) query.set('teamId', String(teamId));
    if (league?.season) query.set('seasonId', String(league.season));
    return { label: 'Open in ESPN ↗', href: `https://fantasy.espn.com/football/team?${query.toString()}` };
  }
  if (platform.includes('yahoo')) {
    const href = league?.yahooMatchupUrl
      || (league?.yahooLeagueId
        ? `https://football.fantasysports.yahoo.com/f1/${String(league.yahooLeagueId).replace(/^.*\.l\./, '')}`
        : 'https://football.fantasysports.yahoo.com/');
    return { label: 'Open in Yahoo ↗', href };
  }
  if (platform.includes('sleeper')) {
    const leagueId = league?.sleeperLeagueId || league?.leagueId;
    if (!leagueId) return { label: 'Open in Sleeper ↗', href: 'https://sleeper.com/' };
    return { label: 'Open in Sleeper ↗', href: `https://sleeper.com/leagues/${leagueId}` };
  }
  return null;
}

function loadAlertPrefs() {
  try {
    const raw = localStorage.getItem(ALERT_PREFS_KEY);
    if (!raw) return { ...DEFAULT_ALERT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ALERT_PREFS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_ALERT_PREFS };
  }
}

function NFLPrimary(team) {
  const key = canonTeam(team);
  return NFL_TEAM_PRIMARY[key] || '#334155';
}

function leagueHasLivePlayers(league, games) {
  const teams = new Set();
  [...getLeaguePortfolio(league), ...getLeagueThreats(league)].forEach((player) => {
    const team = canonTeam(player?.nflTeam);
    if (team) teams.add(team);
  });
  return (games || []).some((game) => {
    const live = game?.gameStatus === 'IN_PROGRESS' || /\bLIVE\b/i.test(`${game?.status || ''} ${game?.time || ''}`);
    if (!live) return false;
    return teams.has(canonTeam(game.home)) || teams.has(canonTeam(game.away));
  });
}

function MatchupLineups({ league, week, isLight }) {
  const [benchOpen, setBenchOpen] = useState(false);
  const mine = getLeaguePortfolio(league);
  const opp = getLeagueThreats(league);
  const rows = lineupMatchupRows(mine, opp, league?.rosterPositions);
  const bench = getLeagueBench(league);
  const projected = Boolean(league?.lineupProjected || mine.some((player) => player.projectedStart) || opp.some((player) => player.projectedStart));
  const deepLink = leagueDeepLink(league);
  const sideCell = (player, align) => (
    <div className={`min-w-0 flex-1 ${align === 'end' ? 'text-right' : 'text-left'}`}>
      {player ? (
        <>
          <div className={`truncate text-[11px] font-extrabold leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
            {player.name}
          </div>
          <div className={`truncate text-[9px] font-bold tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            {[knownTeam(player.nflTeam || player.team) || String(player.nflTeam || player.team || '').toUpperCase(), starterActualLabel(player)].filter(Boolean).join(' · ')}
          </div>
        </>
      ) : (
        <div className={`text-[10px] font-bold ${isLight ? 'text-slate-300' : 'text-slate-600'}`}>—</div>
      )}
    </div>
  );
  return (
    <div className={`space-y-2 border-t pt-2 ${isLight ? 'border-slate-100' : 'border-white/10'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          {projected ? `Projected Week ${week}` : `Week ${week} starters`}
        </div>
        {deepLink && (
          <a
            href={deepLink.href}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={`text-[10px] font-black whitespace-nowrap ${isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'}`}
          >
            {deepLink.label}
          </a>
        )}
      </div>
      {rows.length === 0 ? (
        <p className={`text-[10px] leading-snug ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
          No Week {week} starters saved
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[1fr_2.25rem_1fr] items-center gap-1.5 min-w-0">
              {sideCell(row.mine, 'start')}
              <div className={`text-center text-[9px] font-black tracking-wide ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                {row.slot}
              </div>
              {sideCell(row.opp, 'end')}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setBenchOpen((open) => !open);
        }}
        className={`w-full min-h-8 rounded-lg border text-[10px] font-black uppercase tracking-wider ${
          isLight ? 'border-slate-200 text-slate-600 bg-slate-50' : 'border-slate-700 text-slate-300 bg-slate-950/60'
        }`}
      >
        Bench {benchOpen ? '▴' : '▾'}
      </button>
      {benchOpen && (
        <div className={`rounded-xl border px-2.5 py-2 space-y-1 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/50'}`}>
          {bench.length === 0 ? (
            <p className={`text-[10px] font-semibold ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
              No bench players saved for this league.
            </p>
          ) : (
            bench.map((player, index) => (
              <div key={`${player.name}-${index}`} className="flex items-center justify-between gap-2 text-[11px]">
                <span className={`min-w-0 truncate font-bold ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
                  {player.name}
                </span>
                <span className={`shrink-0 font-black tabular-nums ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  {starterActualLabel(player)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LeagueScoreboard({ league, isLight, onRemove }) {
  const myName = getUserTeamName(league);
  const oppName = getLeagueOppName(league);
  const leagueName = getLeagueDisplayName(league);
  const myScore = leagueSideScore(league, 'my');
  const oppScore = leagueSideScore(league, 'opp');
  const mine = leagueSideRecord(league, 'my');
  const opp = leagueSideRecord(league, 'opp');
  const outlook = matchupOutlook(league);
  const scoreClass = (leading) => (
    leading
      ? isLight ? 'text-emerald-700' : 'text-emerald-300'
      : isLight ? 'text-slate-400' : 'text-slate-500'
  );
  const teamSide = (name, record, rank, score, projected, leading, align) => (
    <div className={`min-w-0 flex flex-col gap-0.5 ${align === 'end' ? 'items-end text-right' : 'items-start text-left'}`}>
      <div className={`w-full min-w-0 font-extrabold text-[13px] leading-tight truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
        {name}
      </div>
      {teamSeasonDetail(record, rank) ? (
        <div className={`w-full min-w-0 truncate text-[10px] font-bold leading-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          {teamSeasonDetail(record, rank)}
        </div>
      ) : null}
      <div className={`font-black text-3xl leading-none tabular-nums tracking-tight ${scoreClass(leading)}`}>
        {scoreText(score)}
      </div>
      <div className={`text-[10px] font-semibold tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
        Proj {scoreText(projected)}
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className={`min-w-0 text-[10px] font-black uppercase tracking-wider truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          {leagueName || 'This week'}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onRemove && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              aria-label={`Remove ${leagueName}`}
              title={`Remove ${leagueName}`}
              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                isLight ? 'text-rose-600 hover:bg-rose-50' : 'text-rose-300 hover:bg-rose-950/70'
              }`}
            >
              <TrashIcon />
            </button>
          )}
          <PlatformBadge platform={league?.platform} isLight={isLight} />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        {teamSide(myName, mine.record, mine.rank, myScore, outlook.myTotal, outlook.myTotal >= outlook.oppTotal, 'end')}
        <div className={`pt-6 text-[10px] font-black tracking-[0.2em] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>VS</div>
        {teamSide(oppName, opp.record, opp.rank, oppScore, outlook.oppTotal, outlook.oppTotal >= outlook.myTotal, 'start')}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] font-black tabular-nums">
          <span className={isLight ? 'text-emerald-700' : 'text-emerald-300'}>{outlook.myPct}%</span>
          <span className={`font-bold ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>Win odds</span>
          <span className={isLight ? 'text-rose-700' : 'text-rose-300'}>{outlook.oppPct}%</span>
        </div>
        <div className={`flex h-2 overflow-hidden rounded-full ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} aria-hidden="true">
          <div className="bg-emerald-500" style={{ width: `${outlook.myPct}%` }} />
          <div className="bg-rose-500" style={{ width: `${outlook.oppPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function getLeagueOppName(lg) {
  return lg?.oppTeamName || lg?.opponent || lg?.oppTeam?.name || MISSING_OPPONENT_NAME;
}

function scoreText(value) {
  const number = finiteNumber(value);
  if (number == null) return '—';
  const hundredths = number.toFixed(2);
  return hundredths.endsWith('0') ? number.toFixed(1) : hundredths;
}

function cleanListedPlayer(player) {
  if (!player || typeof player !== 'object') return player;
  const name = cleanYahooPlayerName(player.name);
  if (!name || name === player.name) return player;
  return { ...player, name };
}

function normalizeListedPlayer(player) {
  const cleaned = cleanListedPlayer(player);
  if (!cleaned || typeof cleaned !== 'object') return cleaned;
  const team = knownTeam(cleaned.nflTeam || cleaned.team);
  if (!team || (cleaned.nflTeam === team && cleaned.team === team)) return cleaned;
  return { ...cleaned, nflTeam: team, team };
}

function normalizeLeague(lg, index = 0) {
  if (!lg || typeof lg !== 'object') return null;
  const portfolio = getLeaguePortfolio(lg).map(normalizeListedPlayer);
  const threats = getLeagueThreats(lg).map(normalizeListedPlayer);
  const bench = getLeagueBench(lg).map(normalizeListedPlayer);
  const platform = lg.platform || 'Yahoo';
  const myTeamName = platformOf({ platform }).includes('yahoo')
    ? (preferYahooLeagueName(lg.myTeamName, lg.userTeam?.name) || 'My Team')
    : (lg.myTeamName || lg.userTeam?.name || 'My Team');
  const name = platformLeagueTitle({ ...lg, myTeamName }) || `League ${index + 1}`;
  const oppTeamName = getLeagueOppName(lg);
  const customLeagueName = String(lg.customLeagueName || '').trim();
  const displayName = customLeagueName || String(lg.displayName || '').trim();
  return {
    ...lg,
    id: lg.id || `lg_${Date.now()}_${index}`,
    name,
    leagueName: preferYahooLeagueName(lg.leagueName, name) || name,
    customLeagueName,
    displayName,
    myTeamName: isGenericYahooLeagueName(myTeamName) ? 'My Team' : myTeamName,
    teamName: preferYahooLeagueName(lg.teamName, myTeamName),
    oppTeamName,
    opponent: lg.opponent || oppTeamName,
    platform,
    season: lg.season || '2026',
    myScore: lg.myScore || 0,
    oppScore: lg.oppScore || 0,
    myProj: lg.myProj ?? lg.userTeam?.projectedScore ?? null,
    oppProj: lg.oppProj ?? lg.oppTeam?.projectedScore ?? null,
    myWinOdds: lg.myWinOdds ?? lg.userTeam?.winOdds ?? null,
    oppWinOdds: lg.oppWinOdds ?? lg.oppTeam?.winOdds ?? null,
    myLogo: lg.myLogo || lg.userTeam?.logo || '',
    oppLogo: lg.oppLogo || lg.oppTeam?.logo || '',
    rosterPositions: lg.rosterPositions || [],
    portfolio,
    threats,
    bench,
    starters: portfolio,
    opponentStarters: threats,
    userTeam: lg.userTeam
      ? { ...lg.userTeam, name: myTeamName, starters: portfolio, bench }
      : { name: myTeamName, starters: portfolio, bench }
  };
}

function yahooLeagueNameCandidate(league, teamName) {
  const probe = { ...league, myTeamName: teamName || league?.myTeamName, teamName };
  for (const candidate of [league?.leagueName, league?.name]) {
    const name = String(candidate || '').trim();
    if (!name || isGenericYahooLeagueName(name)) continue;
    if (looksLikeYahooTeamName(name, probe)) continue;
    return name;
  }
  return '';
}

function platformOf(league) {
  return String(league?.platform || '').toLowerCase();
}

function mergeSyncedLeague(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return normalizeLeague(incoming);
  const platform = platformOf(incoming) || platformOf(existing);
  if (platform.includes('yahoo')) {
    return mergeYahooSyncedLeague(existing, incoming);
  }
  // Sleeper / ESPN: trust the fresh weekly map — do not run Yahoo name heuristics.
  return normalizeLeague({
    ...existing,
    ...incoming,
    id: existing.id,
    platform: incoming.platform || existing.platform,
    name: incoming.name || existing.name,
    leagueName: incoming.leagueName || incoming.name || existing.leagueName || existing.name,
    myTeamName: incoming.myTeamName || existing.myTeamName,
    oppTeamName: incoming.oppTeamName || incoming.opponent || existing.oppTeamName,
    opponent: incoming.oppTeamName || incoming.opponent || existing.opponent,
    portfolio: incoming.portfolio || incoming.starters || existing.portfolio,
    threats: incoming.threats || incoming.opponentStarters || existing.threats,
    starters: incoming.starters || incoming.portfolio || existing.starters,
    opponentStarters: incoming.opponentStarters || incoming.threats || existing.opponentStarters,
    bench: incoming.bench || incoming.userTeam?.bench || existing.bench,
    rosterPositions: incoming.rosterPositions?.length ? incoming.rosterPositions : existing.rosterPositions,
    scoringSettings: incoming.scoringSettings || existing.scoringSettings,
    userTeam: incoming.userTeam || existing.userTeam,
    oppTeam: incoming.oppTeam || existing.oppTeam,
    myScore: incoming.myScore ?? existing.myScore,
    oppScore: incoming.oppScore ?? existing.oppScore,
    myProj: incoming.myProj ?? existing.myProj,
    oppProj: incoming.oppProj ?? existing.oppProj,
    myRecord: incoming.myRecord || existing.myRecord || null,
    oppRecord: incoming.oppRecord || existing.oppRecord || null,
    myRank: incoming.myRank ?? existing.myRank ?? null,
    oppRank: incoming.oppRank ?? existing.oppRank ?? null,
    lineupWeek: incoming.lineupWeek ?? existing.lineupWeek,
    lineupProjected: incoming.lineupProjected ?? existing.lineupProjected,
    customLeagueName: existing.customLeagueName || incoming.customLeagueName || '',
    displayName: existing.displayName || incoming.displayName || existing.customLeagueName || incoming.customLeagueName || ''
  });
}

function mergeYahooSyncedLeague(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return normalizeLeague(incoming);
  const teamName = preferYahooLeagueName(incoming.myTeamName, existing.myTeamName, incoming.teamName, existing.teamName);
  const name = yahooLeagueNameCandidate(incoming, teamName)
    || yahooLeagueNameCandidate(existing, teamName)
    || preferYahooLeagueName(incoming.leagueName, existing.leagueName, incoming.name, existing.name)
    || 'Yahoo League';
  const incomingOpp = preferYahooLeagueName(incoming.oppTeamName, incoming.opponent, incoming.oppTeam?.name);
  const existingOpp = preferYahooLeagueName(existing.oppTeamName, existing.opponent, existing.oppTeam?.name);
  const oppTeamName = (incomingOpp && incomingOpp !== teamName)
    ? incomingOpp
    : (existingOpp && existingOpp !== teamName ? existingOpp : (incomingOpp || existingOpp || ''));
  return normalizeLeague({
    ...existing,
    ...incoming,
    id: existing.id,
    name,
    leagueName: name,
    teamName,
    yahooLeagueId: existing.yahooLeagueId || incoming.yahooLeagueId || incoming.leagueKey,
    yahooTeamId: existing.yahooTeamId || incoming.yahooTeamId || incoming.teamKey,
    yahooMatchupUrl: incoming.yahooMatchupUrl || existing.yahooMatchupUrl,
    myTeamName: teamName,
    oppTeamName,
    opponent: oppTeamName,
    portfolio: incoming.portfolio || incoming.starters || existing.portfolio,
    threats: incoming.threats || incoming.opponentStarters || existing.threats,
    starters: incoming.starters || incoming.portfolio || existing.starters,
    opponentStarters: incoming.opponentStarters || incoming.threats || existing.opponentStarters,
    myScore: incoming.myScore ?? existing.myScore,
    oppScore: incoming.oppScore ?? existing.oppScore,
    myProj: incoming.myProj ?? existing.myProj,
    oppProj: incoming.oppProj ?? existing.oppProj,
    myWinOdds: incoming.myWinOdds ?? existing.myWinOdds,
    oppWinOdds: incoming.oppWinOdds ?? existing.oppWinOdds,
    myLogo: incoming.myLogo || existing.myLogo || '',
    oppLogo: incoming.oppLogo || existing.oppLogo || '',
    myRecord: incoming.myRecord || existing.myRecord || null,
    oppRecord: incoming.oppRecord || existing.oppRecord || null,
    userTeam: incoming.userTeam || existing.userTeam,
    oppTeam: incoming.oppTeam
      ? {
        ...incoming.oppTeam,
        name: oppTeamName || incoming.oppTeam.name,
        logo: incoming.oppLogo || incoming.oppTeam.logo || existing.oppLogo || ''
      }
      : existing.oppTeam,
    customLeagueName: existing.customLeagueName || incoming.customLeagueName || '',
    displayName: existing.displayName || incoming.displayName || existing.customLeagueName || incoming.customLeagueName || ''
  });
}

function leagueNameKey(lg) {
  return String(lg?.name || lg?.myTeamName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isStaleMockLeague(lg) {
  if (!lg || typeof lg !== 'object') return false;
  if (lg.mock === true || lg.sample === true || lg.isMock === true || lg.isSample === true) return true;
  if (STALE_MOCK_LEAGUE_IDS.has(String(lg.id || ''))) return true;
  return STALE_MOCK_LEAGUE_NAMES.has(leagueNameKey(lg));
}

function leaguesFromJson(raw) {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : null);
  if (!list) return null;
  return list
    .filter((lg) => !isStaleMockLeague(lg))
    .map((lg, i) => normalizeLeague(lg, i))
    .filter(Boolean);
}

function loadStoredLeagues() {
  try {
    const raw = localStorage.getItem(LEAGUES_STORAGE_KEY);
    if (!raw) return [];
    return dedupeImportedLeagues(leaguesFromJson(raw) || []);
  } catch {
    return [];
  }
}

function parseSetupCode(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const attempts = [text];
  try {
    attempts.push(atob(text.replace(/\s/g, '')));
  } catch {
    // plain JSON is the other accepted form
  }
  for (const attempt of attempts) {
    try {
      const leagues = leaguesFromJson(attempt);
      if (Array.isArray(leagues)) return leagues;
    } catch {
      // try the next encoding
    }
  }
  return null;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3 h-3" aria-hidden="true">
      <path fill="currentColor" d="M6.2 1.8h3.6l.4 1h2.6v1.3H3.2V2.8h2.6l.4-1zM4.1 5.2h7.8l-.55 8.1a1 1 0 0 1-1 .9H5.65a1 1 0 0 1-1-.9L4.1 5.2z" />
    </svg>
  );
}

function playerCardKey(name, nflTeam, position = '', slot = '') {
  const match = playerMatchKey(name, position, slot);
  const team = resolveNflTeam(nflTeam) || canonTeamCode(nflTeam);
  return team ? `${match}|${team}` : match;
}

function knownTeam(value) {
  return resolveNflTeam(value) || canonTeamCode(value) || '';
}

function resolvePlayerTeam(player, sleeperPlayers = null, teamIndex = null) {
  const filled = backfillPlayerTeam(player, sleeperPlayers, teamIndex);
  return knownTeam(filled?.nflTeam || filled?.team || player?.nflTeam || player?.team);
}

function buildPlayerMasterIndex(leagueList, games = [], defenseLeagues = null, liveScores = null, sleeperPlayers = null) {
  const map = new Map();
  const byName = new Map();
  const teamIndex = sleeperPlayers ? sleeperTeamIndexFrom(sleeperPlayers) : null;

  const registerName = (nameKey, item) => {
    const list = byName.get(nameKey) || [];
    if (!list.includes(item)) list.push(item);
    byName.set(nameKey, list);
  };

  const findExisting = (nameKey, team, position, slot) => {
    const candidates = byName.get(nameKey) || [];
    if (!candidates.length) return null;
    const compatible = candidates.filter((item) => (
      positionsCompatible(position, slot, item.position, item.slot)
    ));
    const pool = compatible.length ? compatible : candidates;
    if (team) {
      const exact = pool.find((item) => knownTeam(item.nflTeam) === team);
      if (exact) return exact;
      const blank = pool.find((item) => !knownTeam(item.nflTeam));
      if (blank) return blank;
      // Do not split on empty vs filled team; only keep separate when both have different teams.
      return null;
    }
    if (pool.length === 1) return pool[0];
    return pool.find((item) => knownTeam(item.nflTeam)) || pool[0];
  };

  const getOrCreate = (name, nflTeam, position, points = 0, isLive = false, inRedZone = false, gameClock = 'Scheduled', bigPlay = null, sourcePlayer = null) => {
    const slot = sourcePlayer?.slot || '';
    const team = resolvePlayerTeam(
      { name, nflTeam, team: nflTeam, position, slot },
      sleeperPlayers,
      teamIndex
    ) || knownTeam(nflTeam);
    const nameKey = normalizePlayerMatchName(name);
    const matchKey = playerMatchKey(name, position, slot);
    let item = findExisting(nameKey, team, position, slot);
    if (!item) {
      const key = playerCardKey(name, team, position, slot);
      item = {
        cardKey: key,
        matchKey,
        name,
        nflTeam: team || String(nflTeam || '').trim(),
        position: displayPlayerPosition({ position, slot }) || position,
        slot: slot || position || '',
        points,
        isLive,
        inRedZone,
        gameClock,
        bigPlay,
        myShares: 0,
        myLeagues: [],
        oppShares: 0,
        oppLeagues: []
      };
      map.set(key, item);
      registerName(nameKey, item);
    } else {
      registerName(nameKey, item);
      const mergedTeam = preferTeamCode(item.nflTeam, team || nflTeam);
      if (mergedTeam && knownTeam(mergedTeam) && knownTeam(mergedTeam) !== knownTeam(item.nflTeam)) {
        const oldKey = item.cardKey;
        item.nflTeam = knownTeam(mergedTeam);
        item.cardKey = playerCardKey(item.name, item.nflTeam, item.position, item.slot);
        if (oldKey !== item.cardKey) {
          map.delete(oldKey);
          map.set(item.cardKey, item);
        }
      } else if (mergedTeam && (needsTeamBackfill(item.nflTeam) || !knownTeam(item.nflTeam))) {
        item.nflTeam = knownTeam(mergedTeam) || mergedTeam;
      }
      const shownPos = displayPlayerPosition({ position, slot: slot || item.slot });
      if (shownPos && (!item.position || item.position === 'FLEX' || item.position === 'OP')) {
        item.position = shownPos;
      }
    }
    if (points || isLive) item.points = points;
    if (isLive) item.isLive = true;
    if (inRedZone) item.inRedZone = true;
    if (gameClock && gameClock !== 'Scheduled') item.gameClock = gameClock;
    if (bigPlay) item.bigPlay = bigPlay;
    return item;
  };

  const rememberScore = (item, player) => {
    item.projPoints = preferFiniteNumber(item.projPoints, player?.projPoints ?? player?.projected, { preferPositive: true });
    item.actualPoints = preferFiniteNumber(item.actualPoints, player?.actualPoints, { preferPositive: true });
    if (player?.sleeperId) item.sleeperId = String(player.sleeperId);
    if (player?.scoringKey) item.scoringKey = player.scoringKey;
    const team = resolvePlayerTeam(player, sleeperPlayers, teamIndex) || preferTeamCode(item.nflTeam, player?.nflTeam || player?.team);
    if (team && knownTeam(team) && knownTeam(team) !== knownTeam(item.nflTeam)) {
      const oldKey = item.cardKey;
      item.nflTeam = knownTeam(team);
      item.cardKey = playerCardKey(item.name, item.nflTeam, item.position, item.slot || player?.slot);
      if (oldKey !== item.cardKey) {
        map.delete(oldKey);
        map.set(item.cardKey, item);
      }
    } else if (team && (needsTeamBackfill(item.nflTeam) || !knownTeam(item.nflTeam))) {
      item.nflTeam = knownTeam(team) || team;
    }
  };

  (leagueList || []).forEach((lg) => {
    getLeaguePortfolio(lg).forEach((p) => {
      const item = getOrCreate(p.name, p.nflTeam || p.team, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay, p);
      item.myShares += 1;
      item.myLeagues.push({ league: getLeagueDisplayName(lg), opponent: getLeagueOppName(lg) });
      item.isStarter = true;
      item.ownership = p.ownership ?? 1.0;
      rememberScore(item, p);
    });
  });

  (leagueList || []).forEach((lg) => {
    getLeagueThreats(lg).forEach((p) => {
      const item = getOrCreate(p.name, p.nflTeam || p.team, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay, p);
      item.oppShares += 1;
      item.oppLeagues.push({ league: getLeagueDisplayName(lg), opponent: getLeagueOppName(lg) });
      item.isThreat = true;
      rememberScore(item, p);
    });
  });

  markExposureTags(map, defenseLeagues || leagueList, games);
  map.forEach((player) => applyLiveToPlayer(player, games, liveScores, new Date(), sleeperPlayers, teamIndex));
  return map;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clockIsLive(clock) {
  const text = String(clock || '');
  return /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(text) || /\bLIVE\b/i.test(text);
}

function gameForTeam(games, nflTeam) {
  const key = knownTeam(nflTeam) || canonTeam(nflTeam);
  if (!key) return null;
  return (games || []).find((game) => canonTeam(game.home) === key || canonTeam(game.away) === key) || null;
}

function etClock(kickoff) {
  const date = new Date(kickoff);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute)
  };
}

function formatEtKickoff(kickoff) {
  const et = etClock(kickoff);
  if (!et) return '';
  const hour24 = Math.floor(et.minutes / 60);
  const minute = et.minutes % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix} EST`;
}

function formatEtKickoffShort(kickoff) {
  return formatEtKickoff(kickoff).replace(/\s*EST$/i, '').trim();
}

function slateDividerLabel(player, window = null) {
  const slate = window || slateWindowFor(player);
  if (slate?.id === 'bye') return 'BYE WEEK';
  if (slate?.id === 'final') return 'FINAL';
  if (slate?.id === 'live') return 'LIVE';
  const time = formatEtKickoffShort(player?.kickoff);
  if (time) return time;
  return String(slate?.label || 'Slate').toUpperCase();
}

function playerTimeBadge(player) {
  if (player?.isBye || player?.gameStatus === 'BYE') return 'BYE';
  if (player?.gameStatus === 'FINAL') return 'FINAL';
  if (player?.isLive || player?.gameStatus === 'IN_PROGRESS') return 'LIVE';
  return formatEtKickoffShort(player?.kickoff);
}

function weekByeTeams() {
  return new Set((getActiveSlate().byes || []).map((team) => canonTeam(team)));
}

function playerIsBye(player, game) {
  const team = canonTeam(player?.nflTeam);
  const text = `${game?.status || ''} ${game?.time || ''}`;
  if (/\bbye\b/i.test(text)) return true;
  if (game) return false;
  if (team && weekByeTeams().has(team)) return true;
  return Boolean(team);
}

function kickoffMillis(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function slateWindowFor(player) {
  if (player?.isBye || player?.gameStatus === 'BYE' || /\bbye\b/i.test(`${player?.gameClock || ''} ${player?.opponent || ''}`)) {
    return { id: 'bye', label: 'Bye Week', rank: 8 };
  }
  if (player?.gameStatus === 'IN_PROGRESS' || player?.isLive) return { id: 'live', label: 'Live', rank: 0 };
  if (player?.gameStatus === 'FINAL') return { id: 'final', label: 'Final', rank: 7 };
  const et = etClock(player?.kickoff);
  const text = `${player?.gameClock || ''} ${player?.time || ''}`;
  if (!et) {
    if (/\bthu/i.test(text)) return { id: 'thursday', label: 'Thursday', rank: 1 };
    if (/\bfri/i.test(text)) return { id: 'friday', label: 'Friday', rank: 2 };
    if (/\bsat/i.test(text)) return { id: 'saturday', label: 'Saturday', rank: 2 };
    if (/9:30|morning/i.test(text)) return { id: 'morning', label: 'Sunday Morning', rank: 3 };
    if (/1:00/.test(text)) return { id: 'early', label: 'Sunday Early', rank: 4 };
    if (/4:(00|05|25)/.test(text)) return { id: 'afternoon', label: 'Sunday Afternoon', rank: 5 };
    if (/\bmon/i.test(text)) return { id: 'mnf', label: 'Monday Night', rank: 6 };
    if (/\bsun/i.test(text)) return { id: 'snf', label: 'Sunday Night', rank: 6 };
    return { id: 'bye', label: 'Bye Week', rank: 8 };
  }
  if (et.weekday === 'Thu') return { id: 'thursday', label: 'Thursday', rank: 1 };
  if (et.weekday === 'Fri') return { id: 'friday', label: 'Friday', rank: 2 };
  if (et.weekday === 'Sat') return { id: 'saturday', label: 'Saturday', rank: 2 };
  if (et.weekday === 'Sun' && et.minutes < 12 * 60) return { id: 'morning', label: 'Sunday Morning', rank: 3 };
  if (et.weekday === 'Sun' && et.minutes < 16 * 60) return { id: 'early', label: 'Sunday Early', rank: 4 };
  if (et.weekday === 'Sun' && et.minutes < 19 * 60) return { id: 'afternoon', label: 'Sunday Afternoon', rank: 5 };
  if (et.weekday === 'Sun') return { id: 'snf', label: 'Sunday Night', rank: 6 };
  if (et.weekday === 'Mon') return { id: 'mnf', label: 'Monday Night', rank: 6 };
  return { id: 'bye', label: 'Bye Week', rank: 8 };
}

function boardMetric(player, windowId) {
  if (windowId === 'early' || windowId === 'afternoon') {
    return (player.myShares || 0) + (player.oppShares || 0);
  }
  const upcoming = player.gameStatus !== 'IN_PROGRESS' && player.gameStatus !== 'FINAL' && !player.isLive;
  if (upcoming) return finiteNumber(player.projPoints) ?? finiteNumber(player.points) ?? 0;
  return finiteNumber(player.actualPoints) ?? finiteNumber(player.points) ?? finiteNumber(player.projPoints) ?? 0;
}

function playerPoints(player) {
  return finiteNumber(player?.actualPoints) ?? finiteNumber(player?.points) ?? 0;
}

function playerProj(player) {
  return finiteNumber(player?.projPoints) ?? finiteNumber(player?.points) ?? 0;
}

function boomDelta(player) {
  const actual = finiteNumber(player?.actualPoints);
  const proj = finiteNumber(player?.projPoints);
  if (actual == null || proj == null) return Number.NEGATIVE_INFINITY;
  return actual - proj;
}

function compareBoardPlayers(a, b, sortMode) {
  const aw = slateWindowFor(a);
  const bw = slateWindowFor(b);
  const sink = (window) => (window.id === 'bye' ? 2 : window.id === 'final' ? 1 : 0);
  if (sink(aw) !== sink(bw)) return sink(aw) - sink(bw);
  let diff = 0;
  if (sortMode === 'livePoints') diff = playerPoints(b) - playerPoints(a);
  else if (sortMode === 'boom') diff = boomDelta(b) - boomDelta(a);
  else if (sortMode === 'exposure') {
    diff = ((b.myShares || 0) + (b.oppShares || 0)) - ((a.myShares || 0) + (a.oppShares || 0));
  } else if (sortMode === 'projected') diff = playerProj(b) - playerProj(a);
  else {
    if (aw.rank !== bw.rank) return aw.rank - bw.rank;
    const kickoffDelta = kickoffMillis(a.kickoff) - kickoffMillis(b.kickoff);
    if (kickoffDelta) return kickoffDelta;
    diff = boardMetric(b, aw.id) - boardMetric(a, aw.id);
  }
  if (diff) return diff;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function isDoubleDownPlayer(player) {
  const exposure = classifyPlayerExposure(player);
  return exposure.kind === 'multiFor' || exposure.kind === 'multiAgainst';
}

function passesBoardFilters(player, filters) {
  if (filters?.hideFinal && (player?.gameStatus === 'FINAL')) return false;
  if (filters?.liveOnly && !(player?.isLive || player?.gameStatus === 'IN_PROGRESS')) return false;
  if (filters?.redZoneOnly && !player?.inRedZone) return false;
  if (filters?.outperformers && !(boomDelta(player) >= 4)) return false;
  if (filters?.conflicted && !((player?.myShares || 0) > 0 && (player?.oppShares || 0) > 0)) return false;
  if (filters?.doubleDown && !isDoubleDownPlayer(player)) return false;
  return true;
}

function playerUsesYahooNativePoints(player) {
  return Boolean(player?.yahooNative || player?.scoringSource === 'yahoo');
}

function applyLiveToPlayer(player, games, liveScores, now = new Date(), sleeperPlayers = null, teamIndex = null) {
  if (needsTeamBackfill(player?.nflTeam || player?.team)) {
    const filled = backfillPlayerTeam(player, sleeperPlayers, teamIndex);
    if (filled?.nflTeam) {
      player.nflTeam = filled.nflTeam;
      player.team = filled.nflTeam;
    }
  } else {
    const team = knownTeam(player?.nflTeam || player?.team);
    if (team) {
      player.nflTeam = team;
      player.team = team;
    }
  }

  const preserveYahooPoints = playerUsesYahooNativePoints(player);
  let live = sleeperLiveNumbers(player, liveScores);
  if (live?.team && needsTeamBackfill(player.nflTeam)) {
    player.nflTeam = knownTeam(live.team) || live.team;
    player.team = player.nflTeam;
  }

  const game = gameForTeam(games, player?.nflTeam);
  const bye = playerIsBye(player, game);
  player.isBye = bye;
  if (bye) {
    player.gameStatus = 'BYE';
    player.isLive = false;
    player.hasPossession = false;
    player.inRedZone = false;
    player.kickoff = null;
    player.gameDate = null;
    player.opponent = 'BYE';
    player.gameClock = 'Bye';
    live = sleeperLiveNumbers(player, liveScores) || live;
    // Yahoo leagues keep Yahoo projections; Sleeper pts_ppr is full-PPR and mismatches 0.5-PPR.
    if (!preserveYahooPoints && live?.proj != null) {
      player.projPoints = preferFiniteNumber(player.projPoints, live.proj, { preferPositive: true });
    }
    if (live?.team && (needsTeamBackfill(player.nflTeam) || !knownTeam(player.nflTeam))) {
      player.nflTeam = preferTeamCode(player.nflTeam, live.team) || knownTeam(live.team) || live.team;
      player.team = player.nflTeam;
    }
    return player;
  }
  const phase = game ? gamePhase(game, now) : 'UPCOMING';
  player.gameStatus = phase;
  player.isLive = phase === 'IN_PROGRESS';
  player.hasPossession = Boolean(
    phase === 'IN_PROGRESS' && game?.possession && knownTeam(player?.nflTeam) === canonTeam(game.possession)
  );
  player.inRedZone = Boolean(player.hasPossession && game?.isRedZone);
  if (game?.kickoff) player.kickoff = game.kickoff;
  if (game) {
    const clock = game.status || game.time;
    if (clock) player.gameClock = clock;
  }
  live = sleeperLiveNumbers(player, liveScores) || live;
  if (live?.team && (needsTeamBackfill(player.nflTeam) || !knownTeam(player.nflTeam))) {
    player.nflTeam = preferTeamCode(player.nflTeam, live.team) || knownTeam(live.team) || live.team;
    player.team = player.nflTeam;
  }
  if (!preserveYahooPoints && live?.proj != null) {
    player.projPoints = preferFiniteNumber(player.projPoints, live.proj, { preferPositive: true });
  }
  player.zeroProjection = Boolean(starterProjectionStatus(player, { games, liveScores, now })?.zero);
  if (preserveYahooPoints) {
    // Keep Yahoo player_points.total even when 0 (pre-kickoff / IDP). Never copy Sleeper pts_ppr.
    if (finiteNumber(player.actualPoints) != null) player.points = player.actualPoints;
    return player;
  }
  const storedActual = finiteNumber(player.actualPoints);
  const needsPublicLine = !player.sleeperId && (storedActual == null || storedActual === 0);
  if (live?.actual != null && live.started && phase !== 'UPCOMING' && (player.sleeperId || needsPublicLine)) {
    player.actualPoints = preferFiniteNumber(player.actualPoints, live.actual, { preferPositive: true });
    if (finiteNumber(player.actualPoints) != null) player.points = player.actualPoints;
  }
  return player;
}

function decorateStoredPlayer(player, games, liveScores, sleeperPlayers = null) {
  return applyLiveToPlayer({ ...(player || {}) }, games, liveScores, new Date(), sleeperPlayers);
}

function lookupMasterPlayerStats(player, masterIndex) {
  return findMasterCard(masterIndex, player);
}

function isYahooPlatformLeague(league) {
  if (!league) return false;
  if (league.yahooNative || league.scoringSource === 'yahoo' || league.yahooStatsOk) return true;
  const platform = String(league.platform || '').toLowerCase();
  if (platform.includes('yahoo')) return true;
  return Boolean(
    league.yahooLeagueId
    || league.leagueKey
    || String(league.id || '').startsWith('yahoo-')
  );
}

/** Enrich Matchups starters. Yahoo keeps native API points; Sleeper only when Yahoo stats are missing. */
function hydrateLeagueForMatchups(league, games, liveScores, sleeperPlayers = null, masterIndex = null) {
  if (!league) return league;
  const yahooLeague = isYahooPlatformLeague(league);
  const allowSleeperPoints = !yahooLeague || league.yahooStatsOk === false;
  const hydrateOne = (player) => {
    if (!player) return player;
    const hasYahooWeekStats = finiteNumber(player.projPoints) != null
      || finiteNumber(player.projected) != null
      || finiteNumber(player.actualPoints) != null;
    // Opp rows often arrive named but scoreless from the DOM scrape — allow public fill for those only.
    const allowSleeperForPlayer = allowSleeperPoints
      || (yahooLeague && player.yahooNative !== true && !hasYahooWeekStats);
    const copy = {
      ...player,
      yahooNative: Boolean(
        (player.yahooNative && hasYahooWeekStats)
        || (yahooLeague && !allowSleeperPoints && hasYahooWeekStats)
      ),
      scoringSource: (player.yahooNative && hasYahooWeekStats)
        ? 'yahoo'
        : (player.scoringSource || (yahooLeague && !allowSleeperForPlayer && hasYahooWeekStats ? 'yahoo' : player.scoringSource))
    };
    // Scrub cached projection-as-actual (pre-kickoff) left by the old Sleeper pts_ppr hydrate.
    if (yahooLeague && !allowSleeperForPlayer && !copy.yahooNative) {
      const proj = finiteNumber(copy.projPoints) ?? finiteNumber(copy.projected);
      const actual = finiteNumber(copy.actualPoints);
      const points = finiteNumber(copy.points);
      const game = gameForTeam(games, copy.nflTeam || copy.team);
      const phase = game ? gamePhase(game, new Date()) : 'UPCOMING';
      if (phase === 'UPCOMING' && proj != null && (actual === proj || points === proj || actual == null)) {
        copy.actualPoints = 0;
        copy.points = 0;
      }
    }
    const master = lookupMasterPlayerStats(copy, masterIndex);
    if (master) {
      if (allowSleeperForPlayer && !playerUsesYahooNativePoints(copy)) {
        const masterActual = finiteNumber(master.actualPoints) ?? finiteNumber(master.points);
        const localActual = finiteNumber(copy.actualPoints) ?? finiteNumber(copy.points);
        if ((localActual == null || localActual === 0) && masterActual != null && masterActual !== 0) {
          copy.actualPoints = master.actualPoints ?? masterActual;
          copy.points = masterActual;
        }
        const masterProj = finiteNumber(master.projPoints);
        const localProj = finiteNumber(copy.projPoints) ?? finiteNumber(copy.projected);
        if ((localProj == null || localProj === 0) && masterProj != null && masterProj !== 0) {
          copy.projPoints = masterProj;
          copy.projected = masterProj;
        }
      }
      if (!knownTeam(copy.nflTeam || copy.team) && knownTeam(master.nflTeam)) {
        copy.nflTeam = knownTeam(master.nflTeam);
        copy.team = copy.nflTeam;
      }
      if (allowSleeperForPlayer && master.sleeperId && !copy.sleeperId) copy.sleeperId = master.sleeperId;
      if (master.gameStatus) copy.gameStatus = master.gameStatus;
      if (master.isLive != null) copy.isLive = master.isLive;
      if (master.kickoff) copy.kickoff = master.kickoff;
    }
    return applyLiveToPlayer(copy, games, liveScores, new Date(), sleeperPlayers);
  };

  const portfolio = getLeaguePortfolio(league).map(hydrateOne);
  const threats = getLeagueThreats(league).map(hydrateOne);
  const bench = getLeagueBench(league).map(hydrateOne);
  const myStarterScore = sumActiveStarterPoints(portfolio);
  const oppStarterScore = sumActiveStarterPoints(threats);
  const myStarterProj = sumActiveStarterProjections(portfolio);
  const oppStarterProj = sumActiveStarterProjections(threats);
  const myScoreRaw = finiteNumber(league.myScore);
  const oppScoreRaw = finiteNumber(league.oppScore);
  const myProjRaw = finiteNumber(league.myProj ?? league.myProjected);
  const oppProjRaw = finiteNumber(league.oppProj ?? league.oppProjected);
  const cappedMyScore = capInflatedWeeklyTotal(myScoreRaw, myStarterScore, portfolio.length);
  const cappedOppScore = capInflatedWeeklyTotal(oppScoreRaw, oppStarterScore, threats.length);
  const cappedMyProj = capInflatedWeeklyTotal(myProjRaw, myStarterProj, portfolio.length);
  const cappedOppProj = capInflatedWeeklyTotal(oppProjRaw, oppStarterProj, threats.length);
  // Yahoo scoreboard totals win; do not re-sum from Sleeper-hydrated starter lines.
  const preferBoard = yahooLeague && !allowSleeperPoints;

  return {
    ...league,
    name: getLeagueDisplayName(league),
    leagueName: preferYahooLeagueName(league.leagueName, getLeagueDisplayName(league)),
    myTeamName: getUserTeamName(league),
    portfolio,
    threats,
    bench,
    starters: portfolio,
    opponentStarters: threats,
    userTeam: league.userTeam
      ? { ...league.userTeam, name: getUserTeamName(league), starters: portfolio, bench }
      : { name: getUserTeamName(league), starters: portfolio, bench },
    oppTeam: league.oppTeam
      ? { ...league.oppTeam, starters: threats }
      : league.oppTeam,
    myScore: cappedMyScore != null
      ? cappedMyScore
      : (preferBoard
        ? (myScoreRaw != null ? myScoreRaw : myStarterScore)
        : ((myScoreRaw != null && myScoreRaw !== 0) ? myScoreRaw : myStarterScore)),
    oppScore: cappedOppScore != null
      ? cappedOppScore
      : (preferBoard
        ? (oppScoreRaw != null ? oppScoreRaw : oppStarterScore)
        : ((oppScoreRaw != null && oppScoreRaw !== 0) ? oppScoreRaw : oppStarterScore)),
    myProj: cappedMyProj != null
      ? cappedMyProj
      : (preferBoard
        ? (myProjRaw != null ? myProjRaw : (myStarterProj || myProjRaw))
        : ((myProjRaw != null && myProjRaw !== 0) ? myProjRaw : (myStarterProj || myProjRaw))),
    oppProj: cappedOppProj != null
      ? cappedOppProj
      : (preferBoard
        ? (oppProjRaw != null ? oppProjRaw : (oppStarterProj || oppProjRaw))
        : ((oppProjRaw != null && oppProjRaw !== 0) ? oppProjRaw : (oppStarterProj || oppProjRaw))),
    myProjected: cappedMyProj != null
      ? cappedMyProj
      : (preferBoard
        ? (myProjRaw != null ? myProjRaw : (myStarterProj || myProjRaw))
        : ((myProjRaw != null && myProjRaw !== 0) ? myProjRaw : (myStarterProj || myProjRaw))),
    oppProjected: cappedOppProj != null
      ? cappedOppProj
      : (preferBoard
        ? (oppProjRaw != null ? oppProjRaw : (oppStarterProj || oppProjRaw))
        : ((oppProjRaw != null && oppProjRaw !== 0) ? oppProjRaw : (oppStarterProj || oppProjRaw))),
    myWinOdds: league.myWinOdds ?? league.userTeam?.winOdds ?? null,
    oppWinOdds: league.oppWinOdds ?? league.oppTeam?.winOdds ?? null,
    myLogo: league.myLogo || league.userTeam?.logo || '',
    oppLogo: league.oppLogo || league.oppTeam?.logo || ''
  };
}

function liveScoreView(player) {
  const actual = finiteNumber(player?.actualPoints);
  const stored = finiteNumber(player?.points);
  const explicitProj = finiteNumber(player?.projPoints)
    ?? finiteNumber(player?.projectedPoints)
    ?? finiteNumber(player?.projected);
  const bye = Boolean(player?.isBye || player?.gameStatus === 'BYE');
  const live = !bye && (player?.gameStatus === 'IN_PROGRESS' || Boolean(player?.isLive) || clockIsLive(player?.gameClock));
  const finalGame = !bye && player?.gameStatus === 'FINAL';
  const scheduled = !bye && !live && !finalGame;
  const proj = explicitProj != null
    ? explicitProj
    : (actual == null && stored != null && stored !== 0 ? stored : null);
  // Non-zero Yahoo actuals win even when slate status still lags as "Scheduled".
  const hasActual = actual != null && (live || finalGame || actual !== 0);
  const pregameValue = proj != null ? proj : (stored != null && stored !== 0 ? stored : null);
  const unknownProj = scheduled && pregameValue == null && !hasActual;
  const shown = hasActual ? actual : (live ? 0 : (pregameValue ?? 0));
  const delta = hasActual && proj != null ? actual - proj : null;
  return {
    live,
    bye,
    final: finalGame,
    shown,
    proj,
    delta,
    unknownProj,
    awaiting: live && !hasActual,
    showProj: Boolean((live || finalGame || hasActual) && proj != null && (live || finalGame || hasActual))
  };
}

/** Live games only — never final, historical, or pre-game stubs. */
function playerEligibleForLiveAlert(player) {
  if (!player) return false;
  const status = String(player.gameStatus || '').toUpperCase();
  if (status === 'FINAL' || player.isFinal || status === 'BYE' || status === 'SCHEDULED' || status === 'UPCOMING' || status === 'PREGAME') {
    return false;
  }
  const live = Boolean(player.isLive || status === 'IN_PROGRESS' || clockIsLive(player.gameClock));
  if (!live) return false;
  const actual = finiteNumber(player.actualPoints) ?? finiteNumber(player.points);
  return actual != null && actual > 0;
}

function LivePulse({ size = 6, tone = 'for' }) {
  const px = `${size}px`;
  const ping = tone === 'against' ? 'bg-rose-400' : 'bg-emerald-400';
  const solid = tone === 'against' ? 'bg-rose-500' : 'bg-emerald-500';
  return (
    <span className="relative inline-flex shrink-0" style={{ width: px, height: px }} aria-hidden="true">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${ping}`} />
      <span className={`relative inline-flex h-full w-full rounded-full ${solid}`} />
    </span>
  );
}

function CrossFireMeter({ player, isLight }) {
  const mine = player?.myShares || 0;
  const opp = player?.oppShares || 0;
  if (!(mine > 0 && opp > 0)) return null;
  const net = mine - opp;
  const bias = net > 0 ? `+${net} Net Share` : net < 0 ? `${net} Net Share` : 'Neutral Impact';
  const biasColor = net > 0
    ? (isLight ? 'text-emerald-700' : 'text-emerald-300')
    : net < 0
      ? (isLight ? 'text-rose-700' : 'text-rose-300')
      : (isLight ? 'text-slate-500' : 'text-slate-400');
  return (
    <div className="space-y-1">
      <div className={`flex w-full max-w-full flex-wrap items-stretch overflow-hidden rounded-full border text-[9px] font-black leading-tight ${
        isLight ? 'border-slate-200' : 'border-slate-600'
      }`}>
        <span className={`px-1.5 py-1 ${isLight ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-950 text-emerald-300'}`}>
          🟢 {mine} {mine === 1 ? 'Start' : 'Starts'}
        </span>
        <span className={`px-1 py-1 ${isLight ? 'bg-white text-slate-300' : 'bg-slate-900 text-slate-600'}`}>|</span>
        <span className={`px-1.5 py-1 ${isLight ? 'bg-rose-100 text-rose-800' : 'bg-rose-950 text-rose-300'}`}>
          🔴 {opp} {opp === 1 ? 'Opponent' : 'Opponents'}
        </span>
      </div>
      <div className={`text-[9px] font-black uppercase tracking-wide ${biasColor}`}>{bias}</div>
    </div>
  );
}

function LivePoints({ player, isLight, tone = 'for', layout = 'inline', onScoreJump = null }) {
  const view = liveScoreView(player);
  const [scorePop, setScorePop] = useState(false);
  const [floatDelta, setFloatDelta] = useState(null);
  const previousShown = useRef(null);
  useEffect(() => {
    const shown = view.shown;
    if (previousShown.current != null && Math.abs(shown - previousShown.current) > 0.05) {
      const jumped = shown - previousShown.current;
      setScorePop(true);
      if (jumped > 0.05) {
        setFloatDelta(jumped);
        onScoreJump?.(jumped);
      } else {
        onScoreJump?.(jumped);
      }
      const timer = window.setTimeout(() => {
        setScorePop(false);
        setFloatDelta(null);
      }, 900);
      previousShown.current = shown;
      return () => window.clearTimeout(timer);
    }
    previousShown.current = shown;
  }, [view.shown, onScoreJump]);
  const color = view.live
    ? (isLight ? 'text-slate-950' : 'text-white')
    : tone === 'against'
      ? (isLight ? 'text-red-600' : 'text-rose-400')
      : tone === 'cross'
        ? 'text-violet-500'
        : (isLight ? 'text-green-600' : 'text-emerald-400');
  const deltaText = view.delta == null
    ? ''
    : `${view.delta > 0 ? '+' : ''}${view.delta.toFixed(1)}`;
  const deltaColor = view.delta == null
    ? ''
    : view.delta > 0
      ? (isLight ? 'text-green-600' : 'text-emerald-300')
      : view.delta < 0
        ? (isLight ? 'text-red-600' : 'text-rose-300')
        : (isLight ? 'text-slate-500' : 'text-slate-400');
  const muted = isLight ? 'text-slate-500' : 'text-slate-400';
  const floatNode = floatDelta != null && floatDelta > 0 ? (
    <span className={`absolute -top-3 right-0 rootmap-float-delta text-[10px] font-black tabular-nums ${
      isLight ? 'text-emerald-600' : 'text-emerald-300'
    }`}>
      +{floatDelta.toFixed(1)}
    </span>
  ) : null;
  if (layout === 'compact') {
    const preGame = !view.live && !view.final && !view.bye;
    const scoreLabel = view.bye ? 'BYE' : (view.live || view.final) ? 'PTS' : 'PROJ';
    const mainShown = preGame && view.proj != null ? view.proj : view.shown;
    const showDash = Boolean(view.bye || view.unknownProj || (preGame && view.proj == null && !(mainShown > 0)));
    const projLine = (view.live || view.final) && view.proj != null
      ? (deltaText ? `Proj ${view.proj.toFixed(1)} (${deltaText})` : `Proj ${view.proj.toFixed(1)}`)
      : null;
    return (
      <div className="relative text-right shrink-0 leading-none min-w-0">
        {floatNode}
        <div className={`font-black tabular-nums text-[15px] tracking-tight ${color} ${scorePop ? 'rootmap-score-pop' : ''}`}>
          {showDash ? '—' : mainShown.toFixed(1)}
          <span className={`ml-0.5 text-[9px] font-black uppercase ${muted}`}>{scoreLabel}</span>
        </div>
        {projLine && (
          <div className={`mt-0.5 text-[10px] font-semibold tabular-nums leading-tight ${muted}`}>
            {projLine}
          </div>
        )}
      </div>
    );
  }
  if (layout === 'hero') {
    const scoreLabel = view.bye ? 'Bye' : view.live ? 'Live pts' : view.final ? 'Final pts' : 'Pts';
    return (
      <div className="relative mt-1.5">
        {floatNode}
        <div className="flex items-baseline gap-1.5">
          {view.live && <LivePulse size={8} />}
          <span className={`text-[1.7rem] font-black tabular-nums leading-none tracking-tight ${color} ${scorePop ? 'rootmap-score-pop' : ''}`}>
            {view.bye ? '—' : view.shown.toFixed(1)}
          </span>
          <span className={`text-[10px] font-black uppercase tracking-wide ${view.live ? (isLight ? 'text-emerald-700' : 'text-emerald-300') : muted}`}>
            {scoreLabel}
          </span>
        </div>
        {view.showProj && (
          <div className={`mt-0.5 text-[11px] font-semibold tabular-nums leading-tight ${muted}`}>
            {deltaText && <span className={`font-black ${deltaColor}`}>{deltaText}</span>}
            {deltaText ? ' vs ' : ''}
            Proj {view.proj.toFixed(1)}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`relative text-right shrink-0 max-w-[9.5rem] leading-tight ${view.live ? (isLight ? 'text-green-600' : 'text-emerald-400') : color}`}>
      {floatNode}
      <span className="inline-flex items-center justify-end gap-1 font-mono font-black text-xs">
        {view.live && <LivePulse />}
        <span className={scorePop ? 'rootmap-score-pop' : ''}>
          {view.bye ? '— BYE' : `${view.shown.toFixed(1)} pts`}
        </span>
        {!view.bye && deltaText && <span className={`text-[9px] font-black ${deltaColor}`}>{deltaText}</span>}
      </span>
      {view.showProj && (
        <span className={`block font-semibold text-[9px] ${muted}`}>
          {view.awaiting ? `Proj ${view.proj.toFixed(1)}` : `(Proj: ${view.proj.toFixed(1)})`}
        </span>
      )}
    </div>
  );
}

function rosterCardSurface(isLight, isLive, isConflict, isHovered, inRedZone, zeroProj, side = 'for', isDoubleDown = false) {
  if (zeroProj && !isLive) {
    return isLight
      ? 'border border-rose-500 bg-amber-50 ring-2 ring-inset ring-amber-400 shadow-sm'
      : 'border border-rose-400 bg-rose-950/40 ring-2 ring-inset ring-amber-400 shadow-sm';
  }
  const zone = inRedZone ? 'rootmap-redzone' : '';
  if (isConflict) {
    const pulse = inRedZone ? zone : 'rootmap-crossfire';
    if (isLive) {
      return isLight
        ? `${pulse} border border-violet-600 bg-violet-50 ring-2 ring-inset ring-violet-500 ${isHovered ? 'shadow-md' : 'shadow-sm'}`
        : `${pulse} border border-violet-300 bg-violet-950/50 ring-2 ring-inset ring-violet-300 ${isHovered ? 'shadow-md' : 'shadow-sm'}`;
    }
    return isLight
      ? `${pulse} border border-violet-500 bg-violet-50 ring-2 ring-violet-400 ${isHovered ? 'shadow-md' : 'shadow-sm'}`
      : `${pulse} border border-violet-400 bg-violet-950/40 ring-2 ring-violet-400 ${isHovered ? 'shadow-md' : 'shadow-sm'}`;
  }
  if (isDoubleDown && side === 'against') {
    return isLight
      ? `${zone} border-2 border-rose-500 bg-rose-100/90 shadow-[0_0_14px_rgba(244,63,94,0.25)] ${isHovered ? 'shadow-md' : ''}`
      : `${zone} border-2 border-rose-400 bg-rose-950/55 shadow-[0_0_14px_rgba(244,63,94,0.25)] ${isHovered ? 'shadow-md' : ''}`;
  }
  if (isDoubleDown) {
    return isLight
      ? `${zone} border-2 border-emerald-500 bg-emerald-100/90 shadow-[0_0_14px_rgba(16,185,129,0.25)] ${isHovered ? 'shadow-md' : ''}`
      : `${zone} border-2 border-emerald-400 bg-emerald-950/55 shadow-[0_0_14px_rgba(16,185,129,0.25)] ${isHovered ? 'shadow-md' : ''}`;
  }
  if (side === 'against') {
    return isLight
      ? `${zone} border border-rose-400/70 bg-rose-50 hover:shadow ${isHovered ? 'shadow-md' : 'shadow-sm'}`
      : `${zone} border border-rose-400/70 bg-rose-950/35 hover:border-rose-400 ${isHovered ? 'shadow-md' : 'shadow-sm'}`;
  }
  return isLight
    ? `${zone} border border-emerald-400/70 bg-emerald-50 hover:shadow ${isHovered ? 'shadow-md' : 'shadow-sm'}`
    : `${zone} border border-emerald-400/70 bg-emerald-950/35 hover:border-emerald-400 ${isHovered ? 'shadow-md' : 'shadow-sm'}`;
}

function RosterCard({
  player,
  side,
  isLight,
  isHovered,
  headshotTick,
  stance: _stance,
  onSelect,
  onHoverStart,
  onHoverEnd,
  cardRef
}) {
  const isConflict = side === 'cross' || ((player.myShares || 0) > 0 && (player.oppShares || 0) > 0);
  const forCount = player.myShares || 0;
  const againstCount = player.oppShares || 0;
  const shares = side === 'against' ? againstCount : forCount;
  const isDoubleFor = forCount >= 2 && againstCount === 0;
  const isDoubleAgainst = againstCount >= 2 && forCount === 0;
  const isDoubleDown = isDoubleFor || isDoubleAgainst;
  const live = Boolean(player.isLive || player.gameStatus === 'IN_PROGRESS');
  const hasBall = Boolean(player.hasPossession || (live && player.inRedZone));
  const accent = getTeamAccent(canonTeam(player.nflTeam) || player.nflTeam);
  const [scorePulse, setScorePulse] = useState('');
  const handleScoreJump = (delta) => {
    setScorePulse(delta > 0 ? 'rootmap-score-border-up' : 'rootmap-score-border-down');
    window.setTimeout(() => setScorePulse(''), 720);
  };
  const leagueCount = isConflict
    ? forCount + againstCount
    : (shares || 0);
  const timeBadge = playerTimeBadge(player);
  // Keep Double Down / Cross Fire badges; hide plain Root For / Root Against on single-league cards.
  const footerStance = isConflict
    ? (
      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-black tracking-wide ${
        isLight ? 'bg-gradient-to-r from-emerald-100 to-rose-100 text-slate-800' : 'bg-gradient-to-r from-emerald-950 to-rose-950 text-slate-100'
      }`}>
        ⚡ {forCount} FOR • {againstCount} AGAINST
      </span>
    )
    : isDoubleFor
      ? (
        <span className={`relative inline-flex items-center gap-1 overflow-hidden rounded-full border px-1.5 py-0.5 text-[8px] font-bold tracking-wide ${
          isLight
            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-800'
            : 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
        }`}>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse bg-emerald-400/15" />
          <span className="relative">🔥 {forCount}X FOR</span>
        </span>
      )
      : isDoubleAgainst
        ? (
          <span className={`relative inline-flex items-center gap-1 overflow-hidden rounded-full border px-1.5 py-0.5 text-[8px] font-bold tracking-wide ${
            isLight
              ? 'bg-rose-500/20 border-rose-500 text-rose-800'
              : 'bg-rose-500/25 border-rose-400 text-rose-200'
          }`}>
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse bg-rose-400/15" />
            <span className="relative">🚨 {againstCount}X AGAINST</span>
          </span>
        )
        : null;
  const statusTone = side === 'against' ? 'against' : 'for';
  const pointsTone = side === 'against' ? 'against' : isConflict ? 'cross' : 'for';
  return (
    <div
      data-player-name={player.name}
      data-friendly-fire={player.friendlyFire ? 'true' : 'false'}
      data-double-dip={player.doubleDip ? 'true' : 'false'}
      data-double-down={isDoubleDown ? 'true' : 'false'}
      ref={cardRef}
      onClick={onSelect}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`relative w-full min-w-0 overflow-hidden rounded-xl px-2 py-1.5 pl-2.5 transition active:scale-[0.98] cursor-pointer touch-manipulation ${scorePulse} ${rosterCardSurface(isLight, live, isConflict, isHovered, player.inRedZone, player.zeroProjection, side, isDoubleDown)}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full"
        style={{
          backgroundColor: accent.bg,
          boxShadow: live ? `0 0 10px ${accent.bg}` : undefined
        }}
      />
      <div className="flex items-start gap-2 min-w-0">
        <div className="relative shrink-0 mt-0.5">
          <PlayerHeadshot key={`${player.name}-${headshotTick}`} name={player.name} team={player.nflTeam} defense={isTeamDefense(player)} size={28} />
          {hasBall && !player.inRedZone && (
            <span className="absolute -top-0.5 -right-0.5">
              <LivePulse size={7} tone={statusTone} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Row 1: full-width name + live indicators (no score/proj squeeze) */}
          <div className="flex items-start gap-1 min-w-0">
            {live && (
              <span className="mt-1 shrink-0">
                <LivePulse size={6} tone={statusTone} />
              </span>
            )}
            <div className={`min-w-0 flex-1 font-extrabold text-[12px] leading-snug tracking-tight whitespace-normal break-normal hyphens-none ${isLight ? 'text-slate-950' : 'text-white'}`}>
              {player.name}
            </div>
            {timeBadge && (
              <span className={`shrink-0 mt-0.5 px-1 py-0.5 rounded text-[7px] font-black uppercase tracking-wide tabular-nums ${
                timeBadge === 'LIVE'
                  ? isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-950 text-emerald-300'
                  : timeBadge === 'FINAL' || timeBadge === 'BYE'
                    ? isLight ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-400'
                    : isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'
              }`}>
                {timeBadge}
              </span>
            )}
            {player.inRedZone && (
              <span className="shrink-0 px-1 py-0.5 rounded text-[7px] font-black uppercase bg-rose-600 text-white tracking-wider">
                RZ
              </span>
            )}
            {player.zeroProjection && (
              <span className="shrink-0 px-1 py-0.5 rounded text-[7px] font-black uppercase tracking-wide bg-amber-400 text-slate-950">
                0 PROJ
              </span>
            )}
          </div>
          {/* Row 2: POS • TEAM left, score + Proj differential right */}
          <div className="mt-0.5 flex items-start justify-between gap-2 min-w-0">
            <div className={`min-w-0 text-[9px] font-bold leading-tight whitespace-nowrap ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {playerPosTeamLabel(player)}
            </div>
            <LivePoints
              player={player}
              isLight={isLight}
              tone={pointsTone}
              layout="compact"
              onScoreJump={handleScoreJump}
            />
          </div>
        </div>
      </div>
      <div className={`mt-1 flex items-center justify-between gap-1 pt-1 border-t ${
        side === 'against'
          ? isLight ? 'border-rose-100' : 'border-rose-900/50'
          : isLight ? 'border-emerald-100' : 'border-emerald-900/50'
      }`}>
        <span className={`text-[9px] font-black uppercase tracking-wide tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          {leagueCount} {leagueCount === 1 ? 'LEAGUE' : 'LEAGUES'}
        </span>
        {footerStance ? <div className="min-w-0 shrink text-right">{footerStance}</div> : null}
      </div>
    </div>
  );
}

function uniqueLeagueEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries || []) {
    const name = String(entry?.league || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Player-level exposure across connected leagues (canonical card / name+team key). */
function classifyPlayerExposure(player) {
  const forLeagues = uniqueLeagueEntries(player?.myLeagues);
  const againstLeagues = uniqueLeagueEntries(player?.oppLeagues);
  const forCount = forLeagues.length || (player?.myShares || 0);
  const againstCount = againstLeagues.length || (player?.oppShares || 0);

  if (forCount >= 1 && againstCount >= 1) {
    return {
      kind: 'conflict',
      tone: 'cross',
      label: 'CONFLICT',
      forCount,
      againstCount,
      forLeagues,
      againstLeagues
    };
  }
  if (forCount >= 2 && againstCount === 0) {
    return {
      kind: 'multiFor',
      tone: 'down',
      label: `🔥 ${forCount}X FOR`,
      forCount,
      againstCount,
      forLeagues,
      againstLeagues
    };
  }
  if (againstCount >= 2 && forCount === 0) {
    return {
      kind: 'multiAgainst',
      tone: 'down-against',
      label: `🚨 ${againstCount}X AGAINST`,
      forCount,
      againstCount,
      forLeagues,
      againstLeagues
    };
  }
  if (forCount === 1 && againstCount === 0) {
    return {
      kind: 'for',
      tone: 'pure',
      label: 'FOR',
      forCount,
      againstCount,
      forLeagues,
      againstLeagues
    };
  }
  if (againstCount === 1 && forCount === 0) {
    return {
      kind: 'against',
      tone: 'threat',
      label: 'AGAINST',
      forCount,
      againstCount,
      forLeagues,
      againstLeagues
    };
  }
  return {
    kind: 'neutral',
    tone: 'neutral',
    label: 'Neutral / Free Agent',
    forCount,
    againstCount,
    forLeagues,
    againstLeagues
  };
}

function getCombinedStance(player) {
  const exposure = classifyPlayerExposure(player);
  if (exposure.kind === 'conflict') {
    const net = exposure.forCount - exposure.againstCount;
    const swing = net > 0 ? ` (+${net})` : net < 0 ? ` (${net})` : '';
    return { label: `Cross Fire${swing}`, tone: 'cross' };
  }
  if (exposure.kind === 'multiFor') return { label: exposure.label, tone: 'down' };
  if (exposure.kind === 'for') return { label: 'Root For', tone: 'pure' };
  if (exposure.kind === 'multiAgainst') return { label: exposure.label, tone: 'down-against' };
  if (exposure.kind === 'against') return { label: 'Root Against', tone: 'threat' };
  return { label: 'Neutral / Free Agent', tone: 'neutral' };
}

function SlateExposureBadge({ exposure, isLight }) {
  const { kind, label } = exposure;
  if (kind === 'conflict') {
    return (
      <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide whitespace-nowrap ${
        isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-950 text-amber-300 border-amber-700'
      }`}>
        ⚡ CONFLICT
      </span>
    );
  }
  if (kind === 'multiFor') {
    return (
      <span className={`relative inline-flex items-center gap-1 overflow-hidden rounded-full border px-1.5 py-0.5 text-[8px] font-black tracking-wide whitespace-nowrap ${
        isLight
          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-800'
          : 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
      }`}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse bg-emerald-400/20" />
        <span className="relative">{label}</span>
      </span>
    );
  }
  if (kind === 'multiAgainst') {
    return (
      <span className={`relative inline-flex items-center gap-1 overflow-hidden rounded-full border px-1.5 py-0.5 text-[8px] font-black tracking-wide whitespace-nowrap ${
        isLight
          ? 'bg-rose-500/20 border-rose-500 text-rose-800'
          : 'bg-rose-500/25 border-rose-400 text-rose-200'
      }`}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse bg-rose-400/20" />
        <span className="relative">{label}</span>
      </span>
    );
  }
  if (kind === 'against') {
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide whitespace-nowrap ${
        isLight ? 'bg-rose-100 text-rose-700' : 'bg-rose-950 text-rose-300'
      }`}>
        {label}
      </span>
    );
  }
  if (kind === 'for') {
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide whitespace-nowrap ${
        isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-950 text-emerald-300'
      }`}>
        {label}
      </span>
    );
  }
  return null;
}

function SlateLeaguePills({ exposure, isLight }) {
  const pills = [
    ...exposure.forLeagues.map((entry) => ({ key: `for:${entry.league}`, name: entry.league, side: 'for' })),
    ...exposure.againstLeagues.map((entry) => ({ key: `against:${entry.league}`, name: entry.league, side: 'against' }))
  ];
  if (!pills.length) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {pills.map((pill) => (
        <span
          key={pill.key}
          className={`rounded-full px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wide whitespace-nowrap ${
            pill.side === 'for'
              ? isLight ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
              : isLight ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-rose-950/60 text-rose-300 border border-rose-800'
          }`}
        >
          {pill.name} · {pill.side === 'for' ? 'FOR' : 'AGAINST'}
        </span>
      ))}
    </div>
  );
}

function canonTeam(team) {
  return knownTeam(team) || TEAM_ALIASES[String(team || '').toUpperCase().trim()] || String(team || '').toUpperCase().trim();
}

function isTeamDefense(player) {
  const pos = normalizePosition(player?.position);
  const slot = normalizeSlot(player?.slot);
  return pos === 'DEF' || slot === 'DEF';
}

const IDP_POSITIONS = new Set([
  'LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'FS', 'SS', 'ILB', 'OLB', 'MLB', 'NT', 'EDGE', 'IDP', 'OL'
]);

function isIdpPlayer(player) {
  if (!player || isTeamDefense(player)) return false;
  const pos = normalizePosition(player.position);
  const slot = normalizeSlot(player.slot);
  if (pos === 'K' || slot === 'K' || pos === 'DEF' || slot === 'DEF') return false;
  return IDP_POSITIONS.has(pos) || IDP_POSITIONS.has(slot);
}

function isKicker(player) {
  const pos = normalizePosition(player?.position);
  const slot = normalizeSlot(player?.slot);
  return pos === 'K' || slot === 'K';
}

function isOffensiveStarter(player) {
  if (!player || isTeamDefense(player)) return false;
  const pos = normalizePosition(player.position);
  const slot = normalizeSlot(player.slot);
  return OFFENSIVE_POSITIONS.has(pos) || OFFENSIVE_POSITIONS.has(slot);
}

function isUserScoringStarter(player) {
  return isOffensiveStarter(player) || isKicker(player);
}

function isRootMapBoardPlayer(player) {
  if (!player || isIdpPlayer(player)) return false;
  if (isTeamDefense(player)) return true;
  const pos = normalizePosition(player.position);
  const slot = normalizeSlot(player.slot);
  return pos === 'K' || slot === 'K' || isOffensiveStarter(player);
}

function defenseOpponentTeam(defTeam, games) {
  const key = canonTeam(defTeam);
  if (!key) return null;
  for (const game of games || []) {
    const home = canonTeam(game.home);
    const away = canonTeam(game.away);
    if (home === key) return away;
    if (away === key) return home;
  }
  return null;
}

function defenseFaces(defPlayer, games, offenseTeam) {
  return defenseOpponentTeam(defPlayer?.nflTeam, games) === offenseTeam;
}

function findMasterCard(playerMap, player) {
  if (!player || !playerMap) return null;
  if (player.cardKey && playerMap.get(player.cardKey)) return playerMap.get(player.cardKey);
  const direct = playerMap.get(playerCardKey(player.name, player.nflTeam || player.team, player.position, player.slot));
  if (direct) return direct;
  const nameKey = normalizePlayerMatchName(player.name);
  const team = knownTeam(player.nflTeam || player.team);
  let fallback = null;
  for (const item of playerMap.values()) {
    if (normalizePlayerMatchName(item.name) !== nameKey) continue;
    if (!positionsCompatible(player.position, player.slot, item.position, item.slot)) continue;
    if (team && knownTeam(item.nflTeam) && knownTeam(item.nflTeam) !== team) continue;
    if (team && knownTeam(item.nflTeam) === team) return item;
    if (!fallback) fallback = item;
  }
  return fallback;
}

function markExposureTags(playerMap, leagueList, games) {
  playerMap.forEach((player) => {
    player.friendlyFire = false;
    player.friendlyFireLeagues = [];
    player.doubleDip = false;
    player.doubleDipLeagues = [];
    player.crossfire = (player.myShares || 0) > 0 && (player.oppShares || 0) > 0;
  });

  (leagueList || []).forEach((lg) => {
    const leagueName = getLeagueDisplayName(lg);
    const mine = getLeaguePortfolio(lg);
    const theirs = getLeagueThreats(lg);
    const myDefs = mine.filter((player) => isTeamDefense(player));
    const oppDefs = theirs.filter((player) => isTeamDefense(player));
    mine.filter((player) => isUserScoringStarter(player)).forEach((player) => {
      const team = canonTeam(player.nflTeam);
      const card = findMasterCard(playerMap, player);
      if (!card || !team) return;
      if (myDefs.some((def) => defenseFaces(def, games, team))) {
        card.friendlyFire = true;
        if (!card.friendlyFireLeagues.includes(leagueName)) card.friendlyFireLeagues.push(leagueName);
      }
      if (oppDefs.some((def) => defenseFaces(def, games, team))) {
        card.doubleDip = true;
        if (!card.doubleDipLeagues.includes(leagueName)) card.doubleDipLeagues.push(leagueName);
      }
    });
  });
}

function ExposureFlags({ player, isLight }) {
  if (!player?.crossfire) return null;
  return (
    <div className="space-y-1 mb-1.5">
      <CrossFireMeter player={player} isLight={isLight} />
    </div>
  );
}

function normalizePosition(pos) {
  const p = String(pos || '').toUpperCase();
  if (p === 'D/ST' || p === 'DST') return 'DEF';
  if (p === 'PK') return 'K';
  return p;
}

function normalizeSlot(slot) {
  const s = String(slot || '').toUpperCase();
  if (s === 'W/R/T' || s === 'WR/TE' || s === 'W/R') return 'FLEX';
  if (s === 'D/ST' || s === 'DST') return 'DEF';
  if (s === 'D') return 'IDP';
  return s;
}

const HEADSHOT_INDEX_KEY = 'rootmap_sleeper_headshot_index_v1';
const HEADSHOT_INDEX_AT_KEY = 'rootmap_sleeper_headshot_index_at';
const HEADSHOT_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

const NFL_TEAM_PRIMARY = {
  ARI: '#97233F',
  ATL: '#A71930',
  BAL: '#241773',
  BUF: '#00338D',
  CAR: '#0085CA',
  CHI: '#0B162A',
  CIN: '#FB4F14',
  CLE: '#311D00',
  DAL: '#003594',
  DEN: '#FB4F14',
  DET: '#0076B6',
  GB: '#203731',
  HOU: '#03202F',
  IND: '#002C5F',
  JAX: '#006778',
  KC: '#E31837',
  LAC: '#0080C6',
  LAR: '#003594',
  LV: '#000000',
  MIA: '#008E97',
  MIN: '#4F2683',
  NE: '#002244',
  NO: '#101820',
  NYG: '#0B2265',
  NYJ: '#125740',
  PHI: '#004C54',
  PIT: '#101820',
  SEA: '#002244',
  SF: '#AA0000',
  TB: '#D50A0A',
  TEN: '#0C2340',
  WAS: '#5A1414',
  WSH: '#5A1414'
};

const NFL_TEAM_SECONDARY = {
  ARI: { bg: '#A5ACAF', fg: '#111111' },
  ATL: { bg: '#A71930', fg: '#FFFFFF' },
  BAL: { bg: '#9E7C0C', fg: '#FFFFFF' },
  BUF: { bg: '#C60C30', fg: '#FFFFFF' },
  CAR: { bg: '#BFC0BF', fg: '#0085CA' },
  CHI: { bg: '#C83803', fg: '#FFFFFF' },
  CIN: { bg: '#FB4F14', fg: '#111111' },
  CLE: { bg: '#FF3C00', fg: '#FFFFFF' },
  DAL: { bg: '#869397', fg: '#041E42' },
  DEN: { bg: '#FB4F14', fg: '#FFFFFF' },
  DET: { bg: '#B0B7BC', fg: '#0076B6' },
  GB: { bg: '#FFB612', fg: '#203731' },
  HOU: { bg: '#A71930', fg: '#FFFFFF' },
  IND: { bg: '#A2AAAD', fg: '#002C5F' },
  JAX: { bg: '#D7A22A', fg: '#111111' },
  KC: { bg: '#FFB81C', fg: '#E31837' },
  LAC: { bg: '#FFC20E', fg: '#0080C6' },
  LAR: { bg: '#FFA300', fg: '#003594' },
  LV: { bg: '#A5ACAF', fg: '#111111' },
  MIA: { bg: '#FC4C02', fg: '#FFFFFF' },
  MIN: { bg: '#FFC62F', fg: '#4F2683' },
  NE: { bg: '#C60C30', fg: '#FFFFFF' },
  NO: { bg: '#D3BC8D', fg: '#101820' },
  NYG: { bg: '#A71930', fg: '#FFFFFF' },
  NYJ: { bg: '#FFFFFF', fg: '#125740' },
  PHI: { bg: '#A5ACAF', fg: '#004C54' },
  PIT: { bg: '#FFB612', fg: '#101820' },
  SEA: { bg: '#69BE28', fg: '#002244' },
  SF: { bg: '#B3995D', fg: '#AA0000' },
  TB: { bg: '#34302B', fg: '#FF7900' },
  TEN: { bg: '#4B92DB', fg: '#0C2340' },
  WAS: { bg: '#FFB612', fg: '#5A1414' },
  WSH: { bg: '#FFB612', fg: '#5A1414' }
};

let headshotIndexMemory = null;

function normalizePlayerName(name) {
  return normalizePlayerMatchName(cleanYahooPlayerName(name) || name);
}

function getPlayerInitials(playerName) {
  const parts = cleanYahooPlayerName(playerName)
    .replace(/\b(Jr|Sr|II|III|IV)\.?/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getTeamAccent(team) {
  const key = String(team || '').toUpperCase();
  return NFL_TEAM_SECONDARY[key] || { bg: '#334155', fg: '#E2E8F0' };
}

function readCachedHeadshotIndex() {
  if (headshotIndexMemory) return headshotIndexMemory;
  try {
    const storedAt = Number(localStorage.getItem(HEADSHOT_INDEX_AT_KEY) || 0);
    if (storedAt && Date.now() - storedAt < HEADSHOT_INDEX_TTL_MS) {
      const raw = localStorage.getItem(HEADSHOT_INDEX_KEY);
      if (raw) {
        headshotIndexMemory = JSON.parse(raw);
        return headshotIndexMemory;
      }
    }
  } catch {
    // ignore cache read errors
  }
  return null;
}

function buildHeadshotIndex(directory) {
  const index = {};
  Object.entries(directory || {}).forEach(([id, player]) => {
    if (!player || player.sport && player.sport !== 'nfl') return;
    const fullName = player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim();
    if (!fullName) return;
    const nameKey = normalizePlayerName(fullName);
    if (!nameKey) return;
    const team = String(player.team || '').toUpperCase();
    const rank = Number(player.search_rank) || 99999;
    const entry = { id, espn: player.espn_id || null, rank };

    const nameHit = index[nameKey];
    if (!nameHit || rank < nameHit.rank) index[nameKey] = entry;
    if (team) {
      const teamKey = `${nameKey}|${team}`;
      const teamHit = index[teamKey];
      if (!teamHit || rank < teamHit.rank) index[teamKey] = entry;
    }
  });
  return index;
}

async function ensureHeadshotIndex() {
  const cached = readCachedHeadshotIndex();
  if (cached) return cached;
  const res = await fetch(SLEEPER_PLAYERS_URL);
  if (!res.ok) throw new Error('Sleeper player directory unavailable');
  const directory = await res.json();
  const index = buildHeadshotIndex(directory);
  headshotIndexMemory = index;
  try {
    localStorage.setItem(HEADSHOT_INDEX_KEY, JSON.stringify(index));
    localStorage.setItem(HEADSHOT_INDEX_AT_KEY, String(Date.now()));
  } catch {
    // quota — memory cache still works this session
  }
  return index;
}

function lookupHeadshotRecord(playerName, team) {
  const index = headshotIndexMemory || readCachedHeadshotIndex();
  if (!index) return null;
  const nameKey = normalizePlayerName(playerName);
  if (!nameKey) return null;
  const teamKey = String(team || '').toUpperCase();
  return (teamKey && index[`${nameKey}|${teamKey}`]) || index[nameKey] || null;
}

function getPlayerHeadshot(playerName, team) {
  const hit = lookupHeadshotRecord(playerName, team);
  if (!hit?.id) return null;
  if (/^[A-Z]{2,3}$/.test(hit.id)) {
    return `https://sleepercdn.com/images/team_logos/nfl/${hit.id.toLowerCase()}.png`;
  }
  return `https://sleepercdn.com/content/nfl/players/thumb/${hit.id}.jpg`;
}

function getPlayerHeadshotCandidates(playerName, team) {
  const hit = lookupHeadshotRecord(playerName, team);
  const urls = [];
  const primary = getPlayerHeadshot(playerName, team);
  if (primary) urls.push(primary);
  if (hit?.id && !/^[A-Z]{2,3}$/.test(hit.id)) {
    urls.push(`https://sleepercdn.com/content/nfl/players/${hit.id}.jpg`);
  }
  if (hit?.espn) {
    urls.push(`https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${hit.espn}.png&w=96&h=96`);
  }
  return [...new Set(urls)];
}

function espnDefenseLogoUrls(team) {
  const raw = String(team || '').trim().toLowerCase();
  const canon = canonTeam(team).toLowerCase();
  const urls = [];
  if (raw) urls.push(`https://a.espncdn.com/i/teamlogos/nfl/500/${raw}.png`);
  if (canon && canon !== raw) urls.push(`https://a.espncdn.com/i/teamlogos/nfl/500/${canon}.png`);
  if (raw === 'was' || canon === 'was') urls.push('https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png');
  return [...new Set(urls)];
}

function PlayerHeadshot({ name, team, size = 40, defense = false }) {
  const candidates = defense ? espnDefenseLogoUrls(team) : getPlayerHeadshotCandidates(name, team);
  const [urlIndex, setUrlIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = !failed ? candidates[urlIndex] : null;
  const initials = getPlayerInitials(name);
  const accent = getTeamAccent(team);
  const px = `${size}px`;
  const teamAbbr = canonTeam(team) || String(team || '').toUpperCase() || 'DEF';

  useEffect(() => {
    setUrlIndex(0);
    setFailed(false);
  }, [name, team, defense, candidates[0]]);

  if (!src || failed) {
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center font-black select-none ring-1 ring-black/10"
        style={{
          width: px,
          height: px,
          backgroundColor: accent.bg,
          color: accent.fg,
          fontSize: size <= 40 ? 11 : 12,
          letterSpacing: '-0.02em'
        }}
        aria-hidden="true"
      >
        {defense ? teamAbbr : initials}
      </div>
    );
  }

  return (
    <div
      className={`rounded-full shrink-0 overflow-hidden ring-1 ring-black/15 flex items-center justify-center ${
        defense ? 'bg-transparent' : 'bg-slate-800'
      }`}
      style={{ width: px, height: px }}
    >
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (urlIndex < candidates.length - 1) setUrlIndex((n) => n + 1);
          else setFailed(true);
        }}
        className={defense ? 'w-[86%] h-[86%] object-contain' : 'w-full h-full object-cover object-top'}
      />
    </div>
  );
}

function ImportEmptyState({ isLight, onImport }) {
  return (
    <div className={`rounded-2xl p-5 border text-center space-y-3 shadow-sm ${
      isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
    }`}>
      <div className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
        Connect Yahoo, ESPN, or Sleeper
      </div>
      <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
        No leagues are on this phone yet. Import one to fill Matchups, Game Slate, and RootMap.
      </p>
      <button
        type="button"
        onClick={onImport}
        className={`w-full min-h-11 rounded-xl border text-xs font-black ${
          isLight ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-950 border-white'
        }`}
      >
        + Import
      </button>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // keep the default theme
    }
    return 'dark';
  });
  const [view, setView] = useState('matchups');
  const [leagueSort, setLeagueSort] = useState('closest');
  const [showManageLeagues, setShowManageLeagues] = useState(false);
  const [showProUpgrade, setShowProUpgrade] = useState(false);
  const [showActivePick, setShowActivePick] = useState(false);
  const [activePickCandidates, setActivePickCandidates] = useState([]);
  const [activePickSelected, setActivePickSelected] = useState(() => new Set());
  const [isPro, setIsPro] = useState(loadIsPro);
  const [sortMode, setSortMode] = useState('slate');
  const [boardFilters, setBoardFilters] = useState({
    liveOnly: false,
    redZoneOnly: false,
    hideFinal: false,
    outperformers: false,
    conflicted: false,
    doubleDown: false
  });
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showAlertSheet, setShowAlertSheet] = useState(false);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);
  const [alertPrefs, setAlertPrefs] = useState(loadAlertPrefs);
  const [liveToast, setLiveToast] = useState(null);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifHistory, setNotifHistory] = useState(() => readBannerHistory());
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);
  const [flashGameId, setFlashGameId] = useState(null);
  const gameCardRefs = useRef(new Map());
  const [zeroProjAlerts, setZeroProjAlerts] = useState(() => {
    try {
      const stored = localStorage.getItem('rootmap_zero_proj_alerts');
      if (stored == null) return true;
      return stored !== '0';
    } catch {
      return true;
    }
  });
  const [leagues, setLeagues] = useState(loadStoredLeagues);
  const [selectedWeek, setSelectedWeek] = useState(() => getActiveSlate()?.week || FALLBACK_NFL_WEEK);
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [games, setGames] = useState(() => (getActiveSlate() || getSlateByWeek(FALLBACK_NFL_WEEK))?.games || []);
  const [liveScores, setLiveScores] = useState(null);
  const leaguesRef = useRef(leagues);
  const gamesSigRef = useRef('');
  const scoresSigRef = useRef('');
  const weekPinnedRef = useRef(false);
  const lineupRefreshRef = useRef(null);
  const requestWeekRef = useRef(getActiveSlate()?.week || FALLBACK_NFL_WEEK);
  leaguesRef.current = leagues;
  const [slateMeta, setSlateMeta] = useState(() => {
    const slate = getActiveSlate() || getSlateByWeek(FALLBACK_NFL_WEEK);
    return { week: slate?.week || FALLBACK_NFL_WEEK, label: slate?.label || `Week ${FALLBACK_NFL_WEEK}`, range: slate?.range || '', byes: slate?.byes || [] };
  });
  const [leaguePendingDelete, setLeaguePendingDelete] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [hoveredConflictPlayer, setHoveredConflictPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [showYahooIngest, setShowYahooIngest] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [connectTab, setConnectTab] = useState('yahoo');
  const [showSleeper, setShowSleeper] = useState(false);
  const [sleeperUsername, setSleeperUsername] = useState(() => {
    try {
      return localStorage.getItem('rootmap_sleeper_username') || '';
    } catch {
      return '';
    }
  });
  const [sleeperWeek, setSleeperWeek] = useState(() => String(getActiveSlate()?.week || FALLBACK_NFL_WEEK));
  const [sleeperUserId, setSleeperUserId] = useState('');
  const [sleeperChoices, setSleeperChoices] = useState([]);
  const [sleeperSelected, setSleeperSelected] = useState(() => new Set());
  const [sleeperBusy, setSleeperBusy] = useState('');
  const [sleeperError, setSleeperError] = useState('');
  const [showEspn, setShowEspn] = useState(false);
  const [espnLeagueId, setEspnLeagueId] = useState(() => readEspnSession()?.leagueId || '');
  const [espnLeagueChoices, setEspnLeagueChoices] = useState([]);
  const [espnWeek, setEspnWeek] = useState(() => String(getActiveSlate()?.week || FALLBACK_NFL_WEEK));
  const [espnSeason, setEspnSeason] = useState('2026');
  const [espnLeague, setEspnLeague] = useState(null);
  const [espnTeams, setEspnTeams] = useState([]);
  const [espnTeamId, setEspnTeamId] = useState(() => readEspnSession()?.teamId || '');
  const [espnBusy, setEspnBusy] = useState('');
  const [espnError, setEspnError] = useState('');
  const [espnPrivateOpen, setEspnPrivateOpen] = useState(false);
  const [espnSwid, setEspnSwid] = useState(() => readEspnSession()?.swid || '');
  const [espnS2, setEspnS2] = useState(() => readEspnSession()?.espnS2 || '');
  const [espnNativeSession, setEspnNativeSession] = useState(() => {
    const saved = readEspnSession();
    return saved ? { swid: saved.swid, espnS2: saved.espnS2 } : null;
  });
  const [rootView, setRootView] = useState('both');
  const [yahooPaste, setYahooPaste] = useState('');
  const [yahooIngestError, setYahooIngestError] = useState('');
  const [yahooLeagueName, setYahooLeagueName] = useState('');
  const [headshotTick, setHeadshotTick] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [showLeagueFilter, setShowLeagueFilter] = useState(false);
  const [hiddenLeagueIds, setHiddenLeagueIds] = useState(loadHiddenLeagueIds);
  const [seenTips, setSeenTips] = useState(loadSeenTips);
  const [renamingLeagueId, setRenamingLeagueId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [filterPos, setFilterPos] = useState({ top: 96, left: 12 });
  const [showSetupImport, setShowSetupImport] = useState(false);
  const [leagueBackupPaste, setLeagueBackupPaste] = useState('');
  const [leagueBackupMessage, setLeagueBackupMessage] = useState('');
  const [leagueBackupError, setLeagueBackupError] = useState(false);
  const [showMobileSync, setShowMobileSync] = useState(false);
  const [mobileSyncLink, setMobileSyncLink] = useState('');
  const [mobileSyncCode, setMobileSyncCode] = useState('');
  const [mobileSyncNote, setMobileSyncNote] = useState('');
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [notifPermission, setNotifPermission] = useState('unknown');
  const [sleeperPlayers, setSleeperPlayers] = useState(null);

  const filterButtonRef = useRef(null);
  const swipeTouchRef = useRef(null);
  const swipeAnimTimerRef = useRef(null);
  const prefersReducedMotionRef = useRef(false);
  const [swipeDragX, setSwipeDragX] = useState(0);
  const [swipeDragging, setSwipeDragging] = useState(false);
  const [viewSlideClass, setViewSlideClass] = useState('');
  const VIEW_ORDER = useMemo(() => ['matchups', 'game-slate', 'all-leagues'], []);

  const isLight = theme === 'light';

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      prefersReducedMotionRef.current = media.matches;
    };
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    prefetchSleeperPlayers()
      .then((players) => {
        if (!cancelled) setSleeperPlayers(players && typeof players === 'object' ? players : {});
      })
      .catch(() => {
        if (!cancelled) setSleeperPlayers({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sleeperPlayers || !Object.keys(sleeperPlayers).length) return;
    const index = sleeperTeamIndexFrom(sleeperPlayers);
    setLeagues((prev) => {
      let changed = false;
      const next = prev.map((league) => {
        let leagueChanged = false;
        const fillList = (list) => (list || []).map((player) => {
          if (!needsTeamBackfill(player?.nflTeam || player?.team)) return player;
          const filled = backfillPlayerTeam(player, sleeperPlayers, index);
          if (filled?.nflTeam && filled.nflTeam !== (player?.nflTeam || player?.team)) {
            leagueChanged = true;
            changed = true;
            return filled;
          }
          return player;
        });
        const portfolio = fillList(getLeaguePortfolio(league));
        const threats = fillList(getLeagueThreats(league));
        if (!leagueChanged) return league;
        return {
          ...league,
          portfolio,
          threats,
          starters: portfolio,
          opponentStarters: threats,
          userTeam: league.userTeam ? { ...league.userTeam, starters: portfolio } : league.userTeam,
          oppTeam: league.oppTeam ? { ...league.oppTeam, starters: threats } : league.oppTeam
        };
      });
      if (!changed) return prev;
      try {
        localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage is optional
      }
      return next;
    });
  }, [sleeperPlayers]);

  useEffect(() => () => {
    if (swipeAnimTimerRef.current) window.clearTimeout(swipeAnimTimerRef.current);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const top = window.scrollY || document.documentElement.scrollTop || 0;
      setFiltersCollapsed(top > 20);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const readPermission = async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          const perm = await LocalNotifications.checkPermissions();
          if (!cancelled) setNotifPermission(perm.display || 'prompt');
          return;
        }
        if (typeof Notification === 'undefined') {
          if (!cancelled) setNotifPermission('unsupported');
          return;
        }
        if (!cancelled) setNotifPermission(Notification.permission || 'default');
      } catch {
        if (!cancelled) setNotifPermission('unknown');
      }
    };
    readPermission();
    return () => { cancelled = true; };
  }, [showAlertSheet]);

  useEffect(() => {
    const nodes = [document.documentElement, document.body];
    nodes.forEach((node) => {
      node.classList.remove('light', 'dark');
      node.classList.add(theme);
    });
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // private mode can block storage
    }
  }, [theme]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const yahoo = urlParams.get('yahoo');
    const authError = urlParams.get('auth_error');
    const imported = urlParams.get('import');
    if (!yahoo && !authError && !imported) return undefined;
    if (imported) {
      decodeSetupJson(imported)
        .then((json) => {
          const next = leaguesFromJson(json);
          if (!next?.length) {
            setSyncStatus('That phone link did not include a setup.');
            return;
          }
          try {
            localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(next));
          } catch {
            setSyncStatus('Could not save this setup on this device.');
            return;
          }
          setLeagues(next);
          setHiddenLeagueIds(new Set());
          setActiveLeagueDrawer(null);
          setSyncStatus(`Imported setup with ${next.length} league${next.length === 1 ? '' : 's'}.`);
        })
        .catch(() => {
          setSyncStatus('That phone link could not be read.');
        });
    } else if (yahoo === 'synced') {
      const count = Number(urlParams.get('count')) || 0;
      setLeagues(loadStoredLeagues());
      setSyncStatus(count === 1
        ? 'Yahoo connected. 1 league is on this phone.'
        : `Yahoo connected. ${count} leagues are on this phone.`);
      // Re-pull Fantasy API data so cached "My Teams & Leagues" / 0.0 points get overwritten.
      syncYahooLeaguesFromApi().then((imported) => {
        if (!imported?.length) return;
        setLeagues((prev) => {
          const next = [...prev];
          imported.forEach((league) => {
            const normalized = normalizeLeague(league, next.length);
            const incomingKey = canonicalLeagueIdentity(normalized);
            const idx = next.findIndex((item) => (
              item.id === normalized.id
              || (incomingKey && canonicalLeagueIdentity(item) === incomingKey)
              || yahooLeagueIdOf(item) === yahooLeagueIdOf(normalized)
              || (item.yahooLeagueId && normalized.yahooLeagueId && item.yahooLeagueId === normalized.yahooLeagueId)
            ));
            if (idx >= 0) next[idx] = mergeYahooSyncedLeague(next[idx], normalized);
            else next.push(normalized);
          });
          return dedupeImportedLeagues(next);
        });
      }).catch(() => {
        // Cookie sync is best-effort after OAuth redirect.
      });
    } else if (yahoo === 'matchup-hint') {
      // QA/deep-link: show the actionable Yahoo Matchup fallback banner in the Connect modal.
      setShowYahooIngest(true);
      setSyncStatus(YAHOO_MATCHUP_HINT);
    } else if (authError) {
      setSyncStatus(authError);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    return undefined;
  }, []);

  const applyImportedYahooLeagues = (importedList, week) => {
    if (!importedList?.length) return false;
    const importKeys = new Set();
    const importIds = new Set();
    let pickedForModal = [];
    setLeagues((prev) => {
      const next = [...prev];
      importedList.forEach((league) => {
        const normalized = normalizeLeague(league, next.length);
        const incomingKey = canonicalLeagueIdentity(normalized);
        if (incomingKey) importKeys.add(incomingKey);
        if (normalized?.id) importIds.add(String(normalized.id));
        const idx = next.findIndex((item) => (
          item.id === normalized.id
          || (incomingKey && canonicalLeagueIdentity(item) === incomingKey)
          || (normalized.yahooLeagueId && item.yahooLeagueId === normalized.yahooLeagueId && (
            !normalized.yahooTeamId || !item.yahooTeamId || item.yahooTeamId === normalized.yahooTeamId
          ))
        ));
        if (idx >= 0) {
          const merged = mergeYahooSyncedLeague(next[idx], normalized);
          next[idx] = merged;
          if (merged?.id) importIds.add(String(merged.id));
        } else {
          next.push(normalized);
        }
      });
      const deduped = dedupeImportedLeagues(next);
      pickedForModal = deduped.filter((league) => (
        importIds.has(String(league.id))
        || (canonicalLeagueIdentity(league) && importKeys.has(canonicalLeagueIdentity(league)))
      ));
      return deduped;
    });
    setIsSyncing(false);
    closeConnect();
    if (!isPro && pickedForModal.length >= 3) {
      openActiveLeaguePicker(pickedForModal);
      setSyncStatus(`Synced ${pickedForModal.length} Yahoo leagues for Week ${week}. Pick ${FREE_ACTIVE_LEAGUE_LIMIT} to keep on the board.`);
      return true;
    }
    setView('matchups');
    setSyncStatus(pickedForModal.length === 1
      ? `Synced ${getLeagueDisplayName(pickedForModal[0])} from Yahoo for Week ${week}.`
      : `Synced ${pickedForModal.length || importedList.length} Yahoo leagues for Week ${week}.`);
    return true;
  };

  const ingestYahooLoginResult = async (result, week) => {
    const discovered = discoverYahooLeagues(result);
    const direct = leagueFromYahooCapture(result, week);
    if (direct) writeYahooSession(result);

    if (!discovered.length && !direct) {
      try {
        const apiLeagues = await syncYahooLeaguesFromApi({ week });
        if (apiLeagues?.length) return { apiLeagues };
      } catch (apiError) {
        console.warn('Yahoo /api/sync fallback failed', apiError);
      }
      return {
        error: 'Could not find any Yahoo leagues on this account. Open Yahoo Fantasy, confirm your leagues, then try again.'
      };
    }

    const targets = discovered.length
      ? discovered
      : [{
          leagueId: direct.yahooLeagueId,
          teamId: direct.yahooTeamId,
          matchupUrl: direct.yahooMatchupUrl,
          leagueName: direct.name,
          teamName: direct.myTeamName
        }];

    setSyncStatus(targets.length > 1
      ? `Found ${targets.length} Yahoo leagues. Reading this week’s matchups…`
      : 'Yahoo session saved. Reading this week’s matchup…');

    const { imported, expired, lastError, discoveredCount } = await captureAllYahooLeagueMatchups(
      targets,
      week,
      {
        onProgress: ({ index, total }) => {
          setSyncStatus(`Reading Yahoo matchup ${index + 1} of ${total}…`);
        }
      }
    );

    if (direct && !imported.some((league) => league.id === direct.id)) {
      imported.unshift(direct);
    }

    if (imported.length) return { importedList: imported };

    if (expired) {
      return { error: 'Yahoo session expired. Connect Yahoo again.' };
    }

    try {
      const apiLeagues = await syncYahooLeaguesFromApi({ week });
      if (apiLeagues?.length) return { apiLeagues };
    } catch (apiError) {
      console.warn('Yahoo /api/sync fallback failed', apiError);
    }

    if (discoveredCount > 0) {
      return {
        keepHint: true,
        error: lastError?.message
          || `Found ${discoveredCount} Yahoo league${discoveredCount === 1 ? '' : 's'}, but could not read starters. Tap the banner to retry.`
      };
    }

    return { keepHint: true, error: YAHOO_MATCHUP_HINT };
  };

  const handleConnectYahoo = async () => {
    setIsSyncing(true);
    setSyncStatus('');
    try {
      if (Capacitor.isNativePlatform()) {
        const week = selectedWeek;
        // Always rediscover leagues from the Yahoo lobby — do not assume a saved leagueId.
        const result = await openYahooLogin({ week });
        const outcome = await ingestYahooLoginResult(result, week);
        if (outcome.importedList?.length) {
          applyImportedYahooLeagues(outcome.importedList, week);
          return;
        }
        if (applyImportedYahooLeagues(outcome.apiLeagues, week)) return;
        setIsSyncing(false);
        setSyncStatus(outcome.keepHint ? YAHOO_MATCHUP_HINT : (outcome.error || YAHOO_MATCHUP_HINT));
        return;
      }
      await openYahooLogin();
    } catch (err) {
      setIsSyncing(false);
      const message = String(err?.message || '');
      if (message.toLowerCase().includes('cancel')) return;
      if (isYahooSessionExpired(err)) {
        setSyncStatus('Yahoo session expired. Connect Yahoo again.');
        return;
      }
      setSyncStatus(message || 'Could not start Yahoo sign-in.');
    }
  };

  const handleYahooMatchupHintTap = async () => {
    if (isSyncing || !Capacitor.isNativePlatform()) return;
    const week = selectedWeek;
    const saved = readYahooSession();
    const hasConcreteMatchup = Boolean(
      saved?.leagueId
      && saved?.matchupUrl
      && /\/f1\/\d+/i.test(saved.matchupUrl)
      && /\/matchup/i.test(saved.matchupUrl)
    );
    setIsSyncing(true);
    setSyncStatus(hasConcreteMatchup
      ? 'Opening Yahoo Matchup…'
      : 'Opening Yahoo to find your leagues…');
    try {
      // Prefer lobby rediscovery when we don't already have a concrete /matchup URL.
      const result = await openYahooLogin(hasConcreteMatchup
        ? { matchupUrl: saved.matchupUrl, week }
        : { week });
      const outcome = await ingestYahooLoginResult(result, week);
      if (outcome.importedList?.length) {
        applyImportedYahooLeagues(outcome.importedList, week);
        return;
      }
      if (applyImportedYahooLeagues(outcome.apiLeagues, week)) return;
      setIsSyncing(false);
      setSyncStatus(outcome.keepHint ? YAHOO_MATCHUP_HINT : (outcome.error || YAHOO_MATCHUP_HINT));
    } catch (err) {
      setIsSyncing(false);
      const message = String(err?.message || '');
      if (message.toLowerCase().includes('cancel')) {
        setSyncStatus(YAHOO_MATCHUP_HINT);
        return;
      }
      if (isYahooSessionExpired(err)) {
        setSyncStatus('Yahoo session expired. Connect Yahoo again.');
        return;
      }
      setSyncStatus(message || YAHOO_MATCHUP_HINT);
    }
  };

  const refreshLiveSlate = async (week = selectedWeek) => {
    const requested = Number(week) || FALLBACK_NFL_WEEK;
    try {
      const slate = await fetchLiveNFLSlate(new Date(), requested);
      if (requestWeekRef.current !== requested) return;
      if (Array.isArray(slate?.games)) {
        const signature = slate.games.map((game) => [
          game.id,
          game.status,
          game.homeScore,
          game.awayScore,
          game.isRedZone ? 1 : 0,
          game.possession || '',
          game.state || '',
          game.gameStatus || ''
        ].join(':')).join('|');
        if (signature !== gamesSigRef.current) {
          gamesSigRef.current = signature;
          setGames(slate.games);
          setSlateMeta({
            week: slate.week,
            label: slate.label,
            range: slate.range,
            byes: slate.byes || []
          });
        }
      }
    } catch (err) {
      console.warn('Scoreboard fetch error:', err);
    }
    try {
      const scores = await fetchSleeperLiveScores({
        season: getSlateByWeek(requested)?.season || getActiveSlate()?.season || 2026,
        week: requested
      });
      if (requestWeekRef.current !== requested) return;
      const signature = sleeperScoreSignature(scores);
      if (signature !== scoresSigRef.current) {
        scoresSigRef.current = signature;
        setLiveScores(scores);
      }
    } catch (err) {
      console.warn('Sleeper live stats error:', err);
    }
  };

  useEffect(() => {
    requestWeekRef.current = selectedWeek;
    gamesSigRef.current = '';
    scoresSigRef.current = '';
    refreshLiveSlate(selectedWeek);
    const interval = setInterval(() => refreshLiveSlate(selectedWeek), 60000);
    return () => clearInterval(interval);
  }, [selectedWeek]);

  useEffect(() => {
    let cancelled = false;
    fetchNflState()
      .then((state) => {
        if (cancelled || weekPinnedRef.current) return;
        const week = Number(state?.week);
        if (!Number.isFinite(week) || week < 1 || week > 18) return;
        if (week === requestWeekRef.current) return;
        const slate = getSlateByWeek(week);
        setSelectedWeek(week);
        setSlateMeta({
          week,
          label: slate?.label || `Week ${week}`,
          range: slate?.range || '',
          byes: slate?.byes || []
        });
        if (slate?.games?.length) setGames(slate.games);
      })
      .catch(() => {
        // the dated slate stays on the fallback week
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saved = readEspnSession();
    if (!saved?.swid || !saved?.espnS2) return undefined;
    let cancelled = false;
    fetchEspnFanLeagues(saved)
      .then((choices) => {
        if (cancelled) return;
        setEspnLeagueChoices(choices);
        if (choices.length === 1) {
          setEspnLeagueId((current) => String(current || '').trim() || choices[0].id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const week = Number(selectedWeek);
    if (!week || lineupRefreshRef.current === week) return undefined;
    let cancelled = false;
    const refreshStoredLineups = async () => {
      const current = leaguesRef.current || [];
      const updates = new Map();
      let sleeperOk = false;
      let espnOk = false;
      try {
        const username = localStorage.getItem('rootmap_sleeper_username') || '';
        const sleeperLeagues = current.filter((lg) => lg?.sleeperLeagueId || String(lg?.id || '').startsWith('sleeper-'));
        if (!sleeperLeagues.length) {
          sleeperOk = true;
        } else if (username) {
          const user = await lookupSleeperUser(username);
          const imported = await syncSleeperLeagues({
            userId: user.user_id,
            week,
            leagues: sleeperLeagues.map((lg) => ({
              id: lg.sleeperLeagueId || String(lg.id).replace(/^sleeper-/, ''),
              name: lg.name,
              rosterPositions: lg.rosterPositions,
              scoringSettings: lg.scoringSettings
            }))
          });
          imported.forEach((lg) => updates.set(lg.id, lg));
          sleeperOk = true;
        }
      } catch (err) {
        console.warn('Sleeper lineup refresh failed', err);
      }
      const espnSession = readEspnSession();
      const espnLeagues = current.filter((lg) => lg?.espnLeagueId && lg?.espnTeamId);
      if (!espnLeagues.length) espnOk = true;
      let espnFailures = 0;
      for (const lg of espnLeagues) {
        if (cancelled) break;
        try {
          const raw = await fetchEspnLeague({
            leagueId: lg.espnLeagueId,
            season: lg.season || 2026,
            week,
            swid: espnSession?.swid || '',
            espnS2: espnSession?.espnS2 || ''
          });
          const mapped = mapEspnLeague({
            league: raw,
            leagueId: lg.espnLeagueId,
            teamId: lg.espnTeamId,
            week,
            season: lg.season || 2026
          });
          updates.set(mapped.id, mapped);
        } catch (err) {
          espnFailures += 1;
          console.warn('ESPN lineup refresh failed', err);
        }
      }
      if (espnLeagues.length && espnFailures < espnLeagues.length) espnOk = true;
      if (Capacitor.isNativePlatform()) {
        try {
          const sessions = readYahooSessions().filter((saved) => saved?.matchupUrl);
          let expired = false;
          for (const saved of sessions) {
            if (cancelled || expired) break;
            try {
              const stable = await fetchYahooMatchupCapture(saved, week);
              if (cancelled || !stable) continue;
              writeYahooSession(stable);
              const imported = leagueFromYahooCapture(stable, week);
              if (imported) {
                const id = stable.leagueId
                  ? `yahoo-${stable.leagueId}${stable.teamId ? `-${stable.teamId}` : ''}`
                  : imported.id;
                updates.set(id, {
                  ...imported,
                  id,
                  yahooLeagueId: stable.leagueId,
                  yahooTeamId: stable.teamId,
                  yahooMatchupUrl: stable.matchupUrl
                });
              }
            } catch (error) {
              if (!isYahooSessionExpired(error)) throw error;
              expired = true;
            }
          }
          if (expired && !cancelled) {
            const captured = await YahooLogin.login();
            if (!cancelled && captured) {
              writeYahooSession(captured);
              const imported = leagueFromYahooCapture(captured, week);
              if (imported) updates.set(imported.id, imported);
            }
          }
        } catch (err) {
          console.warn('Yahoo lineup refresh failed', err);
        }
      }

      // Cookie-backed Yahoo Fantasy API refresh — overwrites cached section names + 0.0 points.
      try {
        const hasYahoo = current.some((lg) => (
          String(lg?.platform || '').toLowerCase().includes('yahoo')
          || String(lg?.id || '').startsWith('yahoo-')
          || lg?.leagueKey
          || lg?.yahooLeagueId
        ));
        if (hasYahoo) {
          const imported = await syncYahooLeaguesFromApi({ week });
          if (imported?.length) {
            imported.forEach((league) => {
              const id = league.id || `yahoo-${league.leagueKey || league.yahooLeagueId || Date.now()}`;
              updates.set(id, { ...league, id });
            });
          }
        }
      } catch (err) {
        console.warn('Yahoo API sync failed', err);
      }

      if (cancelled) return;
      // Only lock the week after at least one platform refresh succeeded so a
      // cold-start miss (no Sleeper username yet) can retry.
      if (sleeperOk || espnOk || updates.size) {
        lineupRefreshRef.current = week;
      }
      if (!updates.size) return;
      setLeagues((prev) => {
        const used = new Set();
        const next = prev.map((lg) => {
          let updated = updates.get(lg.id);
          if (!updated) {
            const key = yahooLeagueIdOf(lg);
            if (key) {
              updated = [...updates.values()].find((item) => yahooLeagueIdOf(item) === key) || null;
            }
          }
          if (!updated && lg.yahooLeagueId) {
            const candidates = [...updates.values()].filter((item) => item.yahooLeagueId === lg.yahooLeagueId);
            updated = candidates.find((item) => item.yahooTeamId && lg.yahooTeamId && item.yahooTeamId === lg.yahooTeamId)
              || (candidates.length === 1 && !lg.yahooTeamId ? candidates[0] : null)
              || candidates.find((item) => !item.yahooTeamId && !lg.yahooTeamId)
              || null;
          }
          if (!updated) {
            // Still scrub a cached section header even when sync did not return this row.
            if (isGenericYahooLeagueName(lg.name) || isGenericYahooLeagueName(lg.leagueName) || looksLikeYahooTeamName(lg.name, lg) || looksLikeYahooTeamName(lg.leagueName, lg)) {
              const teamName = preferYahooLeagueName(lg.myTeamName, lg.teamName, lg.userTeam?.name);
              const leagueName = preferYahooLeagueOverTeam(teamName, lg.leagueName, lg.name);
              return normalizeLeague({
                ...lg,
                name: leagueName,
                leagueName,
                teamName,
                myTeamName: teamName || lg.myTeamName
              });
            }
            return lg;
          }
          used.add(updated.id);
          return mergeSyncedLeague(lg, updated);
        });
        updates.forEach((updated, id) => {
          if (used.has(id) || !String(id).startsWith('yahoo-')) return;
          if (next.some((lg) => lg.id === id || (
            yahooLeagueIdOf(lg)
            && yahooLeagueIdOf(lg) === yahooLeagueIdOf(updated)
          ) || (
            updated.yahooLeagueId
            && lg.yahooLeagueId === updated.yahooLeagueId
            && ((updated.yahooTeamId && lg.yahooTeamId && lg.yahooTeamId === updated.yahooTeamId)
              || (!updated.yahooTeamId && !lg.yahooTeamId))
          ))) return;
          next.push(normalizeLeague(updated));
        });
        return dedupeImportedLeagues(next);
      });
    };
    refreshStoredLineups();
    return () => {
      cancelled = true;
    };
  }, [selectedWeek]);

  useEffect(() => {
    let cancelled = false;
    ensureHeadshotIndex()
      .then(() => {
        if (!cancelled) setHeadshotTick((n) => n + 1);
      })
      .catch(() => {
        // Initials fallback remains if the directory cannot load
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(leagues));
    } catch {
      // ignore quota / private-mode failures
    }
  }, [leagues]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_LEAGUES_KEY, JSON.stringify([...hiddenLeagueIds].map(String)));
    } catch {
      // preference storage is optional
    }
  }, [hiddenLeagueIds]);

  useEffect(() => {
    saveIsPro(isPro);
  }, [isPro]);

  useEffect(() => {
    if (!showLegend && !showLeagueFilter && !leaguePendingDelete && !showSetupImport && !showConnect && !showSleeper && !showEspn && !showYahooIngest && !showSortSheet && !showAlertSheet && !showWeekPicker && !showMobileSync && !jumpMenuOpen && !showManageLeagues && !showProUpgrade && !showActivePick) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (showProUpgrade) {
        setShowProUpgrade(false);
        return;
      }
      if (showActivePick) {
        return;
      }
      if (showManageLeagues) {
        setShowManageLeagues(false);
        setRenamingLeagueId(null);
        setRenameDraft('');
        return;
      }
      if (showEspn || showSleeper || showYahooIngest || showConnect) {
        setShowConnect(false);
        setShowEspn(false);
        setShowSleeper(false);
        setShowYahooIngest(false);
        setEspnPrivateOpen(false);
        return;
      }
      if (showMobileSync) {
        setShowMobileSync(false);
        return;
      }
      if (showWeekPicker) {
        setShowWeekPicker(false);
        return;
      }
      if (showAlertSheet) {
        setShowAlertSheet(false);
        return;
      }
      if (jumpMenuOpen) {
        setJumpMenuOpen(false);
        return;
      }
      if (showSetupImport) {
        setShowSetupImport(false);
        setLeagueBackupPaste('');
        setLeagueBackupMessage('');
        setLeagueBackupError(false);
        return;
      }
      if (leaguePendingDelete) {
        setLeaguePendingDelete(null);
        return;
      }
      setShowLegend(false);
      setShowLeagueFilter(false);
      setShowSortSheet(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLegend, showLeagueFilter, leaguePendingDelete, showSetupImport, showConnect, showSleeper, showEspn, showYahooIngest, showSortSheet, showAlertSheet, showWeekPicker, showMobileSync, jumpMenuOpen, showManageLeagues, showProUpgrade, showActivePick]);

  const confirmRemoveLeague = () => {
    if (!leaguePendingDelete) return;
    const ids = leaguePendingDelete.bulk ? leaguePendingDelete.ids : [leaguePendingDelete.id];
    const drop = new Set(ids.filter(Boolean));
    if (!drop.size) {
      setLeaguePendingDelete(null);
      return;
    }
    setLeagues((prev) => prev.filter((lg) => !drop.has(lg.id)));
    setHiddenLeagueIds((prev) => {
      const next = new Set(prev);
      drop.forEach((id) => next.delete(String(id)));
      return next;
    });
    if (activeLeagueDrawer && drop.has(activeLeagueDrawer.id)) setActiveLeagueDrawer(null);
    setLeaguePendingDelete(null);
  };

  useEffect(() => {
    if (!showLeagueFilter) return undefined;
    const place = () => {
      const rect = filterButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setFilterPos({ top: rect.bottom + 8, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [showLeagueFilter]);

  const toggleLeagueFilter = () => {
    if (showLeagueFilter) {
      setShowLeagueFilter(false);
      return;
    }
    const rect = filterButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 288;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setFilterPos({ top: rect.bottom + 8, left });
    }
    setShowLeagueFilter(true);
  };

  const openProUpgrade = () => {
    setShowProUpgrade(true);
    tapHaptic();
  };

  const unlockRootMapPro = () => {
    setIsPro(true);
    setShowProUpgrade(false);
    if (activePickCandidates.length) {
      setHiddenLeagueIds((prev) => {
        const next = new Set([...prev].map(String));
        activePickCandidates.forEach((league) => next.delete(String(league.id)));
        return next;
      });
      setShowActivePick(false);
      setActivePickCandidates([]);
      setActivePickSelected(new Set());
      setView('matchups');
    }
    setSyncStatus('RootMap Pro unlocked. You can keep every league active.');
    tapHaptic();
  };

  const openActiveLeaguePicker = (candidateLeagues) => {
    const candidates = (candidateLeagues || []).filter(Boolean);
    if (!candidates.length) return;
    const preselected = candidates.slice(0, FREE_ACTIVE_LEAGUE_LIMIT).map((league) => String(league.id));
    const selected = new Set(preselected);
    setActivePickCandidates(candidates);
    setActivePickSelected(selected);
    setShowActivePick(true);
    setHiddenLeagueIds((prev) => {
      const next = new Set([...prev].map(String));
      candidates.forEach((league) => {
        const id = String(league.id);
        if (selected.has(id)) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const toggleActivePickSelection = (leagueId) => {
    const id = String(leagueId);
    setActivePickSelected((prev) => {
      const next = new Set([...prev].map(String));
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= FREE_ACTIVE_LEAGUE_LIMIT) {
        openProUpgrade();
        return prev;
      }
      next.add(id);
      return next;
    });
  };

  const confirmActiveLeaguePick = () => {
    const selected = new Set([...activePickSelected].map(String));
    if (!selected.size) {
      setSyncStatus(`Pick up to ${FREE_ACTIVE_LEAGUE_LIMIT} leagues to keep on the board.`);
      return;
    }
    setHiddenLeagueIds(new Set(
      leagues.map((league) => String(league.id)).filter((id) => !selected.has(id))
    ));
    setShowActivePick(false);
    setActivePickCandidates([]);
    setActivePickSelected(new Set());
    setView('matchups');
    setSyncStatus(selected.size === 1
      ? 'Tracking 1 selected league. Others stay saved in Manage Leagues.'
      : `Tracking ${selected.size} selected leagues. Others stay saved in Manage Leagues.`);
    tapHaptic();
  };

  const toggleLeagueVisibility = (leagueId) => {
    const id = String(leagueId);
    setHiddenLeagueIds((prev) => {
      const next = new Set([...prev].map(String));
      if (next.has(id)) {
        if (!isPro) {
          const currentlyActive = activeLeagueCount(leagues, next);
          if (currentlyActive >= FREE_ACTIVE_LEAGUE_LIMIT) {
            openProUpgrade();
            return prev;
          }
        }
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const commitLeagueRename = (leagueId) => {
    const custom = renameDraft.trim();
    setLeagues((prev) => prev.map((league) => {
      if (league.id !== leagueId) return league;
      return { ...league, customLeagueName: custom, displayName: custom };
    }));
    setRenamingLeagueId(null);
    setRenameDraft('');
  };

  const chooseWeek = (week) => {
    const number = Number(week);
    if (!Number.isFinite(number) || number < 1 || number > 18) return;
    weekPinnedRef.current = true;
    requestWeekRef.current = number;
    const slate = getSlateByWeek(number);
    setSelectedWeek(number);
    setSlateMeta({
      week: number,
      label: slate?.label || `Week ${number}`,
      range: slate?.range || '',
      byes: slate?.byes || []
    });
    setGames(slate?.games || []);
    setShowWeekPicker(false);
    tapHaptic();
  };

  const copyText = async (value) => {
    const text = String(value || '');
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '0';
        area.style.top = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(area);
        return copied;
      } catch {
        return false;
      }
    }
  };

  const openMobileSync = async () => {
    setShowSortSheet(false);
    setShowLeagueFilter(false);
    setShowWeekPicker(false);
    let json = '';
    try {
      json = localStorage.getItem(LEAGUES_STORAGE_KEY) || '';
    } catch {
      json = '';
    }
    if (!json) json = JSON.stringify(leagues);
    let count = 0;
    try {
      const parsed = JSON.parse(json);
      count = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      count = leagues.length;
      json = JSON.stringify(leagues);
    }
    if (!count) {
      setMobileSyncLink('');
      setMobileSyncCode('');
      setMobileSyncNote('Add a league on this device before sending the setup to a phone.');
      setShowMobileSync(true);
      return;
    }
    const code = await encodeSetupPayload(json);
    const origin = await phoneSyncOrigin(window.location.origin);
    const link = setupLinkFor(origin, window.location.pathname, code);
    let phoneHost = '';
    try {
      phoneHost = new URL(origin).hostname;
    } catch {
      phoneHost = '';
    }
    const local = linkIsLocalOnly(phoneHost);
    setMobileSyncCode(code);
    setMobileSyncLink(link);
    setMobileSyncNote(local
      ? 'This link only opens on this computer. Copy the code and paste it into Import on the phone.'
      : link
        ? `Open this link on the phone while it is on the same Wi-Fi as this computer (${phoneHost}).`
        : 'This setup is too long for a link. Copy the code and paste it on the phone.');
    setShowMobileSync(true);
  };

  const exportSetup = async () => {
    let payload = '';
    try {
      payload = localStorage.getItem(LEAGUES_STORAGE_KEY) || '';
    } catch {
      payload = '';
    }
    if (!payload) payload = JSON.stringify(leagues);

    const copyNow = () => {
      try {
        const area = document.createElement('textarea');
        area.value = payload;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '0';
        area.style.top = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(area);
        return copied;
      } catch {
        return false;
      }
    };

    try {
      await navigator.clipboard.writeText(payload);
      setLeagueBackupMessage('Setup code copied to clipboard!');
      setLeagueBackupError(false);
      return;
    } catch {
      if (copyNow()) {
        setLeagueBackupMessage('Setup code copied to clipboard!');
        setLeagueBackupError(false);
        return;
      }
    }

    setLeagueBackupPaste(payload);
    setShowSetupImport(true);
    setLeagueBackupMessage('Clipboard was blocked. The setup code is in the box — select it and copy.');
    setLeagueBackupError(true);
  };

  const closeSetupImport = () => {
    setShowSetupImport(false);
    setLeagueBackupPaste('');
    setLeagueBackupMessage('');
    setLeagueBackupError(false);
  };

  const openSetupImport = () => {
    setLeagueBackupPaste('');
    setLeagueBackupMessage('');
    setLeagueBackupError(false);
    setShowSetupImport(true);
  };

  const saveImportedSetup = async () => {
    let decoded = leagueBackupPaste;
    try {
      decoded = await decodeSetupJson(leagueBackupPaste);
    } catch {
      decoded = leagueBackupPaste;
    }
    const next = parseSetupCode(decoded) || parseSetupCode(leagueBackupPaste);
    if (!next) {
      setLeagueBackupMessage('Paste a setup code.');
      setLeagueBackupError(true);
      setMobileSyncNote('Paste a setup code or phone link.');
      return;
    }
    try {
      localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setLeagueBackupMessage('Could not save this setup on this device.');
      setLeagueBackupError(true);
      return;
    }
    setLeagues(next);
    setHiddenLeagueIds(new Set());
    setActiveLeagueDrawer(null);
    setLeaguePendingDelete(null);
    setLeagueBackupPaste('');
    setShowSetupImport(false);
    setShowMobileSync(false);
    setLeagueBackupError(false);
    setLeagueBackupMessage(`Setup imported. ${next.length} league${next.length === 1 ? '' : 's'} on the board.`);
    setSyncStatus(`Imported setup with ${next.length} league${next.length === 1 ? '' : 's'}.`);
  };

  const selectConnectTab = (tab) => {
    setConnectTab(tab);
    setShowConnect(true);
    setShowYahooIngest(tab === 'yahoo');
    setShowSleeper(tab === 'sleeper');
    setShowEspn(tab === 'espn');
    if (tab === 'espn') {
      const saved = readEspnSession();
      const savedId = saved?.leagueId || '';
      if (savedId) setEspnLeagueId((current) => String(current || '').trim() || savedId);
      const swid = saved?.swid || espnSwid;
      const s2 = saved?.espnS2 || espnS2;
      if (swid && s2) {
        fetchEspnFanLeagues({ swid, espnS2: s2 })
          .then((choices) => {
            setEspnLeagueChoices(choices);
            if (choices.length === 1) {
              setEspnLeagueId((current) => String(current || '').trim() || choices[0].id);
            }
          })
          .catch(() => {});
      }
    }
  };

  const closeConnect = () => {
    setShowConnect(false);
    setShowYahooIngest(false);
    setShowSleeper(false);
    setShowEspn(false);
    setEspnPrivateOpen(false);
  };

  const openYahooIngest = () => {
    setYahooIngestError('');
    setYahooLeagueName(`League ${leagues.length + 1}`);
    selectConnectTab('yahoo');
  };

  const toggleSleeperLeague = (leagueId) => {
    setSleeperSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  };

  const findSleeperLeagues = async () => {
    setSleeperError('');
    setSleeperBusy('Looking up that Sleeper username…');
    setSleeperChoices([]);
    try {
      const user = await lookupSleeperUser(sleeperUsername);
      const found = await fetchUserSleeperLeagues(user.user_id, '2026');
      if (!found.length) {
        setSleeperUserId('');
        setSleeperError('No 2026 NFL leagues found for that username.');
        return;
      }
      try {
        localStorage.setItem('rootmap_sleeper_username', sleeperUsername.trim());
      } catch {
        // the username is only a convenience
      }
      setSleeperUserId(user.user_id);
      setSleeperChoices(found);
      setSleeperSelected(new Set(found.map((league) => league.id)));
      prefetchSleeperPlayers();
    } catch (error) {
      setSleeperUserId('');
      setSleeperError(error?.message || 'Could not reach Sleeper.');
    } finally {
      setSleeperBusy('');
    }
  };

  const saveSleeperSetup = async () => {
    const selected = sleeperChoices.filter((league) => sleeperSelected.has(league.id));
    if (!selected.length) {
      setSleeperError('Select at least one league.');
      return;
    }
    setSleeperError('');
    setSleeperBusy('Syncing starters and opponents…');
    try {
      const imported = await syncSleeperLeagues({
        userId: sleeperUserId,
        leagues: selected,
        week: sleeperWeek
      });
      const normalized = imported.map((league, index) => normalizeLeague(league, index)).filter(Boolean);
      const next = [
        ...leagues.filter((league) => !normalized.some((item) => item.id === league.id)),
        ...normalized
      ];
      try {
        localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        setSleeperError('Could not save these leagues on this device.');
        return;
      }
      const deduped = dedupeImportedLeagues(next);
      setLeagues(deduped);
      closeConnect();
      if (!isPro && normalized.length >= 3) {
        openActiveLeaguePicker(normalized);
        setSyncStatus(`Synced ${normalized.length} Sleeper leagues for Week ${sleeperWeek}. Pick ${FREE_ACTIVE_LEAGUE_LIMIT} to keep on the board.`);
      } else {
        setView('matchups');
        setSyncStatus(`Synced ${normalized.length} Sleeper league${normalized.length === 1 ? '' : 's'} for Week ${sleeperWeek}.`);
      }
    } catch (error) {
      setSleeperError(error?.message || 'Could not sync those Sleeper leagues.');
    } finally {
      setSleeperBusy('');
    }
  };

  const closeEspnConnect = () => {
    closeConnect();
  };

  const openEspnConnect = async () => {
    setEspnError('');
    setEspnBusy('');
    setEspnLeague(null);
    setEspnTeams([]);
    setEspnPrivateOpen(false);
    setEspnWeek(String(slateMeta.week || FALLBACK_NFL_WEEK));
    setEspnSeason('2026');
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await openNativeEspnLogin();
        const swid = String(result?.swid || '').trim();
        const espnS2Value = String(result?.espnS2 || '').trim();
        if (!swid || !espnS2Value) {
          setSyncStatus('ESPN sign-in did not finish. Open Connect ESPN and sign in on ESPN’s page.');
          return;
        }
        const saved = readEspnSession();
        const leagueId = String(result?.leagueId || saved?.leagueId || '').trim();
        const sameLeague = Boolean(leagueId) && saved?.leagueId === leagueId;
        const teamId = sameLeague ? String(saved?.teamId || '').trim() : '';
        setEspnSwid(swid);
        setEspnS2(espnS2Value);
        setEspnNativeSession({ swid, espnS2: espnS2Value });
        if (leagueId) setEspnLeagueId(leagueId);
        setEspnTeamId(teamId);
        writeEspnSession({ swid, espnS2: espnS2Value, leagueId, teamId });
        selectConnectTab('espn');
        const choices = await fetchEspnFanLeagues({ swid, espnS2: espnS2Value }).catch(() => []);
        setEspnLeagueChoices(choices);
        const known = choices.find((league) => league.id === leagueId);
        const picked = known?.id || (choices.length === 1 ? choices[0].id : leagueId);
        if (picked) setEspnLeagueId(picked);
        if (picked && picked !== leagueId) {
          writeEspnSession({ swid, espnS2: espnS2Value, leagueId: picked, teamId: '' });
        }
        if (picked) {
          setSyncStatus('Signed in on ESPN. This phone will refresh that league each week.');
          await loadEspnLeague({
            leagueId: picked,
            swid,
            espnS2: espnS2Value,
            teamId: picked === leagueId ? teamId : ''
          });
        } else {
          setSyncStatus(choices.length > 1
            ? 'Signed in on ESPN. Choose one of your leagues, or enter an ID.'
            : 'Signed in on ESPN. Enter a league ID to load it.');
        }
      } catch (error) {
        const message = String(error?.message || '');
        if (!message.toLowerCase().includes('cancel')) {
          setSyncStatus('ESPN sign-in could not open.');
        }
      }
      return;
    }
    selectConnectTab('espn');
  };

  const loadEspnLeague = async (overrides = null) => {
    const options = overrides && typeof overrides === 'object' && typeof overrides.preventDefault !== 'function'
      ? overrides
      : {};
    const leagueId = options.leagueId ?? espnLeagueId;
    const season = options.season ?? espnSeason;
    const week = options.week ?? espnWeek;
    const swid = options.swid ?? (espnPrivateOpen ? espnSwid : (espnNativeSession?.swid || espnSwid));
    const s2 = options.espnS2 ?? (espnPrivateOpen ? espnS2 : (espnNativeSession?.espnS2 || espnS2));
    setEspnError('');
    setEspnBusy('Loading that ESPN league…');
    setEspnLeague(null);
    setEspnTeams([]);
    setEspnTeamId('');
    try {
      const league = await fetchEspnLeague({
        leagueId,
        season,
        week,
        swid,
        espnS2: s2
      });
      const teams = listEspnTeams(league);
      if (!teams.length) {
        setEspnError('That league has no teams yet.');
        return;
      }
      const preferred = String(options.teamId ?? espnTeamId ?? '');
      const match = teams.find((team) => team.id === preferred);
      setEspnLeague(league);
      setEspnTeams(teams);
      setEspnTeamId(match ? match.id : teams[0].id);
    } catch (error) {
      setEspnError(error?.message || 'Could not reach ESPN.');
    } finally {
      setEspnBusy('');
    }
  };

  const saveEspnSetup = () => {
    if (!espnLeague) {
      setEspnError('Load the league before syncing.');
      return;
    }
    setEspnError('');
    try {
      const imported = mapEspnLeague({
        league: espnLeague,
        leagueId: espnLeagueId.trim(),
        teamId: espnTeamId,
        week: espnWeek,
        season: espnSeason
      });
      if (!imported.userTeam.starters.length && !imported.oppTeam.starters.length) {
        setEspnError('No starters found for that team this week.');
        return;
      }
      const normalized = normalizeLeague(imported, leagues.length);
      const next = [
        ...leagues.filter((league) => league.id !== normalized.id),
        normalized
      ];
      try {
        localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        setEspnError('Could not save this league on this device.');
        return;
      }
      writeEspnSession({
        swid: espnNativeSession?.swid || espnSwid,
        espnS2: espnNativeSession?.espnS2 || espnS2,
        leagueId: espnLeagueId.trim(),
        teamId: String(espnTeamId || '')
      });
      setLeagues(dedupeImportedLeagues(next));
      setView('matchups');
      closeEspnConnect();
      setSyncStatus(`Synced ${imported.name} from ESPN for Week ${espnWeek}.`);
    } catch (error) {
      setEspnError(error?.message || 'Could not sync that ESPN league.');
    }
  };

  const handleImportYahooMatchup = () => {
    const espnPaste = isEspnMatchupText(yahooPaste);
    const parsed = espnPaste ? parseEspnMatchupText(yahooPaste) : parseYahooMatchupText(yahooPaste);
    const myStarters = parsed.userTeam?.starters || parsed.myStarters || [];
    const oppStarters = parsed.oppTeam?.starters || parsed.oppStarters || [];
    if (!myStarters.length && !oppStarters.length) {
      setYahooIngestError(espnPaste
        ? 'No starters found. Copy the full ESPN matchup page (both lineups) and paste again.'
        : 'No players found. Copy the full Yahoo or ESPN Matchup page (Ctrl+A, Ctrl+C) and paste again.');
      return;
    }

    const typedName = yahooLeagueName.trim();
    const autoName = `League ${leagues.length + 1}`;
    const espnTeamName = parsed.userTeam?.name && parsed.userTeam.name !== 'My Team' ? parsed.userTeam.name : '';
    const detectedLeague = parsed.leagueName || '';
    const fallbackName = espnPaste
      ? (detectedLeague || espnTeamName || 'ESPN League')
      : (detectedLeague && !isGenericYahooLeagueName(detectedLeague)
        ? detectedLeague
        : autoName);
    const leagueName = typedName && typedName !== autoName ? typedName : fallbackName;
    const oppTeamName = parsed.oppTeam?.name || parsed.oppTeamName || MISSING_OPPONENT_NAME;
    const myTeamName = espnPaste ? (espnTeamName || leagueName) : (parsed.myTeamName || leagueName);
    const myHasPasteStats = myStarters.some((player) => (
      Number.isFinite(Number(player?.actualPoints)) || Number.isFinite(Number(player?.projPoints))
    ));
    const oppHasPasteStats = !oppStarters.length || oppStarters.some((player) => (
      Number.isFinite(Number(player?.actualPoints)) || Number.isFinite(Number(player?.projPoints))
    ));
    const imported = normalizeLeague({
      id: espnPaste ? (parsed.id || `espn-${Date.now()}`) : `lg_${Date.now()}`,
      name: leagueName,
      myTeamName,
      oppTeamName,
      opponent: oppTeamName,
      platform: espnPaste ? 'ESPN' : 'Yahoo',
      scoringSource: espnPaste ? 'espn' : 'yahoo',
      yahooNative: !espnPaste,
      yahooStatsOk: espnPaste ? undefined : (myHasPasteStats && oppHasPasteStats),
      myScore: parsed.myScore ?? parsed.userTeam?.score ?? 0,
      oppScore: parsed.oppScore ?? parsed.oppTeam?.score ?? 0,
      myProj: parsed.myProj ?? parsed.userTeam?.projectedScore ?? null,
      oppProj: parsed.oppProj ?? parsed.oppTeam?.projectedScore ?? null,
      myRecord: parsed.myRecord || parsed.userTeam?.record || null,
      oppRecord: parsed.oppRecord || parsed.oppTeam?.record || null,
      myRank: parsed.myRank ?? parsed.userTeam?.rank ?? null,
      oppRank: parsed.oppRank ?? parsed.oppTeam?.rank ?? null,
      lineupWeek: Number(selectedWeek) || null,
      userTeam: espnPaste
        ? { ...parsed.userTeam, name: myTeamName, starters: myStarters }
        : { name: myTeamName, starters: myStarters, record: parsed.myRecord || null, rank: parsed.myRank ?? null },
      oppTeam: espnPaste
        ? { ...parsed.oppTeam, name: oppTeamName, starters: oppStarters }
        : { name: oppTeamName, starters: oppStarters, record: parsed.oppRecord || null, rank: parsed.oppRank ?? null },
      portfolio: myStarters,
      threats: oppStarters
    }, leagues.length);

    setLeagues((prev) => dedupeImportedLeagues([...prev, imported]));
    setView('matchups');
    setYahooIngestError('');
    setYahooPaste('');
    setYahooLeagueName('');
    closeConnect();
    setSyncStatus(`Imported ${myStarters.length} starters and ${oppStarters.length} threats into ${leagueName}.`);
  };

  const visibleLeagues = useMemo(
    () => leagues.filter((lg) => !hiddenLeagueIds.has(String(lg.id))),
    [leagues, hiddenLeagueIds]
  );

  const hiddenCount = leagues.length - visibleLeagues.length;
  const freeActiveLabel = freeActiveBadge(visibleLeagues.length);

  const activeSlateWeek = getActiveSlate()?.week || FALLBACK_NFL_WEEK;
  const alertsAreCurrent = Number(selectedWeek) === Number(activeSlateWeek);

  const alertLeagues = useMemo(() => {
    if (!alertsAreCurrent) return [];
    return visibleLeagues.filter((league) => {
      const lineupWeek = Number(league?.lineupWeek);
      if (!Number.isFinite(lineupWeek) || lineupWeek <= 0) return true;
      return lineupWeek === Number(selectedWeek);
    });
  }, [alertsAreCurrent, visibleLeagues, selectedWeek]);

  const playerMasterIndex = useMemo(
    () => buildPlayerMasterIndex(visibleLeagues, games, null, liveScores, sleeperPlayers),
    [visibleLeagues, games, liveScores, sleeperPlayers]
  );

  const crossFirePointsRef = useRef(null);

  useEffect(() => {
    prepareCrossFireAlerts();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('rootmap_zero_proj_alerts', zeroProjAlerts ? '1' : '0');
    } catch {
      // preference storage is optional
    }
  }, [zeroProjAlerts]);

  useEffect(() => {
    try {
      localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(alertPrefs));
    } catch {
      // preference storage is optional
    }
  }, [alertPrefs]);

  useEffect(() => {
    if (!zeroProjAlerts || !liveScores) return undefined;
    if (!alertsAreCurrent) return undefined;
    const found = checkZeroProjectionStarters(alertLeagues, { games, liveScores });
    const delayMs = alertPrefs.spoilerFreeDelay ? 45000 : 0;
    const timer = window.setTimeout(() => {
      notifyZeroProjectionAlerts(found, { week: selectedWeek, phase: 'upcoming' });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [zeroProjAlerts, alertPrefs.spoilerFreeDelay, alertLeagues, alertsAreCurrent, selectedWeek, games, liveScores]);

  const [finalSlateNailbiters, setFinalSlateNailbiters] = useState(() => new Map());

  useEffect(() => {
    let cancelled = false;
    if (!alertsAreCurrent) {
      setFinalSlateNailbiters(new Map());
      return undefined;
    }
    const now = new Date();
    const byId = new Map();
    alertLeagues.forEach((league) => {
      const matchup = hydrateMatchupKickoffs({
        id: league.id,
        name: getLeagueDisplayName(league),
        leagueName: getLeagueDisplayName(league),
        myStarters: getLeaguePortfolio(league),
        oppStarters: getLeagueThreats(league)
      }, games);
      const result = evaluateMatchupNailbiter(matchup, { games, liveScores, now });
      if (result) byId.set(league.id, result);
    });
    setFinalSlateNailbiters(byId);

    if (!Capacitor.isNativePlatform()) return undefined;
    const results = [...byId.values()];
    const delayMs = alertPrefs.spoilerFreeDelay ? 45000 : 0;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      syncFinalSlateNailbiterNotifications({
        results,
        week: selectedWeek,
        enabled: Boolean(alertPrefs.finalSlateNailbiter)
      }).catch((err) => {
        console.warn('Final-slate nailbiter schedule failed', err);
      });
      syncLineupLockNotifications({
        leagues: alertLeagues,
        games,
        week: selectedWeek,
        enabled: Boolean(alertPrefs.lineupLock)
      }).catch((err) => {
        console.warn('Lineup lock schedule failed', err);
      });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [alertLeagues, alertsAreCurrent, games, liveScores, alertPrefs.finalSlateNailbiter, alertPrefs.lineupLock, alertPrefs.spoilerFreeDelay, selectedWeek]);

  useEffect(() => subscribeInAppBanners((entry) => {
    // Single compact floating toast — never a multi-card stack above the board.
    setLiveToast(entry);
    setNotifHistory(readBannerHistory());
    setNotifUnread((count) => count + 1);
    const clearId = entry.id;
    window.setTimeout(() => {
      setLiveToast((current) => (current?.id === clearId ? null : current));
    }, 4000);
  }), []);

  useEffect(() => {
    if (!alertsAreCurrent) return undefined;
    const delayMs = alertPrefs.spoilerFreeDelay ? 45000 : 0;
    const timer = window.setTimeout(() => {
      playerMasterIndex.forEach((player) => {
        if (!player || !(player.myShares > 0)) return;
        // Live active-week games only — never final or historical-week rows.
        if (!playerEligibleForLiveAlert(player)) return;
        const leagueName = player.myLeagues?.[0]?.league || 'your league';
        const alertLeague = (!isGenericYahooLeagueName(leagueName) && !/^your league$/i.test(leagueName))
          ? leagueName
          : (visibleLeagues.map(getLeagueDisplayName).find((name) => name && !isGenericYahooLeagueName(name)) || leagueName);
        if (alertPrefs.redZoneTv && player.inRedZone) {
          notifyRedZoneAlert({
            id: `rz|${player.cardKey || player.name}|${alertLeague}|${selectedWeek}`,
            playerName: player.name,
            leagueName: alertLeague,
            week: selectedWeek,
            phase: 'live'
          });
        }
        const delta = boomDelta(player);
        if (delta >= 4) {
          notifyOutperformerAlert({
            id: `out|${player.cardKey || player.name}|${alertLeague}|${selectedWeek}`,
            playerName: player.name,
            leagueName: alertLeague,
            delta,
            week: selectedWeek,
            phase: 'live'
          });
        }
      });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [playerMasterIndex, alertPrefs.redZoneTv, alertPrefs.spoilerFreeDelay, selectedWeek, alertsAreCurrent, visibleLeagues]);

  useEffect(() => {
    const next = new Map();
    playerMasterIndex.forEach((player) => {
      if (!player.crossfire) return;
      const points = finiteNumber(player.actualPoints);
      if (points == null) return;
      next.set(player.cardKey, { points, player });
    });
    const previous = crossFirePointsRef.current;
    crossFirePointsRef.current = next;
    if (!previous || !alertsAreCurrent) return;
    let best = null;
    next.forEach((entry, key) => {
      const before = previous.get(key);
      if (!before || entry.points <= before.points + 0.05) return;
      const delta = entry.points - before.points;
      if (!best || delta > best.delta) best = { ...entry, delta };
    });
    if (!best) return;
    const mine = best.player.myLeagues?.[0]?.league || 'your league';
    const opp = best.player.oppLeagues?.[0]?.league || 'the other league';
    if (best.player.gameStatus === 'FINAL' || best.player.isFinal) return;
    if (!(best.player.isLive || best.player.gameStatus === 'IN_PROGRESS')) return;
    notifyCrossFire({
      name: best.player.name,
      delta: best.delta.toFixed(1),
      mine,
      opp,
      week: selectedWeek,
      phase: 'live'
    });
  }, [playerMasterIndex, alertsAreCurrent, selectedWeek]);

  const drawerPlayer = selectedPlayer
    ? (findMasterCard(playerMasterIndex, selectedPlayer) || selectedPlayer)
    : null;

  const rankedBoard = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter((p) => isRootMapBoardPlayer(p) && (p.myShares > 0 || p.oppShares > 0) && passesBoardFilters(p, boardFilters))
      .sort((a, b) => compareBoardPlayers(a, b, sortMode));
  }, [playerMasterIndex, sortMode, boardFilters]);

  const forCount = rankedBoard.filter((p) => p.myShares > 0).length;
  const againstCount = rankedBoard.filter((p) => p.oppShares > 0).length;

  const myPortfolio = useMemo(
    () => rankedBoard.filter((p) => p.myShares > 0 && rootView !== 'against'),
    [rankedBoard, rootView]
  );

  const oppThreats = useMemo(
    () => rankedBoard.filter((p) => p.oppShares > 0 && rootView !== 'for'),
    [rankedBoard, rootView]
  );

  const filterCount = Number(boardFilters.liveOnly)
    + Number(boardFilters.redZoneOnly)
    + Number(boardFilters.hideFinal)
    + Number(boardFilters.outperformers)
    + Number(boardFilters.conflicted)
    + Number(boardFilters.doubleDown);
  const leagueSortReadyRef = useRef(false);

  useEffect(() => {
    if (leagueSortReadyRef.current || !games.length) return;
    leagueSortReadyRef.current = true;
    const live = games.some((game) => game.gameStatus === 'IN_PROGRESS' || /\bLIVE\b/i.test(`${game.status || ''} ${game.time || ''}`));
    setLeagueSort(live ? 'closest' : 'standing');
  }, [games]);

  const sortedLeagues = useMemo(() => {
    const hydrated = visibleLeagues.map((league) => (
      hydrateLeagueForMatchups(league, games, liveScores, sleeperPlayers, playerMasterIndex)
    ));
    hydrated.sort((a, b) => {
      if (leagueSort === 'standing') {
        const ar = Number(leagueSideRecord(a, 'my').rank) || 99;
        const br = Number(leagueSideRecord(b, 'my').rank) || 99;
        if (ar !== br) return ar - br;
      } else if (leagueSort === 'win') {
        const delta = matchupOutlook(b).myPct - matchupOutlook(a).myPct;
        if (delta) return delta;
      } else {
        const ad = Math.abs(leagueSideScore(a, 'my') - leagueSideScore(a, 'opp'));
        const bd = Math.abs(leagueSideScore(b, 'my') - leagueSideScore(b, 'opp'));
        if (ad !== bd) return ad - bd;
      }
      return getUserTeamName(a).localeCompare(getUserTeamName(b));
    });
    return hydrated;
  }, [visibleLeagues, leagueSort, games, liveScores, sleeperPlayers, playerMasterIndex]);

  const getGamePlayers = (game) => {
    if (!game) return [];
    const home = canonTeam(game.home);
    const away = canonTeam(game.away);
    return Array.from(playerMasterIndex.values()).filter(
      (p) => isRootMapBoardPlayer(p) && (p.myShares > 0 || p.oppShares > 0) && (canonTeam(p.nflTeam) === away || canonTeam(p.nflTeam) === home)
    );
  };

  const orderedGames = useMemo(() => {
    const exposure = (game) => getGamePlayers(game).reduce(
      (sum, player) => sum + (player.myShares || 0) + (player.oppShares || 0),
      0
    );
    return [...(games || [])].sort((a, b) => {
      const asWindow = slateWindowFor({
        gameStatus: a.gameStatus || gamePhase(a),
        isLive: a.gameStatus === 'IN_PROGRESS' || /\bLIVE\b/i.test(a.status || ''),
        kickoff: a.kickoff,
        gameClock: a.status || a.time
      });
      const bsWindow = slateWindowFor({
        gameStatus: b.gameStatus || gamePhase(b),
        isLive: b.gameStatus === 'IN_PROGRESS' || /\bLIVE\b/i.test(b.status || ''),
        kickoff: b.kickoff,
        gameClock: b.status || b.time
      });
      if (asWindow.rank !== bsWindow.rank) return asWindow.rank - bsWindow.rank;
      const kickoffDelta = kickoffMillis(a.kickoff) - kickoffMillis(b.kickoff);
      if (kickoffDelta) return kickoffDelta;
      return exposure(b) - exposure(a);
    });
  }, [games, playerMasterIndex]);

  const jumpToGame = (gameId) => {
    const node = gameCardRefs.current.get(gameId);
    if (!node) return;
    setJumpMenuOpen(false);
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlashGameId(gameId);
    window.setTimeout(() => setFlashGameId((current) => (current === gameId ? null : current)), 1100);
    tapHaptic();
  };

  const renderBoardColumn = (players, side) => {
    let previousWindow = '';
    let markedFinal = false;
    let markedBye = false;
    return players.map((player) => {
      const window = slateWindowFor(player);
      const showSlate = sortMode === 'slate' && window.id !== previousWindow;
      const showFinal = sortMode !== 'slate' && window.id === 'final' && !markedFinal;
      const showBye = window.id === 'bye' && !markedBye;
      if (window.id === 'final') markedFinal = true;
      if (window.id === 'bye') markedBye = true;
      previousWindow = window.id;
      const cardKey = player.cardKey || player.name;
      const isConflict = side === 'cross' || (side === 'for' ? player.oppShares > 0 : player.myShares > 0);
      return (
        <div key={`${side}_${cardKey}`} className="space-y-1">
          {(showSlate || showFinal || showBye) && (
            <div className={`px-1 text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {window.id === 'bye' ? 'BYE WEEK' : showFinal ? 'FINAL' : slateDividerLabel(player, window)}
            </div>
          )}
          <div className={window.id === 'bye' ? 'opacity-60' : window.id === 'final' ? 'opacity-75' : undefined}>
          <RosterCard
            player={player}
            side={side}
            isLight={isLight}
            isHovered={hoveredConflictPlayer === cardKey}
            headshotTick={headshotTick}
            stance={renderStance(player)}
            onSelect={() => setSelectedPlayer(player)}
            onHoverStart={() => isConflict && setHoveredConflictPlayer(cardKey)}
            onHoverEnd={() => setHoveredConflictPlayer(null)}
          />
          </div>
        </div>
      );
    });
  };

  const renderStance = (player) => {
    const stance = getCombinedStance(player);
    if (stance.tone === 'cross') {
      return <span className="text-violet-500 font-black uppercase tracking-wide text-right leading-tight">{stance.label}</span>;
    }
    if (stance.tone === 'down' || stance.tone === 'pure') {
      return (
        <span className={`font-black text-right leading-tight ${isLight ? 'text-green-600' : 'text-emerald-300'}`}>
          {stance.label}
        </span>
      );
    }
    if (stance.tone === 'down-against' || stance.tone === 'threat') {
      return (
        <span className={`font-black text-right leading-tight ${isLight ? 'text-red-600' : 'text-rose-300'}`}>
          {stance.label}
        </span>
      );
    }
    return <span className={`font-bold text-right leading-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Neutral / Free Agent</span>;
  };

  const connectTabs = (
    <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="League platform">
      {[
        ['yahoo', '🟣 Yahoo'],
        ['sleeper', '🟢 Sleeper'],
        ['espn', '🔴 ESPN']
      ].map(([id, label]) => {
        const active = connectTab === id;
        const activeClass = id === 'yahoo'
          ? 'bg-purple-600 border-purple-500 text-white'
          : id === 'sleeper'
            ? 'bg-emerald-600 border-emerald-500 text-white'
            : 'bg-red-600 border-red-500 text-white';
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (id === 'espn') openEspnConnect();
              else selectConnectTab(id);
            }}
            className={`min-h-11 rounded-xl text-xs font-black border ${
              active
                ? activeClass
                : isLight
                  ? 'bg-white border-slate-200 text-slate-600'
                  : 'bg-slate-950 border-slate-700 text-slate-300'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const syncPhoneButton = (
    <button
      type="button"
      onClick={() => {
        closeConnect();
        openMobileSync();
      }}
      className={`w-full min-h-11 rounded-xl border text-xs font-black ${
        isLight ? 'border-slate-200 text-slate-700 bg-slate-50' : 'border-slate-700 text-slate-200 bg-slate-950'
      }`}
    >
      📱 Sync to Phone (QR / Link)
    </button>
  );

  const triggerViewSlide = (direction) => {
    if (prefersReducedMotionRef.current) {
      setViewSlideClass('');
      return;
    }
    setViewSlideClass(direction === 'left' ? 'rootmap-view-slide-left' : 'rootmap-view-slide-right');
    if (swipeAnimTimerRef.current) window.clearTimeout(swipeAnimTimerRef.current);
    swipeAnimTimerRef.current = window.setTimeout(() => setViewSlideClass(''), 240);
  };

  const goToView = (nextView, directionHint) => {
    if (!nextView || nextView === view) return;
    const from = VIEW_ORDER.indexOf(view);
    const to = VIEW_ORDER.indexOf(nextView);
    const direction = directionHint || (to > from ? 'left' : 'right');
    setSwipeDragX(0);
    setSwipeDragging(false);
    triggerViewSlide(direction);
    setView(nextView);
    tapHaptic();
  };

  const resetSwipeGesture = () => {
    swipeTouchRef.current = null;
    setSwipeDragging(false);
    setSwipeDragX(0);
  };

  const handleViewportTouchStart = (event) => {
    if (showAlertSheet || showSortSheet || showConnect || selectedPlayer || activeLeagueDrawer || leaguePendingDelete) {
      resetSwipeGesture();
      return;
    }
    const target = event.target;
    if (typeof target?.closest === 'function' && target.closest('.overflow-x-auto')) {
      resetSwipeGesture();
      return;
    }
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeTouchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      locked: false,
      ignored: false
    };
    setSwipeDragging(false);
    setSwipeDragX(0);
  };

  const handleViewportTouchMove = (event) => {
    const start = swipeTouchRef.current;
    if (!start || start.ignored) return;
    if (showAlertSheet || showSortSheet || showConnect || selectedPlayer || activeLeagueDrawer || leaguePendingDelete) {
      resetSwipeGesture();
      return;
    }
    const touch = event.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!start.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) * 1.25 >= Math.abs(dx)) {
        start.ignored = true;
        setSwipeDragging(false);
        setSwipeDragX(0);
        return;
      }
      start.locked = true;
    }
    if (prefersReducedMotionRef.current) return;
    setSwipeDragging(true);
    setSwipeDragX(Math.max(-56, Math.min(56, dx * 0.42)));
  };

  const handleViewportTouchEnd = (event) => {
    const start = swipeTouchRef.current;
    const wasIgnored = Boolean(start?.ignored);
    swipeTouchRef.current = null;
    setSwipeDragging(false);
    if (!start || wasIgnored) {
      setSwipeDragX(0);
      return;
    }
    if (showAlertSheet || showSortSheet || showConnect || selectedPlayer || activeLeagueDrawer || leaguePendingDelete) {
      setSwipeDragX(0);
      return;
    }
    const touch = event.changedTouches?.[0];
    if (!touch) {
      setSwipeDragX(0);
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.max(1, now - (start.t || now));
    const distanceOk = Math.abs(dx) > 32;
    const flickOk = Math.abs(dx) / dt > 0.35;
    const horizontalOk = Math.abs(dx) > Math.abs(dy) * 1.25;
    if (!(horizontalOk && (distanceOk || flickOk))) {
      window.requestAnimationFrame(() => setSwipeDragX(0));
      return;
    }
    const index = VIEW_ORDER.indexOf(view);
    if (index < 0) {
      setSwipeDragX(0);
      return;
    }
    if (dx < 0 && index < VIEW_ORDER.length - 1) {
      goToView(VIEW_ORDER[index + 1], 'left');
    } else if (dx > 0 && index > 0) {
      goToView(VIEW_ORDER[index - 1], 'right');
    } else {
      window.requestAnimationFrame(() => setSwipeDragX(0));
    }
  };

  return (
    <div
      className={`min-h-screen pb-[calc(7.5rem+env(safe-area-inset-bottom))] font-sans transition-colors duration-200 ${
        isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
      onTouchStart={handleViewportTouchStart}
      onTouchMove={handleViewportTouchMove}
      onTouchEnd={handleViewportTouchEnd}
      onTouchCancel={resetSwipeGesture}
    >
      <div className={`rootmap-topbar sticky top-0 z-40 max-w-md mx-auto ${isLight ? 'bg-white/95' : 'bg-slate-950/95'} backdrop-blur-md`}>
      <header className={`border-b px-3 py-1.5 space-y-1.5 transition-colors ${
        isLight ? 'border-slate-200 shadow-sm' : 'border-slate-800/80'
      }`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <RootMapLogo className="w-10 h-10 rounded-xl shadow-sm ring-1 ring-white/10" showWordmark={false} />
            <span className={`font-extrabold text-lg tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Root<span className="text-emerald-400">Map</span>
            </span>
          </div>
          <div className="relative z-50 flex items-center gap-1.5 shrink-0">
            <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showWeekPicker}
            onClick={() => setShowWeekPicker((open) => !open)}
            className={`shrink-0 h-9 px-2 rounded-lg text-[10px] font-black border whitespace-nowrap transition ${
              showWeekPicker || view === 'game-slate'
                ? isLight ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-950 text-emerald-300 border-emerald-600'
                : isLight ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200' : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
            }`}
          >
            Week {slateMeta.week}
          </button>
            {view === 'all-leagues' && (
              <button
                type="button"
                onClick={() => selectConnectTab('yahoo')}
                className={`shrink-0 h-9 px-2.5 rounded-lg text-[10px] font-black border whitespace-nowrap ${
                  isLight ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-950 border-white'
                }`}
              >
                + Import
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setNotifHistory(readBannerHistory());
                setShowNotifDrawer(true);
                setNotifUnread(0);
                prepareCrossFireAlerts();
                prepareZeroProjectionAlerts({ request: false });
                tapHaptic();
              }}
              aria-label={notifUnread > 0 ? `Notifications, ${notifUnread} unread` : 'Notifications'}
              title="Notifications"
              className={`relative w-9 h-9 rounded-lg border flex items-center justify-center transition touch-manipulation ${
                showAlertSheet || showNotifDrawer || notifUnread > 0 || alertPrefs.lineupRescue || alertPrefs.redZoneTv || alertPrefs.fourthQuarterSweat || alertPrefs.finalSlateNailbiter || alertPrefs.lineupLock
                  ? isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-emerald-950/50 text-emerald-300 border-emerald-700'
                  : isLight ? 'bg-white text-slate-700 border-slate-200' : 'bg-slate-900 text-slate-200 border-slate-700'
              }`}
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
                <path fill="currentColor" d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5v1.3c0 .5-.2 1-.5 1.4L2.8 9.4A1.2 1.2 0 0 0 3.8 11h8.4a1.2 1.2 0 0 0 1-1.6l-1.2-1.7a2.2 2.2 0 0 1-.5-1.4V5A3.5 3.5 0 0 0 8 1.5Zm-1.3 11a1.3 1.3 0 1 0 2.6 0h-2.6Z" />
              </svg>
              {notifUnread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[1.05rem] h-[1.05rem] px-0.5 rounded-full bg-[#E11D48] text-white text-[9px] font-black leading-[1.05rem] text-center tabular-nums shadow">
                  {notifUnread > 9 ? '9+' : notifUnread}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTheme(isLight ? 'dark' : 'light')}
              aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
              title={isLight ? 'Dark mode' : 'Light mode'}
              className={`w-9 h-9 rounded-lg border flex items-center justify-center transition touch-manipulation ${
                isLight
                  ? 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50'
                  : 'bg-slate-900 text-amber-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              {isLight ? (
                <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
                  <path fill="currentColor" d="M8 1.2a.7.7 0 0 1 .7.7V3a.7.7 0 1 1-1.4 0V1.9A.7.7 0 0 1 8 1.2Zm0 10.2A3.4 3.4 0 1 0 8 4.6a3.4 3.4 0 0 0 0 6.8Zm6.1-4.1a.7.7 0 0 1-.7.7H12a.7.7 0 1 1 0-1.4h1.4a.7.7 0 0 1 .7.7ZM4.7 8a.7.7 0 0 1-.7.7H2.6a.7.7 0 1 1 0-1.4H4a.7.7 0 0 1 .7.7Zm7.9-4.6a.7.7 0 0 1 0 1L11.6 5.4a.7.7 0 1 1-1-1l1-1a.7.7 0 0 1 1 0ZM5.4 10.6a.7.7 0 0 1 0 1l-1 1a.7.7 0 1 1-1-1l1-1a.7.7 0 0 1 1 0Zm6.2 0a.7.7 0 0 1 1 1l-1 1a.7.7 0 1 1-1-1l1-1Zm-6.2-6.2a.7.7 0 0 1 0 1l-1 1a.7.7 0 1 1-1-1l1-1a.7.7 0 0 1 1 0ZM8 13a.7.7 0 0 1 .7.7v1.1a.7.7 0 1 1-1.4 0V13.7A.7.7 0 0 1 8 13Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
                  <path fill="currentColor" d="M8.4 1.4a.7.7 0 0 1 .2.8 4.6 4.6 0 0 0 5.2 6.3.7.7 0 0 1 .8.9A6.6 6.6 0 1 1 7.6 1.2a.7.7 0 0 1 .8.2Z" />
                </svg>
              )}
            </button>
            {showWeekPicker && (
              <>
                <button
                  type="button"
                  aria-label="Close week picker"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setShowWeekPicker(false)}
                />
                <div
                  role="dialog"
                  aria-label="Choose NFL week"
                  className={`absolute right-0 top-11 z-50 w-64 rounded-2xl border p-3 shadow-2xl ${
                    isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                  }`}
                >
                  <div className={`text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    NFL week
                  </div>
                  <div className="grid grid-cols-6 gap-1 mt-2">
                    {Array.from({ length: 18 }, (_, index) => index + 1).map((week) => {
                      const selected = Number(slateMeta.week) === week;
                      return (
                        <button
                          key={week}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => chooseWeek(week)}
                          className={`h-8 rounded-lg text-[11px] font-black border ${
                            selected
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : isLight ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-slate-950 text-slate-300 border-slate-800'
                          }`}
                        >
                          {week}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowWeekPicker(false);
                      goToView(view === 'game-slate' ? 'matchups' : 'game-slate');
                    }}
                    className={`mt-2 w-full min-h-9 rounded-xl border text-[11px] font-black ${
                      isLight ? 'border-slate-200 text-slate-700' : 'border-slate-700 text-slate-200'
                    }`}
                  >
                    {view === 'game-slate' ? 'Back to board' : 'Open game slate'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {view === 'matchups' && leagues.length > 0 && (
          <div
            className={`rootmap-filter-tray ${filtersCollapsed ? 'is-collapsed' : ''}`}
            aria-hidden={filtersCollapsed}
          >
            <div className="-mx-3 px-3 overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-1 min-w-max pb-0.5">
                {[
                  { key: 'redZoneOnly', label: '🔴 RedZone', active: boardFilters.redZoneOnly },
                  { key: 'outperformers', label: '🔥 Outperformers', active: boardFilters.outperformers },
                  { key: 'conflicted', label: '⚡ Conflicted', active: boardFilters.conflicted },
                  { key: 'doubleDown', label: '🔥 Double Down', active: boardFilters.doubleDown }
                ].map((pill) => (
                  <button
                    key={pill.key}
                    type="button"
                    aria-pressed={pill.active}
                    tabIndex={filtersCollapsed ? -1 : 0}
                    onClick={() => {
                      setBoardFilters((current) => ({ ...current, [pill.key]: !current[pill.key] }));
                      tapHaptic();
                    }}
                    className={`shrink-0 h-8 px-1.5 rounded-full border text-[10px] font-black whitespace-nowrap transition ${
                      pill.active
                        ? isLight ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-950 border-white'
                        : isLight ? 'bg-white text-slate-700 border-slate-200' : 'bg-slate-900 text-slate-200 border-slate-700'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
                <button
                  ref={filterButtonRef}
                  type="button"
                  tabIndex={filtersCollapsed ? -1 : 0}
                  onClick={() => setShowSortSheet(true)}
                  className={`shrink-0 inline-flex h-8 items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-black whitespace-nowrap ${
                    filterCount > 0 || sortMode !== 'slate'
                      ? isLight ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : isLight ? 'bg-white text-slate-700 border-slate-300' : 'bg-slate-900 text-slate-200 border-slate-700'
                  }`}
                >
                  Filter
                  {filterCount > 0 && (
                    <span className={`rounded-full px-1 text-[9px] ${isLight ? 'bg-white/20' : 'bg-slate-900/10'}`}>{filterCount}</span>
                  )}
                  <span aria-hidden="true">▾</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {view === 'matchups' && leagues.length > 0 && (
          <div
            className="grid grid-cols-2 gap-1.5 pt-0.5"
            role="tablist"
            aria-label="Rooting view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={rootView !== 'against'}
              onClick={() => {
                setRootView((current) => {
                  const next = current === 'for' ? 'both' : 'for';
                  if (next !== current) tapHaptic();
                  return next;
                });
              }}
              className={`min-h-9 rounded-full px-2 text-[11px] font-black tracking-wider uppercase border transition-colors ${
                rootView !== 'against'
                  ? isLight
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-emerald-950 text-emerald-300 border-emerald-500/80 shadow-[0_0_0_1px_rgba(52,211,153,0.25)]'
                  : isLight
                    ? 'bg-emerald-50 text-emerald-700/70 border-emerald-200'
                    : 'bg-emerald-950/40 text-emerald-500/70 border-emerald-900'
              }`}
            >
              ▲ Root For ({forCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rootView !== 'for'}
              onClick={() => {
                setRootView((current) => {
                  const next = current === 'against' ? 'both' : 'against';
                  if (next !== current) tapHaptic();
                  return next;
                });
              }}
              className={`min-h-9 rounded-full px-2 text-[11px] font-black tracking-wider uppercase border transition-colors ${
                rootView !== 'for'
                  ? isLight
                    ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                    : 'bg-rose-950 text-rose-300 border-rose-500/80 shadow-[0_0_0_1px_rgba(251,113,133,0.25)]'
                  : isLight
                    ? 'bg-rose-50 text-rose-700/70 border-rose-200'
                    : 'bg-rose-950/40 text-rose-500/70 border-rose-900'
              }`}
            >
              ▼ Root Against ({againstCount})
            </button>
          </div>
        )}
      </header>
      </div>

      {/* Single floating toast — never an inline multi-card stack above the board */}
      {liveToast && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-[70] flex justify-center px-3">
          <div
            role="status"
            className={`pointer-events-auto max-w-md w-full px-3 py-2 rounded-xl text-xs font-bold text-left shadow-2xl border ${liveToast.surfaceClass || notificationSurfaceClass(liveToast.category, liveToast.outlook)}`}
          >
            <div className="tracking-wide text-[10px] font-black opacity-90">{liveToast.title}</div>
            <div className="mt-0.5 font-semibold leading-snug">{liveToast.body}</div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main
        className={`max-w-md mx-auto p-3 space-y-3 rootmap-view-track ${viewSlideClass} ${swipeDragging ? 'is-dragging' : ''}`}
        style={swipeDragX ? { transform: `translate3d(${swipeDragX}px, 0, 0)` } : undefined}
      >
        {TAB_TIPS[view] && !seenTips[view] && (
          <div
            role="note"
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
              isLight ? 'bg-amber-50 border-amber-200 text-amber-950' : 'bg-amber-950/40 border-amber-700 text-amber-50'
            }`}
          >
            <p className="min-w-0 flex-1 text-[11px] font-semibold leading-snug">{TAB_TIPS[view]}</p>
            <button
              type="button"
              onClick={() => {
                setSeenTips((prev) => {
                  const next = { ...prev, [view]: true };
                  try {
                    localStorage.setItem(TAB_TIP_KEY, JSON.stringify(next));
                  } catch {
                    // preference storage is optional
                  }
                  return next;
                });
              }}
              className={`shrink-0 text-[10px] font-black uppercase tracking-wide ${
                isLight ? 'text-amber-800' : 'text-amber-200'
              }`}
            >
              Dismiss
            </button>
          </div>
        )}

        {syncStatus && (
          isYahooMatchupHint(syncStatus) ? (
            <button
              type="button"
              onClick={handleYahooMatchupHintTap}
              disabled={isSyncing}
              className="w-full px-3 py-2.5 rounded-xl text-xs font-bold text-center shadow-lg border bg-[#0D9488] text-white animate-pulse rootmap-pulse-blink border-teal-300 disabled:opacity-70"
            >
              {syncStatus}
            </button>
          ) : (
            <div
              role="status"
              className={`px-3 py-2.5 rounded-xl text-xs font-mono font-bold text-center shadow-lg border ${
                /missing|could not|did not|expired|no yahoo/i.test(syncStatus)
                  ? 'bg-[#E11D48] text-white border-[#E11D48]'
                  : 'bg-[#0F9D68] text-white border-emerald-400'
              }`}
            >
              {syncStatus}
            </div>
          )
        )}

        {/* VIEW 1: MATCHUPS */}
        {view === 'matchups' && leagues.length === 0 && (
          <ImportEmptyState isLight={isLight} onImport={() => selectConnectTab('yahoo')} />
        )}
        {view === 'matchups' && leagues.length > 0 && (
          <div className="space-y-3">
            {((rootView === 'both' && rankedBoard.length === 0)
              || (rootView === 'for' && myPortfolio.length === 0)
              || (rootView === 'against' && oppThreats.length === 0)) && (
              <div className={`rounded-2xl px-3 py-4 text-center text-xs font-semibold border ${
                isLight ? 'bg-white border-slate-200 text-slate-500' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}>
                {visibleLeagues.length === 0
                  ? 'Every league on this board is unchecked. Turn one back on in Manage Leagues.'
                  : (boardFilters.liveOnly || boardFilters.redZoneOnly || boardFilters.hideFinal || boardFilters.outperformers || boardFilters.conflicted || boardFilters.doubleDown)
                    ? 'No starters match this filter.'
                    : 'No starters in this view.'}
              </div>
            )}

            <div className="relative">
              {rootView === 'both' ? (
                <div className="flex items-start gap-0">
                  <div className={`flex-1 flex flex-col gap-2 min-w-0 px-1 py-1 rounded-xl ${
                    isLight ? 'bg-emerald-50/70' : 'bg-emerald-950/20'
                  }`}>
                    {renderBoardColumn(myPortfolio, 'for')}
                  </div>
                  <div
                    aria-hidden="true"
                    className={`w-px shrink-0 self-stretch mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-slate-800'}`}
                  />
                  <div className={`flex-1 flex flex-col gap-2 min-w-0 px-1 py-1 rounded-xl ${
                    isLight ? 'bg-rose-50/70' : 'bg-rose-950/20'
                  }`}>
                    {renderBoardColumn(oppThreats, 'against')}
                  </div>
                </div>
              ) : (
                <div className={`flex flex-col gap-2 rounded-xl px-1 py-1 ${
                  rootView === 'against'
                    ? isLight ? 'bg-rose-50/70' : 'bg-rose-950/20'
                    : isLight ? 'bg-emerald-50/70' : 'bg-emerald-950/20'
                }`}>
                  {renderBoardColumn(rootView === 'for' ? myPortfolio : oppThreats, rootView)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: GAME SLATE */}
        {view === 'game-slate' && leagues.length === 0 && (
          <ImportEmptyState isLight={isLight} onImport={() => selectConnectTab('yahoo')} />
        )}
        {view === 'game-slate' && leagues.length > 0 && (
          <div className="space-y-3">
            <div className={`h-11 rounded-xl border px-2.5 flex items-center justify-between gap-2 shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div className={`min-w-0 truncate text-[11px] font-black ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                Byes: {(slateMeta.byes || []).length ? slateMeta.byes.join(' • ') : 'None'}
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-expanded={jumpMenuOpen}
                  onClick={() => {
                    setJumpMenuOpen((open) => !open);
                    tapHaptic();
                  }}
                  className={`rootmap-jump-pulse h-8 px-2.5 rounded-full border text-[10px] font-black whitespace-nowrap ${
                    jumpMenuOpen
                      ? isLight ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : isLight ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-slate-950 text-slate-100 border-slate-700'
                  }`}
                >
                  Jump to Game ▾
                </button>
                {jumpMenuOpen && (
                  <>
                    <button type="button" aria-label="Close jump menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setJumpMenuOpen(false)} />
                    <div className={`absolute right-0 top-10 z-40 w-[min(20rem,calc(100vw-2rem))] max-h-64 overflow-y-auto rounded-2xl border p-2 shadow-2xl space-y-1.5 ${
                      isLight ? 'bg-white border-slate-200' : 'bg-slate-950 border-slate-700'
                    }`}>
                      {orderedGames.map((game) => {
                        const roots = getGamePlayers(game);
                        const forRoots = roots.reduce((sum, player) => sum + (player.myShares || 0), 0);
                        const againstRoots = roots.reduce((sum, player) => sum + (player.oppShares || 0), 0);
                        const total = forRoots + againstRoots;
                        const forPct = total ? Math.round((forRoots / total) * 100) : 50;
                        return (
                          <button
                            key={`jump-${game.id}`}
                            type="button"
                            onClick={() => jumpToGame(game.id)}
                            className={`w-full rounded-xl border px-2.5 py-2 text-left ${
                              isLight ? 'border-slate-200 hover:bg-slate-50' : 'border-slate-800 hover:bg-slate-900'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[11px] font-extrabold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                                {game.away} @ {game.home}
                              </span>
                              <span className={`text-[10px] font-black tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                {total} {total === 1 ? 'root' : 'roots'}
                              </span>
                            </div>
                            <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}>
                              <div className="h-full bg-emerald-500" style={{ width: `${forPct}%`, float: 'left' }} />
                              <div className="h-full bg-rose-500" style={{ width: `${100 - forPct}%` }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {orderedGames.map((game) => {
              const activeMatchPlayers = getGamePlayers(game);
              const forRoots = activeMatchPlayers.reduce((sum, player) => sum + (player.myShares || 0), 0);
              const againstRoots = activeMatchPlayers.reduce((sum, player) => sum + (player.oppShares || 0), 0);
              const rootTotal = forRoots + againstRoots;
              const forPct = rootTotal ? Math.round((forRoots / rootTotal) * 100) : 50;
              const liveGame = game.gameStatus === 'IN_PROGRESS' || /\bLIVE\b/i.test(`${game.status || ''} ${game.time || ''}`);
              const awayColor = NFLPrimary(game.away);
              const homeColor = NFLPrimary(game.home);
              return (
                <div
                  key={game.id}
                  ref={(node) => {
                    if (node) gameCardRefs.current.set(game.id, node);
                    else gameCardRefs.current.delete(game.id);
                  }}
                  className={`rounded-2xl overflow-hidden border shadow-sm ${flashGameId === game.id ? 'rootmap-game-flash' : ''} ${
                    isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
                  }`}
                >
                  <div
                    className="h-1.5 w-full"
                    style={{ background: `linear-gradient(90deg, ${awayColor} 0%, ${awayColor} 48%, ${homeColor} 52%, ${homeColor} 100%)` }}
                  />
                  <div className={`px-3 py-2.5 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-extrabold text-sm tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                            <span style={{ color: awayColor }}>{game.away}</span>
                            <span className={`mx-1 tabular-nums ${isLight ? 'text-slate-900' : 'text-white'}`}>{game.awayScore || 0}</span>
                          </span>
                          <span className={`text-[10px] font-black ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>VS</span>
                          <span className={`font-extrabold text-sm tracking-tight text-right ${isLight ? 'text-slate-900' : 'text-white'}`}>
                            <span className={`mr-1 tabular-nums ${isLight ? 'text-slate-900' : 'text-white'}`}>{game.homeScore || 0}</span>
                            <span style={{ color: homeColor }}>{game.home}</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[10px] font-black uppercase tracking-wide ${
                            liveGame
                              ? isLight ? 'text-emerald-700' : 'text-emerald-300'
                              : isLight ? 'text-slate-500' : 'text-slate-400'
                          }`}>
                            {liveGame ? `LIVE ${game.status || game.time || ''}`.replace(/^LIVE\s+LIVE/i, 'LIVE') : (game.status || game.time || 'Scheduled')}
                            {(game.possession || game.isRedZone) ? ` · ${game.possession || 'Ball'}${game.isRedZone ? ' RZ' : ''}` : ''}
                          </span>
                          <span className={`text-[10px] font-black tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            {rootTotal} {rootTotal === 1 ? 'root' : 'roots'}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          <div className={`flex justify-between text-[9px] font-black uppercase tracking-wide ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            <span className={isLight ? 'text-emerald-700' : 'text-emerald-300'}>Root Balance</span>
                            <span>{forRoots} for · {againstRoots} against</span>
                          </div>
                          <div className={`flex h-1.5 overflow-hidden rounded-full ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}>
                            <div className="bg-emerald-500" style={{ width: `${forPct}%` }} />
                            <div className="bg-rose-500" style={{ width: `${100 - forPct}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`divide-y ${isLight ? 'divide-slate-100' : 'divide-slate-800/60'}`}>
                    {activeMatchPlayers.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400 italic">
                        No portfolio starters active in this matchup
                      </div>
                    ) : (
                      activeMatchPlayers.map((player) => {
                        const exposure = classifyPlayerExposure(player);
                        const forSide = exposure.kind === 'for' || exposure.kind === 'multiFor';
                        const againstSide = exposure.kind === 'against' || exposure.kind === 'multiAgainst';
                        const isConflict = exposure.kind === 'conflict';
                        const rowAccent = againstSide
                          ? '#e11d48'
                          : forSide
                            ? '#059669'
                            : isConflict
                              ? '#d97706'
                              : '#64748b';
                        const rowKey = player.cardKey || playerCardKey(player.name, player.nflTeam) || player.name;
                        return (
                          <div
                            key={rowKey}
                            onClick={() => setSelectedPlayer(player)}
                            className={`relative px-2.5 py-1.5 cursor-pointer transition ${
                              isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                              style={{ backgroundColor: rowAccent }}
                            />
                            <div className="flex items-center justify-between gap-2 pl-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <PlayerHeadshot key={`${player.name}-${headshotTick}`} name={player.name} team={player.nflTeam} defense={isTeamDefense(player)} size={28} />
                                <div className="min-w-0">
                                  <div className={`font-extrabold text-[12px] truncate leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>{player.name}</div>
                                  <div className={`text-[9px] font-bold whitespace-nowrap ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{playerPosTeamLabel(player)}</div>
                                  <SlateLeaguePills exposure={exposure} isLight={isLight} />
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <LivePoints
                                  player={player}
                                  isLight={isLight}
                                  tone={againstSide ? 'against' : isConflict ? 'cross' : 'for'}
                                  layout="compact"
                                />
                                <SlateExposureBadge exposure={exposure} isLight={isLight} />
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VIEW 3: MATCHUPS */}
        {view === 'all-leagues' && (
          <div className="space-y-3">
            {sortedLeagues.length > 0 && (
              <div className="-mx-1 overflow-x-auto">
                <div className="flex items-center gap-1.5 min-w-max px-1 pb-0.5">
                  {sortedLeagues.map((lg) => {
                    const outlook = matchupOutlook(lg);
                    return (
                      <button
                        key={`jump-league-${lg.id}`}
                        type="button"
                        onClick={() => {
                          const node = document.getElementById(`league-card-${lg.id}`);
                          node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          setFlashGameId(lg.id);
                          window.setTimeout(() => setFlashGameId((current) => (current === lg.id ? null : current)), 1100);
                          tapHaptic();
                        }}
                        className={`shrink-0 h-8 px-2 rounded-full border text-[10px] font-black whitespace-nowrap inline-flex items-center gap-1.5 ${
                          isLight ? 'bg-white text-slate-700 border-slate-200' : 'bg-slate-900 text-slate-200 border-slate-700'
                        }`}
                      >
                        <PlatformBadge platform={lg.platform} isLight={isLight} />
                        <span className="truncate max-w-[9.5rem]">{leagueFilterLabel(lg, sortedLeagues)}</span>
                        <span>· {outlook.myPct}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 min-w-0">
              <div className={`shrink-0 text-[11px] font-black uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                Matchups ({sortedLeagues.length})
              </div>
              <label className="min-w-0 flex-1 flex items-center justify-end gap-1">
                <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                  Sort by
                </span>
                <select
                  value={leagueSort}
                  onChange={(event) => {
                    setLeagueSort(event.target.value);
                    tapHaptic();
                  }}
                  aria-label="Sort by"
                  className={`min-w-0 max-w-[8.5rem] rounded-xl border px-1.5 py-1.5 text-[10px] font-black ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-100'
                  }`}
                >
                  <option value="closest">⚡ Closest</option>
                  <option value="standing">🏆 Standing</option>
                  <option value="win">🎯 Win %</option>
                </select>
              </label>
              {leagues.length > 0 && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={showManageLeagues}
                  onClick={() => {
                    setShowManageLeagues(true);
                    tapHaptic();
                  }}
                  className={`shrink-0 min-h-8 px-2 rounded-xl text-[10px] font-black border inline-flex items-center gap-1 ${
                    isLight
                      ? 'bg-white text-slate-700 border-slate-200'
                      : 'bg-slate-950 text-slate-200 border-slate-700'
                  }`}
                >
                  Manage Leagues
                </button>
              )}
            </div>

            {leagues.length === 0 && (
              <ImportEmptyState isLight={isLight} onImport={() => selectConnectTab('yahoo')} />
            )}
            {leagues.length > 0 && sortedLeagues.length === 0 && (
              <div className={`rounded-2xl px-3 py-4 text-center text-xs font-semibold border ${
                isLight ? 'bg-white border-slate-200 text-slate-500' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}>
                No matchups on this board. Check a league in Manage Leagues.
              </div>
            )}

            {sortedLeagues.map((lg) => {
              const outlook = matchupOutlook(lg);
              const ahead = outlook.myTotal > outlook.oppTotal;
              const behind = outlook.oppTotal > outlook.myTotal;
              const nailbiter = finalSlateNailbiters.has(lg.id)
                || (Math.abs(outlook.myTotal - outlook.oppTotal) <= 10 && leagueHasLivePlayers(lg, games));
              const finalSlate = finalSlateNailbiters.get(lg.id);
              return (
              <div
                key={lg.id}
                id={`league-card-${lg.id}`}
                onClick={() => setActiveLeagueDrawer(lg)}
                className={`rounded-3xl p-4 space-y-3 cursor-pointer border shadow-sm transition ${
                  flashGameId === lg.id ? 'rootmap-game-flash' : ''
                } ${
                  nailbiter
                    ? 'rootmap-nailbiter border-amber-400'
                    : ahead
                    ? isLight
                      ? 'bg-white border-emerald-200 hover:border-emerald-300'
                      : 'bg-gradient-to-b from-slate-900 to-emerald-950/40 border-emerald-900 hover:border-emerald-700'
                    : behind
                      ? isLight
                        ? 'bg-white border-rose-200 hover:border-rose-300'
                        : 'bg-gradient-to-b from-slate-900 to-rose-950/30 border-rose-900 hover:border-rose-700'
                      : isLight
                        ? 'bg-white border-slate-200 hover:border-slate-300'
                        : 'bg-slate-900 border-slate-700 hover:border-slate-600'
                } ${nailbiter ? (isLight ? 'bg-white' : 'bg-slate-900') : ''}`}
              >
                {finalSlate ? (
                  <div
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white"
                    style={{ backgroundColor: finalSlate.outlook === 'danger' ? '#E11D48' : '#0F9D68' }}
                  >
                    NAIL BITER
                  </div>
                ) : nailbiter ? (
                  <div className={`text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
                    Nail Biter
                  </div>
                ) : null}
                <LeagueScoreboard
                  league={lg}
                  isLight={isLight}
                  onRemove={() => setLeaguePendingDelete(lg)}
                />
                <MatchupLineups league={lg} week={selectedWeek} isLight={isLight} />
                <div className={`flex justify-between items-center gap-2 pt-2 border-t text-[11px] ${
                  isLight ? 'border-slate-100 text-slate-500' : 'border-white/10 text-slate-400'
                }`}>
                  <span>{getLeaguePortfolio(lg).length} starters</span>
                  <span className={`font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                    {ahead ? 'Winning' : behind ? 'Trailing' : 'Tied'}
                  </span>
                </div>
              </div>
              );
            })}

            <div className={`rounded-2xl p-4 border space-y-3 shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div>
                <div className={`font-black text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  This device
                </div>
                <p className={`text-xs mt-1 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Leagues stay on this phone. Clearing data disconnects every league saved here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm('Clear All Data / Disconnect Leagues? Every saved league on this device will be removed.');
                  if (!confirmed) return;
                  ['rootmap_leagues', 'rootmap_sleeper_username', 'yahoo_access_token'].forEach((key) => {
                    try { localStorage.removeItem(key); } catch { /* storage can be unavailable */ }
                  });
                  setLeagues([]);
                  setEspnNativeSession(null);
                  setEspnSwid('');
                  setEspnS2('');
                  setSleeperUsername('');
                  setHiddenLeagueIds(new Set());
                  setSyncStatus('All leagues were removed from this device.');
                }}
                className={`w-full min-h-11 px-3 py-2 rounded-xl text-xs font-black border ${
                  isLight ? 'border-rose-300 text-rose-700 bg-rose-50' : 'border-rose-800 text-rose-300 bg-rose-950/40'
                }`}
              >
                Clear All Data / Disconnect Leagues
              </button>
              <a
                href={`${SITE_ORIGIN}/privacy`}
                className={`block text-xs font-bold underline ${isLight ? 'text-slate-600' : 'text-slate-300'}`}
              >
                Privacy policy
              </a>
            </div>
          </div>
        )}
      </main>

      {/* Persistent Bottom Navigation */}
      <nav className={`fixed bottom-0 left-0 right-0 z-40 backdrop-blur-lg border-t max-w-md mx-auto pb-[env(safe-area-inset-bottom)] transition-colors ${
        isLight ? 'bg-white/95 border-slate-200' : 'bg-slate-950/95 border-slate-800'
      }`}>
        <div className="grid grid-cols-3 py-2 px-3 gap-1">
          {[
            { id: 'matchups', label: 'RootMap' },
            { id: 'game-slate', label: 'Game Slate' },
            { id: 'all-leagues', label: 'Matchups' }
          ].map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => goToView(tab.id)}
                className={`min-h-11 py-2 flex items-center justify-center rounded-xl text-xs tracking-tight transition touch-manipulation ${
                  active
                    ? isLight
                      ? 'bg-emerald-600 text-white font-black shadow-md ring-2 ring-emerald-300'
                      : 'bg-emerald-500 text-slate-950 font-black shadow-md ring-2 ring-emerald-300'
                    : isLight
                      ? 'text-slate-500 font-bold hover:text-slate-900'
                      : 'text-slate-500 font-bold hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Unified Player Breakdown Drawer */}
      {selectedPlayer && (
        <div
          onClick={() => setSelectedPlayer(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`border-t sm:border rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl transition-colors ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            
            <div className={`flex justify-between items-start border-b pb-3 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <div>
                <h3 className={`text-lg font-black flex items-center gap-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  <span>{selectedPlayer.name}</span>
                  {selectedPlayer.bigPlay && (
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-black border ${
                      isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}>
                      ⚡ {selectedPlayer.bigPlay}
                    </span>
                  )}
                </h3>
                <div className={`text-xs font-semibold flex flex-wrap items-center gap-2 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <span className="whitespace-nowrap">{playerPosTeamLabel(drawerPlayer)}</span>
                  <span>•</span>
                  <LivePoints player={drawerPlayer} isLight={isLight} />
                  <span>•</span>
                  <span className="font-mono">{drawerPlayer.gameClock}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>

            <div className={`p-3 rounded-xl border flex justify-between items-center text-xs ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
            }`}>
              <span className={`font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Portfolio Net Stance:</span>
              <span className={`font-mono font-black px-2.5 py-0.5 rounded-full border ${
                selectedPlayer.myShares > selectedPlayer.oppShares
                  ? isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? isLight ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-rose-950 text-rose-400 border-rose-800'
                  : isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-950 text-amber-400 border-amber-800'
              }`}>
                {selectedPlayer.myShares > selectedPlayer.oppShares
                  ? `ROOTING FOR (+${selectedPlayer.myShares - selectedPlayer.oppShares})`
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? `ROOTING AGAINST (-${selectedPlayer.oppShares - selectedPlayer.myShares})`
                  : 'PERFECTLY CONFLICTED (0)'}
              </span>
            </div>

            <ExposureFlags player={selectedPlayer} isLight={isLight} />

            <div className="space-y-3">
              <div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex justify-between ${
                  isLight ? 'text-emerald-700' : 'text-emerald-400'
                }`}>
                  <span>Your Roster ({selectedPlayer.myShares} Leagues)</span>
                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ROOTING FOR</span>
                </div>
                {selectedPlayer.myShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.myLeagues.map((item, i) => (
                      <div key={i} className={`rounded-xl px-3 py-2 text-xs flex justify-between items-center border ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-800/60 border-slate-700/50 text-slate-200'
                      }`}>
                        <span className="font-semibold">{item.league}</span>
                        <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {item.opponent}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl p-2.5 text-xs italic text-center border ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                  }`}>
                    Not rostered on any of your active teams
                  </div>
                )}
              </div>

              <div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex justify-between ${
                  isLight ? 'text-rose-700' : 'text-rose-400'
                }`}>
                  <span>Opponent Starters ({selectedPlayer.oppShares} Leagues)</span>
                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ROOTING AGAINST</span>
                </div>
                {selectedPlayer.oppShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.oppLeagues.map((item, i) => (
                      <div key={i} className={`rounded-xl px-3 py-2 text-xs flex justify-between items-center border ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-800/60 border-slate-700/50 text-slate-200'
                      }`}>
                        <span className="font-semibold">{item.league}</span>
                        <span className={`text-[10px] font-bold ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                          Started by {item.opponent}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl p-2.5 text-xs italic text-center border ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                  }`}>
                    Zero opponent exposure across your leagues
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {leaguePendingDelete && (
        <div
          onClick={() => setLeaguePendingDelete(null)}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-league-title"
            className={`rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <h3 id="remove-league-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {leaguePendingDelete.bulk
                ? `Remove ${leaguePendingDelete.count} league${leaguePendingDelete.count === 1 ? '' : 's'} from RootMap?`
                : `Remove ${getLeagueDisplayName(leaguePendingDelete)} from RootMap?`}
            </h3>
            <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              The RootMap board updates as soon as {leaguePendingDelete.bulk ? 'these leagues are' : 'this league is'} removed. You can import again later.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLeaguePendingDelete(null)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition ${
                  isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                Keep league
              </button>
              <button
                type="button"
                onClick={confirmRemoveLeague}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-lg transition"
              >
                Remove league
              </button>
            </div>
          </div>
        </div>
      )}

      {showSortSheet && (
        <div
          onClick={() => setShowSortSheet(false)}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end justify-center"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sort-filter-title"
            className={`border-t rounded-t-3xl p-5 max-w-md w-full max-h-[min(92vh,44rem)] overflow-y-auto space-y-4 shadow-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom))] ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <h3 id="sort-filter-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Sort
            </h3>
            <div>
              <div className={`text-[10px] font-black uppercase tracking-wider mb-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Week
              </div>
              <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 18 }, (_, index) => index + 1).map((week) => {
                  const selected = Number(slateMeta.week) === week;
                  return (
                    <button
                      key={week}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => chooseWeek(week)}
                      className={`h-8 rounded-lg text-[11px] font-black border ${
                        selected
                          ? isLight ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-950 text-emerald-300 border-emerald-600'
                          : isLight ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      {week}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              {[
                { id: 'slate', icon: '🏈', label: 'Game Slate', detail: 'Live first, then kickoff time: Thursday, Sunday morning, 1:00, 4:00, Sunday night, Monday night. Final, then bye week.', defaultSort: true },
                { id: 'livePoints', icon: '⚡', label: 'Most Live Points', detail: 'Leaderboard by points already scored.' },
                { id: 'boom', icon: '🚀', label: 'Points Above Projection', detail: 'Top booms and value added.' },
                { id: 'exposure', icon: '🔥', label: 'Portfolio Exposure', detail: 'Most starts plus opponents.' },
                { id: 'projected', icon: '🎯', label: 'Highest Projected', detail: 'Biggest projected totals.' }
              ].map((option) => {
                const selected = sortMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setSortMode(option.id);
                      tapHaptic();
                    }}
                    className={`w-full text-left rounded-2xl border px-3 py-2.5 flex items-start gap-2 ${
                      selected
                        ? isLight ? 'bg-emerald-50 border-emerald-400' : 'bg-emerald-950/50 border-emerald-600'
                        : isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <span aria-hidden="true">{option.icon}</span>
                    <span className="min-w-0">
                      <span className={`block text-xs font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {option.label}
                        {option.defaultSort && (
                          <span className={`ml-1.5 text-[9px] uppercase tracking-wide ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>Default</span>
                        )}
                      </span>
                      <span className={`block text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{option.detail}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <h3 className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>Filter</h3>
            <div className="space-y-2">
              {[
                { key: 'liveOnly', label: 'Live On Field Only' },
                { key: 'redZoneOnly', label: 'Red Zone Only' },
                { key: 'outperformers', label: 'Outperformers (+4.0)' },
                { key: 'conflicted', label: 'Conflicted Only' },
                { key: 'doubleDown', label: 'Double Down (2X+)' },
                { key: 'hideFinal', label: 'Hide Completed Games' }
              ].map((option) => {
                const on = boardFilters[option.key];
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => {
                      setBoardFilters((current) => ({ ...current, [option.key]: !current[option.key] }));
                      tapHaptic();
                    }}
                    className={`w-full flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-xs font-black ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-950 border-slate-800 text-white'
                    }`}
                  >
                    {option.label}
                    <span className={`w-10 h-6 rounded-full p-0.5 transition ${on ? 'bg-emerald-500' : isLight ? 'bg-slate-300' : 'bg-slate-700'}`}>
                      <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${on ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>
                );
              })}
            </div>
            <h3 className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>Push Notifications</h3>
            <button
              type="button"
              role="switch"
              aria-checked={zeroProjAlerts}
              onClick={() => {
                const next = !zeroProjAlerts;
                setZeroProjAlerts(next);
                setAlertPrefs((current) => ({ ...current, lineupRescue: next }));
                if (next) prepareZeroProjectionAlerts({ request: true });
                tapHaptic();
              }}
              className={`w-full flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left ${
                isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-950 border-slate-800 text-white'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-black">Zero Projection / Inactive Starter Alerts</span>
                <span className={`block text-[11px] mt-0.5 font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Warns when a starter is projected at 0.0 before kickoff.
                </span>
              </span>
              <span className={`w-10 h-6 rounded-full p-0.5 transition shrink-0 ${zeroProjAlerts ? 'bg-emerald-500' : isLight ? 'bg-slate-300' : 'bg-slate-700'}`}>
                <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${zeroProjAlerts ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
            <button
              type="button"
              onClick={openMobileSync}
              className="w-full min-h-11 rounded-xl bg-emerald-600 text-white text-xs font-black"
            >
              Export / Sync to Mobile
            </button>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowSortSheet(false);
                  setShowLegend(true);
                }}
                className={`min-h-11 rounded-xl border text-[11px] font-black ${
                  isLight ? 'border-slate-200 text-slate-700' : 'border-slate-700 text-slate-200'
                }`}
              >
                Legend
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSortSheet(false);
                  openYahooIngest();
                }}
                className={`min-h-11 rounded-xl border text-[11px] font-black ${
                  isLight ? 'border-slate-200 text-slate-700' : 'border-slate-700 text-slate-200'
                }`}
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSortSheet(false);
                  toggleLeagueFilter();
                }}
                className={`min-h-11 rounded-xl border text-[11px] font-black ${
                  isLight ? 'border-slate-200 text-slate-700' : 'border-slate-700 text-slate-200'
                }`}
              >
                Leagues{hiddenCount > 0 ? ` ${visibleLeagues.length}/${leagues.length}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {showManageLeagues && createPortal(
        <div
          onClick={() => {
            setShowManageLeagues(false);
            setRenamingLeagueId(null);
            setRenameDraft('');
          }}
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm flex items-end justify-center"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-leagues-title"
            className={`w-full max-w-lg border-t rounded-t-3xl shadow-2xl flex flex-col max-h-[min(92vh,40rem)] pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto mt-3 shrink-0 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
              <div className="min-w-0">
                <h3 id="manage-leagues-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Manage Leagues
                </h3>
                {!isPro && (
                  <div className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide border ${
                    isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-950/50 text-amber-200 border-amber-800'
                  }`}>
                    {freeActiveLabel}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Close manage leagues"
                onClick={() => {
                  setShowManageLeagues(false);
                  setRenamingLeagueId(null);
                  setRenameDraft('');
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-300'
                }`}
              >
                ✕
              </button>
            </div>
            <div className="px-3 pb-2 overflow-y-auto flex-1 min-h-0 space-y-1.5">
              {leagues.length === 0 ? (
                <p className={`px-2 py-6 text-center text-xs font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  No leagues imported yet.
                </p>
              ) : (
                leagues.map((lg) => {
                  const leagueName = getLeagueDisplayName(lg);
                  const onBoard = !hiddenLeagueIds.has(String(lg.id));
                  const detail = teamSeasonDetail(
                    leagueSideRecord(lg, 'my').record,
                    leagueSideRecord(lg, 'my').rank
                  );
                  return (
                    <div
                      key={lg.id}
                      className={`rounded-2xl border px-2.5 ${
                        isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-h-[52px]">
                        <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer py-2">
                          <input
                            type="checkbox"
                            checked={onBoard}
                            onChange={() => toggleLeagueVisibility(lg.id)}
                            aria-label={`${onBoard ? 'Hide' : 'Show'} ${leagueName} on the board`}
                            className="accent-emerald-500 w-5 h-5 shrink-0"
                          />
                          <PlatformPill platform={lg.platform} isLight={isLight} />
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm font-black leading-snug break-words ${isLight ? 'text-slate-900' : 'text-white'}`}>
                              {leagueName}
                            </span>
                            {detail ? (
                              <span className={`block text-[11px] font-semibold mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                {detail}
                              </span>
                            ) : null}
                          </span>
                        </label>
                        <button
                          type="button"
                          aria-label={`Rename ${leagueName}`}
                          title={`Rename ${leagueName}`}
                          onClick={() => {
                            setRenamingLeagueId(lg.id);
                            setRenameDraft(lg.customLeagueName || lg.displayName || platformLeagueTitle(lg) || getUserTeamName(lg));
                          }}
                          className={`w-9 h-9 rounded-xl text-[12px] font-black shrink-0 ${
                            isLight ? 'text-slate-500 hover:bg-white' : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          Aa
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${leagueName}`}
                          title={`Remove ${leagueName}`}
                          onClick={() => setLeaguePendingDelete(lg)}
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isLight ? 'text-rose-600 hover:bg-rose-50' : 'text-rose-400 hover:bg-rose-950/70'
                          }`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      {renamingLeagueId === lg.id && (
                        <form
                          className="pb-2.5 flex gap-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitLeagueRename(lg.id);
                          }}
                        >
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            aria-label={`Custom name for ${leagueName}`}
                            className={`min-w-0 flex-1 rounded-xl border px-2.5 py-2 text-[12px] font-bold ${
                              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-950 border-slate-700 text-slate-100'
                            }`}
                          />
                          <button type="submit" className="rounded-xl bg-emerald-600 px-3 text-[11px] font-black text-white">
                            Save
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {!isPro && (
              <div className="px-4 pt-2">
                <button
                  type="button"
                  onClick={openProUpgrade}
                  className="w-full min-h-11 rounded-xl bg-emerald-600 text-white text-xs font-black"
                >
                  RootMap Pro
                </button>
                <p className={`mt-1.5 text-center text-[10px] font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Free tracks {FREE_ACTIVE_LEAGUE_LIMIT} active leagues. Uncheck one to swap, or upgrade for unlimited.
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showActivePick && createPortal(
        <div
          className="fixed inset-0 z-[90] bg-black/65 backdrop-blur-sm flex items-end justify-center"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="active-pick-title"
            className={`w-full max-w-lg border-t rounded-t-3xl shadow-2xl flex flex-col max-h-[min(92vh,42rem)] pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto mt-3 shrink-0 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <div className="px-4 pt-3 pb-2">
              <h3 id="active-pick-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Pick Your Active Leagues
              </h3>
              <p className={`mt-1 text-[12px] font-semibold leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Free includes {FREE_ACTIVE_LEAGUE_LIMIT} active leagues. Everything stays saved — unchecked leagues hide from the board until you turn them on.
              </p>
              <div className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide border ${
                isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-950/50 text-amber-200 border-amber-800'
              }`}>
                {activePickSelected.size} / {FREE_ACTIVE_LEAGUE_LIMIT} Selected
              </div>
            </div>
            <div className="px-3 pb-2 overflow-y-auto flex-1 min-h-0 space-y-1.5">
              {activePickCandidates.map((lg) => {
                const leagueName = getLeagueDisplayName(lg);
                const checked = activePickSelected.has(String(lg.id));
                const mine = leagueSideRecord(lg, 'my');
                const detail = [getUserTeamName(lg), teamSeasonDetail(mine.record, mine.rank)].filter(Boolean).join(' · ');
                return (
                  <label
                    key={lg.id}
                    className={`flex items-center gap-2.5 min-h-[52px] rounded-2xl border px-3 py-2 cursor-pointer ${
                      checked
                        ? isLight ? 'bg-emerald-50 border-emerald-300' : 'bg-emerald-950/40 border-emerald-700'
                        : isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleActivePickSelection(lg.id)}
                      aria-label={`${checked ? 'Deselect' : 'Select'} ${leagueName}`}
                      className="accent-emerald-500 w-5 h-5 shrink-0"
                    />
                    <PlatformPill platform={lg.platform} isLight={isLight} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-black leading-snug break-words ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {leagueName}
                      </span>
                      {detail ? (
                        <span className={`block text-[11px] font-semibold mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="px-4 pt-2 space-y-2">
              <button
                type="button"
                disabled={activePickSelected.size === 0}
                onClick={confirmActiveLeaguePick}
                className="w-full min-h-11 rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-40"
              >
                {activePickSelected.size === FREE_ACTIVE_LEAGUE_LIMIT
                  ? `Track ${FREE_ACTIVE_LEAGUE_LIMIT} Selected Leagues`
                  : `Track ${activePickSelected.size || FREE_ACTIVE_LEAGUE_LIMIT} Selected League${activePickSelected.size === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                onClick={openProUpgrade}
                className={`w-full min-h-11 rounded-xl border text-xs font-black ${
                  isLight ? 'border-slate-200 text-slate-800 bg-slate-50' : 'border-slate-700 text-slate-100 bg-slate-950'
                }`}
              >
                Track All Leagues with RootMap Pro
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showProUpgrade && createPortal(
        <div
          onClick={() => setShowProUpgrade(false)}
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pro-upgrade-title"
            className={`w-full max-w-md rounded-3xl border shadow-2xl p-5 space-y-3 ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="pro-upgrade-title" className={`text-lg font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  RootMap Pro
                </h3>
                <p className={`mt-1 text-[12px] font-semibold leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Keep every Yahoo, Sleeper, and ESPN league active at once — no swapping, no 2-league cap.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close RootMap Pro"
                onClick={() => setShowProUpgrade(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-300'
                }`}
              >
                ✕
              </button>
            </div>
            <ul className={`space-y-1.5 text-[12px] font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
              <li>• Unlimited active leagues on Matchups and Game Slate</li>
              <li>• Keep family and personal boards on at the same time</li>
              <li>• All imported leagues stay synced without re-scraping</li>
            </ul>
            <button
              type="button"
              onClick={unlockRootMapPro}
              className="w-full min-h-11 rounded-xl bg-emerald-600 text-white text-xs font-black"
            >
              Unlock RootMap Pro
            </button>
            <button
              type="button"
              onClick={() => setShowProUpgrade(false)}
              className={`w-full min-h-10 rounded-xl text-[11px] font-black ${
                isLight ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              Not now
            </button>
          </div>
        </div>,
        document.body
      )}

      {showAlertSheet && (
        <div
          onClick={() => setShowAlertSheet(false)}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end justify-center"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gameday-alerts-title"
            className={`border-t rounded-t-3xl p-5 max-w-md w-full max-h-[min(88vh,36rem)] overflow-y-auto space-y-4 shadow-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom))] ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="gameday-alerts-title" className={`text-base font-extrabold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Game-Day Alerts
                </h3>
                <p className={`mt-1 text-[11px] font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Custom game-day alerts across all connected leagues.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAlertSheet(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  isLight ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (Capacitor.isNativePlatform()) {
                      const { LocalNotifications } = await import('@capacitor/local-notifications');
                      const perm = await LocalNotifications.requestPermissions();
                      setNotifPermission(perm.display || 'denied');
                    } else {
                      const granted = await prepareZeroProjectionAlerts({ request: true });
                      setNotifPermission(granted ? 'granted' : (typeof Notification !== 'undefined' ? Notification.permission : 'denied'));
                    }
                  } catch {
                    setNotifPermission('denied');
                  }
                  tapHaptic();
                }}
                className={`w-full min-h-11 rounded-2xl border text-xs font-black ${
                  isLight
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-emerald-500 text-slate-950 border-emerald-400'
                }`}
              >
                Enable Notifications
              </button>
            )}
            <div className="space-y-2">
              {[
                {
                  key: 'lineupRescue',
                  label: 'Lineup Rescue (Inactives & Bye Weeks)',
                  detail: 'Ping when a starter is inactive, bye, or projected 0.0 before kickoff.'
                },
                {
                  key: 'redZoneTv',
                  label: 'RedZone TV Trigger',
                  detail: 'Highlight when one of your rooted offenses drives inside the 20.'
                },
                {
                  key: 'fourthQuarterSweat',
                  label: '4th Quarter Sweat Alert (±10 Projected Pts)',
                  detail: 'Late-game nudge when a matchup is still within 10 projected points.'
                },
                {
                  key: 'finalSlateNailbiter',
                  label: 'Final-Slate Nail Biter Alerts',
                  detail: 'One pre-kickoff ping 10 minutes before the last Sunday/Monday slate when a matchup can still flip.'
                },
                {
                  key: 'lineupLock',
                  label: 'Lineup Lock Reminders',
                  detail: 'Teal ping 30 minutes before each upcoming kickoff window so starters are set.'
                },
                {
                  key: 'spoilerFreeDelay',
                  label: 'Spoiler-Free Delay (45s)',
                  detail: 'Hold live alert delivery for 45 seconds so you can watch the play first.'
                }
              ].map((option) => {
                const on = Boolean(alertPrefs[option.key]);
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => {
                      const next = !on;
                      setAlertPrefs((current) => ({ ...current, [option.key]: next }));
                      if (option.key === 'lineupRescue') {
                        setZeroProjAlerts(next);
                        if (next) prepareZeroProjectionAlerts({ request: true });
                      }
                      if (next) {
                        prepareCrossFireAlerts();
                        prepareZeroProjectionAlerts({ request: true });
                      }
                      tapHaptic();
                    }}
                    className={`w-full flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-950 border-slate-800 text-white'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-black">{option.label}</span>
                      <span className={`block text-[11px] mt-0.5 font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        {option.detail}
                      </span>
                    </span>
                    <span className={`w-10 h-6 rounded-full p-0.5 transition shrink-0 ${on ? 'bg-emerald-500' : isLight ? 'bg-slate-300' : 'bg-slate-700'}`}>
                      <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${on ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setNotifHistory(readBannerHistory());
                setShowNotifDrawer(true);
                setShowAlertSheet(false);
                tapHaptic();
              }}
              className={`w-full min-h-11 rounded-2xl border text-xs font-black ${
                isLight ? 'border-slate-200 text-slate-800' : 'border-slate-700 text-slate-100'
              }`}
            >
              Open notification drawer
            </button>
          </div>
        </div>
      )}

      {showNotifDrawer && (
        <div
          onClick={() => {
            setShowNotifDrawer(false);
            setNotifUnread(0);
          }}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end justify-center"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notif-drawer-title"
            className={`border-t rounded-t-3xl p-5 max-w-md w-full max-h-[min(88vh,36rem)] overflow-y-auto space-y-3 shadow-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom))] ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="notif-drawer-title" className={`text-base font-extrabold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Notifications
                </h3>
                <p className={`mt-1 text-[11px] font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Recent RootMap alerts in brand colors.
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowAlertSheet(true);
                    setShowNotifDrawer(false);
                    setNotifUnread(0);
                    tapHaptic();
                  }}
                  className={`h-8 px-2.5 rounded-full text-[10px] font-black border ${
                    isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-200 border-slate-700'
                  }`}
                >
                  Alert settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotifDrawer(false);
                    setNotifUnread(0);
                  }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    isLight ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  ✕
                </button>
              </div>
            </div>
            {notifHistory.length === 0 ? (
              <div className={`rounded-2xl border px-3 py-4 text-xs font-semibold ${
                isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800 text-slate-400'
              }`}>
                No alerts yet this session.
              </div>
            ) : (
              notifHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-2xl border px-3 py-2.5 shadow-sm ${
                    entry.surfaceClass || notificationSurfaceClass(entry.category, entry.outlook)
                  }`}
                >
                  <div className="text-[10px] font-black tracking-wide opacity-90">{entry.title}</div>
                  <div className="mt-0.5 text-xs font-semibold leading-snug">{entry.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showLegend && (
        <div
          onClick={() => setShowLegend(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rooting-key-title"
            className={`rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="rooting-key-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Rooting Key
                </h3>
                <p className={`text-xs mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  How exposure badges read across your leagues.
                </p>
              </div>
              <button
                onClick={() => setShowLegend(false)}
                aria-label="Close legend"
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            <ul className="space-y-2">
              {ROOTING_LEGEND.map((item) => (
                <li
                  key={item.title}
                  className={`rounded-2xl px-3 py-2.5 border flex gap-2.5 ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <span className="text-base leading-none pt-0.5" aria-hidden="true">{item.icon}</span>
                  <div>
                    <div className={`text-xs font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{item.title}</div>
                    <div className={`text-[11px] mt-0.5 leading-snug ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>{item.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showLeagueFilter && createPortal(
        <div
          onClick={() => setShowLeagueFilter(false)}
          className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-[2px]"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="league-filter-title"
            style={{ top: filterPos.top, left: filterPos.left }}
            className={`absolute w-[min(18rem,calc(100vw-1rem))] max-h-[min(24rem,70vh)] overflow-y-auto rounded-2xl border shadow-2xl p-3 ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 id="league-filter-title" className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Filter Leagues
                </h3>
                <p className={`text-[11px] mt-0.5 leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Checked leagues stay in Combined Rooting and the game board.
                </p>
              </div>
              <button
                onClick={() => setShowLeagueFilter(false)}
                aria-label="Close league filter"
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            {leagues.length > 1 && (
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => setHiddenLeagueIds(new Set())}
                  disabled={hiddenCount === 0}
                  className={`py-1.5 rounded-xl text-[11px] font-black border disabled:opacity-40 ${
                    isLight ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                  }`}
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setHiddenLeagueIds(new Set(leagues.map((lg) => lg.id)))}
                  disabled={hiddenCount === leagues.length}
                  className={`py-1.5 rounded-xl text-[11px] font-black border disabled:opacity-40 ${
                    isLight ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-slate-950 text-slate-300 border-slate-700'
                  }`}
                >
                  Deselect All
                </button>
              </div>
            )}
            <div className="space-y-1">
              {leagues.length === 0 && (
                <p className={`px-2 py-2 text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  No leagues imported yet.
                </p>
              )}
              {leagues.map((lg) => {
                const checked = !hiddenLeagueIds.has(String(lg.id));
                const leagueName = leagueFilterLabel(lg, leagues);
                return (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-1 rounded-xl ${
                      isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/70'
                    }`}
                  >
                    <label className="flex items-center gap-2.5 px-2 py-2 cursor-pointer min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLeagueVisibility(lg.id)}
                        className="accent-emerald-500 w-4 h-4 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className={`block text-xs font-black truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          {leagueName}
                        </span>
                        <span className={`block text-[10px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                          vs {getLeagueOppName(lg)}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove ${leagueName}`}
                      title={`Remove ${leagueName}`}
                      onClick={() => setLeaguePendingDelete(lg)}
                      className={`mr-1 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isLight ? 'text-rose-600 hover:bg-rose-50' : 'text-rose-400 hover:bg-rose-950/70'
                      }`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={`mt-3 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
              <div className={`text-[10px] font-black uppercase tracking-wider mb-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Sync Setup
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={openMobileSync}
                  className={`py-1.5 rounded-xl text-[11px] font-black border ${
                    isLight ? 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100' : 'bg-slate-950 text-slate-200 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  Sync to phone
                </button>
                <button
                  type="button"
                  onClick={openSetupImport}
                  className={`py-1.5 rounded-xl text-[11px] font-black border ${
                    isLight ? 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100' : 'bg-slate-950 text-slate-200 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  Import Setup
                </button>
              </div>
              {leagueBackupMessage && !showSetupImport && (
                <p className={`mt-1.5 text-[11px] font-black leading-snug ${
                  leagueBackupError
                    ? isLight ? 'text-rose-700' : 'text-rose-300'
                    : isLight ? 'text-emerald-700' : 'text-emerald-300'
                }`}>
                  {leagueBackupMessage}
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showMobileSync && createPortal(
        <div
          onClick={() => setShowMobileSync(false)}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-sync-title"
            className={`rounded-3xl p-5 max-w-md w-full space-y-3 shadow-2xl border max-h-[min(92vh,40rem)] overflow-y-auto ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="mobile-sync-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Export / Sync to Mobile
                </h3>
                <p className={`text-xs mt-1 leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {mobileSyncNote}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMobileSync(false)}
                className={`text-xl leading-none ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-slate-500 hover:text-white'}`}
                aria-label="Close sync to mobile"
              >
                ✕
              </button>
            </div>
            {mobileSyncLink && (
              <textarea
                readOnly
                value={mobileSyncLink}
                className={`w-full h-20 rounded-xl border p-2 text-[11px] font-mono ${
                  isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!mobileSyncLink}
                onClick={async () => {
                  const copied = await copyText(mobileSyncLink);
                  setMobileSyncNote(copied ? 'Phone link copied.' : 'Select the link and copy it.');
                }}
                className="min-h-11 rounded-xl bg-emerald-600 text-white text-[11px] font-black disabled:opacity-40"
              >
                Copy link
              </button>
              <button
                type="button"
                disabled={!mobileSyncCode}
                onClick={async () => {
                  const copied = await copyText(mobileSyncCode);
                  setMobileSyncNote(copied ? 'Setup code copied. Paste it on the phone.' : 'Select the code and copy it.');
                }}
                className={`min-h-11 rounded-xl border text-[11px] font-black disabled:opacity-40 ${
                  isLight ? 'border-slate-200 text-slate-800' : 'border-slate-700 text-slate-200'
                }`}
              >
                Copy code
              </button>
            </div>
            {mobileSyncCode && (
              <textarea
                readOnly
                value={mobileSyncCode}
                className={`w-full h-16 rounded-xl border p-2 text-[11px] font-mono ${
                  isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              />
            )}
            <div className={`pt-2 border-t space-y-2 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
              <div className={`text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Import on this device
              </div>
              <textarea
                value={leagueBackupPaste}
                onChange={(event) => setLeagueBackupPaste(event.target.value)}
                placeholder="Paste a phone link or setup code"
                className={`w-full h-20 rounded-xl border p-2 text-[11px] font-mono ${
                  isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-950 border-slate-700 text-slate-100'
                }`}
              />
              <button
                type="button"
                onClick={saveImportedSetup}
                className={`w-full min-h-11 rounded-xl border text-xs font-black ${
                  isLight ? 'border-slate-200 text-slate-800' : 'border-slate-700 text-slate-200'
                }`}
              >
                Import setup
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showSetupImport && createPortal(
        <div
          onClick={closeSetupImport}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-import-title"
            className={`rounded-3xl p-5 max-w-md w-full space-y-3 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="setup-import-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Import Setup
                </h3>
                <p className={`text-xs mt-1 leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Paste a setup code from another device. Saving replaces the leagues on this device.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSetupImport}
                className={`text-xl leading-none ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-slate-500 hover:text-white'}`}
                aria-label="Close import setup"
              >
                ✕
              </button>
            </div>
            <textarea
              value={leagueBackupPaste}
              onChange={(e) => {
                setLeagueBackupPaste(e.target.value);
                if (leagueBackupMessage) {
                  setLeagueBackupMessage('');
                  setLeagueBackupError(false);
                }
              }}
              placeholder="Paste the setup code here"
              className={`w-full h-36 rounded-xl p-3 text-xs font-mono leading-relaxed resize-y select-text focus:outline-none ${
                isLight
                  ? 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-400'
                  : 'bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:border-emerald-500'
              }`}
            />
            {leagueBackupMessage && (
              <p className={`text-xs font-bold leading-snug ${
                leagueBackupError
                  ? isLight ? 'text-rose-700' : 'text-rose-300'
                  : isLight ? 'text-emerald-700' : 'text-emerald-300'
              }`}>
                {leagueBackupMessage}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeSetupImport}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black border ${
                  isLight ? 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveImportedSetup}
                disabled={!leagueBackupPaste.trim()}
                className="flex-1 py-2.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showSleeper && createPortal(
        <div
          onClick={() => !sleeperBusy && closeConnect()}
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sleeper-connect-title"
            className={`rounded-3xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="sleeper-connect-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Connect / Import League
                </h3>
                <p className={`text-xs mt-1 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Enter your Sleeper username. RootMap pulls your 2026 leagues and this week’s starters. No password.
                </p>
              </div>
              <button
                type="button"
                onClick={closeConnect}
                disabled={Boolean(sleeperBusy)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
                aria-label="Close connect"
              >
                ✕
              </button>
            </div>

            {connectTabs}

            <div className="grid grid-cols-[1fr_5.5rem] gap-2">
              <div>
                <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Enter Sleeper Username
                </label>
                <input
                  type="text"
                  value={sleeperUsername}
                  onChange={(e) => {
                    setSleeperUsername(e.target.value);
                    if (sleeperError) setSleeperError('');
                  }}
                  placeholder="Enter Sleeper Username"
                  autoComplete="username"
                  className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-400'
                      : 'bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:border-emerald-500'
                  }`}
                />
              </div>
              <div>
                <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  NFL week
                </label>
                <input
                  type="number"
                  min="1"
                  max="18"
                  value={sleeperWeek}
                  onChange={(e) => setSleeperWeek(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-emerald-400'
                      : 'bg-slate-950 border border-slate-700 text-slate-100 focus:border-emerald-500'
                  }`}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={findSleeperLeagues}
              disabled={Boolean(sleeperBusy) || !sleeperUsername.trim()}
              className={`w-full py-2.5 rounded-xl text-xs font-black border disabled:opacity-40 ${
                isLight
                  ? 'border-emerald-600 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                  : 'border-emerald-600 text-emerald-300 bg-emerald-950 hover:bg-emerald-900'
              }`}
            >
              {sleeperBusy && !sleeperChoices.length ? sleeperBusy : 'Fetch Sleeper Leagues'}
            </button>

            {sleeperChoices.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-[11px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    2026 leagues
                  </p>
                  {sleeperChoices.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const allOn = sleeperChoices.every((league) => sleeperSelected.has(league.id));
                        setSleeperSelected(allOn ? new Set() : new Set(sleeperChoices.map((league) => league.id)));
                      }}
                      className={`text-[11px] font-black ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}
                    >
                      {sleeperChoices.every((league) => sleeperSelected.has(league.id)) ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>
                <div className={`max-h-48 overflow-y-auto rounded-2xl border ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>
                  {sleeperChoices.map((league) => (
                    <label
                      key={league.id}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 ${
                        isLight ? 'border-slate-100 hover:bg-slate-50' : 'border-slate-800 hover:bg-slate-800/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={sleeperSelected.has(league.id)}
                        onChange={() => toggleSleeperLeague(league.id)}
                        className="accent-emerald-500 w-4 h-4 shrink-0"
                      />
                      <span className={`text-xs font-bold truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {league.name}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={saveSleeperSetup}
                  disabled={Boolean(sleeperBusy) || sleeperSelected.size === 0}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-black"
                >
                  {sleeperBusy && sleeperChoices.length ? sleeperBusy : `Sync ${sleeperSelected.size} league${sleeperSelected.size === 1 ? '' : 's'}`}
                </button>
              </div>
            )}

            {sleeperError && (
              <div className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/70 text-rose-300 border-rose-800'
              }`}>
                {sleeperError}
              </div>
            )}
            {syncPhoneButton}
          </div>
        </div>,
        document.body
      )}

      {showEspn && createPortal(
        <div
          onClick={() => !espnBusy && closeEspnConnect()}
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="espn-connect-title"
            className={`rounded-3xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="espn-connect-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Connect / Import League
                </h3>
                <p className={`text-xs mt-1 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Public leagues load from an ID. Sign in on ESPN and this phone can also open private leagues.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEspnConnect}
                disabled={Boolean(espnBusy)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
                aria-label="Close connect"
              >
                ✕
              </button>
            </div>

            {connectTabs}

            {espnLeagueChoices.length > 1 && (
              <div>
                <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Your ESPN leagues
                </label>
                <select
                  value={espnLeagueChoices.some((league) => league.id === espnLeagueId.trim()) ? espnLeagueId.trim() : ''}
                  onChange={(e) => {
                    setEspnLeagueId(e.target.value);
                    setEspnLeague(null);
                    setEspnTeams([]);
                    setEspnTeamId('');
                    if (espnError) setEspnError('');
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-bold focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-red-400'
                      : 'bg-slate-950 border border-slate-700 text-slate-100 focus:border-red-500'
                  }`}
                >
                  <option value="">Choose a league</option>
                  {espnLeagueChoices.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.name ? `${league.name} (${league.id})` : league.id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                ESPN league ID
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={espnLeagueId}
                onChange={(e) => {
                  setEspnLeagueId(e.target.value);
                  setEspnLeague(null);
                  setEspnTeams([]);
                  setEspnTeamId('');
                  if (espnError) setEspnError('');
                }}
                placeholder="12345678"
                className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-red-400'
                    : 'bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:border-red-500'
                }`}
              />
            </div>

            {espnNativeSession && (
              <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                Signed in on ESPN. This phone keeps that session and refreshes the league each week. The password is not saved.
              </p>
            )}

            <div>
              <button
                type="button"
                aria-expanded={espnPrivateOpen}
                onClick={() => setEspnPrivateOpen((open) => !open)}
                className={`w-full text-left text-[11px] font-black ${isLight ? 'text-slate-700' : 'text-slate-200'}`}
              >
                {espnPrivateOpen ? '▾' : '▸'} Private league: SWID and espn_s2
              </button>
              {espnPrivateOpen && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      SWID
                    </label>
                    <input
                      type="text"
                      value={espnSwid}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => {
                        setEspnSwid(e.target.value);
                        setEspnLeague(null);
                        setEspnTeams([]);
                        if (espnError) setEspnError('');
                      }}
                      placeholder="{A1B2C3D4-...}"
                      className={`w-full px-3 py-2 rounded-xl text-xs font-mono select-text focus:outline-none ${
                        isLight
                          ? 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-red-400'
                          : 'bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:border-red-500'
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      espn_s2
                    </label>
                    <input
                      type="text"
                      value={espnS2}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => {
                        setEspnS2(e.target.value);
                        setEspnLeague(null);
                        setEspnTeams([]);
                        if (espnError) setEspnError('');
                      }}
                      placeholder="Long session string"
                      className={`w-full px-3 py-2 rounded-xl text-xs font-mono select-text focus:outline-none ${
                        isLight
                          ? 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-red-400'
                          : 'bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:border-red-500'
                      }`}
                    />
                  </div>
                  <p className={`text-[11px] leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Sign in at ESPN, then copy SWID and espn_s2 from the espn.com cookies. Both are sent with the league request and stay on this phone so weekly refreshes can sign in for you.
                  </p>
                  <a
                    href={ESPN_LOGIN_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex text-[11px] font-black underline ${isLight ? 'text-red-700' : 'text-red-300'}`}
                  >
                    Open ESPN sign-in
                  </a>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Scoring week
                </label>
                <input
                  type="number"
                  min="1"
                  max="18"
                  value={espnWeek}
                  onChange={(e) => {
                    setEspnWeek(e.target.value);
                    setEspnLeague(null);
                    setEspnTeams([]);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-red-400'
                      : 'bg-slate-950 border border-slate-700 text-slate-100 focus:border-red-500'
                  }`}
                />
              </div>
              <div>
                <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Season year
                </label>
                <input
                  type="number"
                  min="2018"
                  max="2035"
                  value={espnSeason}
                  onChange={(e) => {
                    setEspnSeason(e.target.value);
                    setEspnLeague(null);
                    setEspnTeams([]);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-red-400'
                      : 'bg-slate-950 border border-slate-700 text-slate-100 focus:border-red-500'
                  }`}
                />
              </div>
            </div>

            <p className={`text-[11px] leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Public leagues load with the league ID. Private leagues load after you sign in on ESPN, and this phone keeps that session for weekly refreshes.
            </p>

            <button
              type="button"
              onClick={loadEspnLeague}
              disabled={Boolean(espnBusy) || !espnLeagueId.trim()}
              className={`w-full py-2.5 rounded-xl text-xs font-black border disabled:opacity-40 ${
                isLight
                  ? 'border-red-600 text-red-700 bg-red-50 hover:bg-red-100'
                  : 'border-red-600 text-red-300 bg-red-950 hover:bg-red-900'
              }`}
            >
              {espnBusy || 'Load league'}
            </button>

            {espnTeams.length > 0 && (
              <div className="space-y-2">
                <label className={`text-[11px] font-black uppercase tracking-wider block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Select your team
                </label>
                <select
                  value={espnTeamId}
                  onChange={(e) => setEspnTeamId(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-bold focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-red-400'
                      : 'bg-slate-950 border border-slate-700 text-slate-100 focus:border-red-500'
                  }`}
                >
                  {espnTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={saveEspnSetup}
                  className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black"
                >
                  Sync this team
                </button>
              </div>
            )}

            {espnError && (
              <div className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/70 text-rose-300 border-rose-800'
              }`}>
                {espnError}
              </div>
            )}

            <div className={`pt-2 border-t space-y-2 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Private league fallback: on the matchup page, press Ctrl+A, Ctrl+C, and paste it here.
              </p>
              <label className={`text-[11px] font-black uppercase tracking-wider block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                League name
              </label>
              <input
                type="text"
                value={yahooLeagueName}
                onChange={(e) => setYahooLeagueName(e.target.value)}
                placeholder={`League ${leagues.length + 1}`}
                className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-red-400'
                    : 'bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 focus:border-red-500'
                }`}
              />
              <textarea
                value={yahooPaste}
                onChange={(e) => {
                  setYahooPaste(e.target.value);
                  if (yahooIngestError) setYahooIngestError('');
                }}
                placeholder="Paste an ESPN or Yahoo matchup here…"
                className={`w-full h-32 rounded-2xl p-3 text-xs font-mono leading-relaxed resize-y select-text focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-red-400'
                    : 'bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 focus:border-red-500'
                }`}
              />
              {yahooIngestError && (
                <div className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                  isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/70 text-rose-300 border-rose-800'
                }`}>
                  {yahooIngestError}
                </div>
              )}
              <button
                type="button"
                onClick={handleImportYahooMatchup}
                disabled={!yahooPaste.trim()}
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-black"
              >
                Import pasted matchup
              </button>
            </div>
            {syncPhoneButton}
          </div>
        </div>,
        document.body
      )}

      {showYahooIngest && (
        <div
          onClick={() => !isSyncing && closeConnect()}
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="yahoo-connect-title"
            className={`rounded-3xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="yahoo-connect-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Connect / Import League
                </h3>
                <p className={`text-xs mt-1 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {Capacitor.isNativePlatform()
                    ? 'Sign in once. This phone keeps the Yahoo session and refreshes your matchup each week.'
                    : 'Sign in with Yahoo to automatically sync all your leagues and live lineups.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConnect}
                disabled={isSyncing}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
                aria-label="Close connect"
              >
                ✕
              </button>
            </div>

            {connectTabs}

            <button
              type="button"
              onClick={handleConnectYahoo}
              disabled={isSyncing}
              className="w-full min-h-12 rounded-2xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-sm font-black shadow-lg"
            >
              {isSyncing ? 'Connecting...' : (Capacitor.isNativePlatform() ? 'Connect Yahoo' : 'Sign in with Yahoo')}
            </button>

            {syncStatus && (
              isYahooMatchupHint(syncStatus) ? (
                <button
                  type="button"
                  onClick={handleYahooMatchupHintTap}
                  disabled={isSyncing}
                  className="w-full text-xs font-bold rounded-xl px-3 py-3 border bg-[#0D9488] text-white animate-pulse rootmap-pulse-blink border-teal-300 disabled:opacity-70 text-left leading-snug"
                >
                  {syncStatus}
                </button>
              ) : (
                <div
                  role="alert"
                  className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                    isLight
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-[#E11D48] text-white border-[#E11D48]'
                  }`}
                >
                  {syncStatus}
                </div>
              )
            )}

            {syncPhoneButton}
          </div>
        </div>
      )}

      {/* League Matchup Drawer */}
      {activeLeagueDrawer && (
        <div
          onClick={() => setActiveLeagueDrawer(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`border-t sm:border rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl transition-colors ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-7" />
              <div className={`w-12 h-1.5 rounded-full ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
              <button
                onClick={() => setActiveLeagueDrawer(null)}
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            <div className={`border-b pb-3 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <LeagueScoreboard league={activeLeagueDrawer} isLight={isLight} />
            </div>
            <div className="overflow-y-auto space-y-2 py-3">
              {getLeaguePortfolio(activeLeagueDrawer).map((raw, idx) => {
                const p = decorateStoredPlayer(raw, games, liveScores, sleeperPlayers);
                return (
                <div key={idx} className={`rounded-xl p-2.5 flex justify-between items-center text-xs border ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/60 border-slate-700/40'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      isLight ? 'bg-slate-200 text-slate-700' : 'bg-slate-700 text-slate-300'
                    }`}>
                      {p.slot}
                    </span>
                    <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{p.name}</span>
                    <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{p.nflTeam}</span>
                  </div>
                  <LivePoints player={p} isLight={isLight} />
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
