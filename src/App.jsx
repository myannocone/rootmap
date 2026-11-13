import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import RootMapLogo from './components/Logo';
import { fetchLiveNFLSlate, gamePhase } from './services/espnScoreboard';
import { FALLBACK_NFL_WEEK, getActiveSlate, getSlateByWeek } from './data/nflSchedule';
import { isEspnMatchupText, parseEspnMatchupText, resolveNflTeam } from './utils/leagueParser';
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
import { fetchEspnLeague, listEspnTeams, mapEspnLeague } from './utils/espnDirectApi';
import { ESPN_LOGIN_URL, openNativeEspnLogin, readEspnSession, writeEspnSession } from './utils/espnLogin';
import { openYahooLogin } from './utils/openYahooLogin';
import {
  isYahooSessionExpired,
  leagueFromYahooCapture,
  readYahooSessions,
  writeYahooSession,
  YahooLogin
} from './utils/yahooNative';
import { SITE_ORIGIN } from './utils/siteOrigin';
import { Capacitor } from '@capacitor/core';
import { notifyCrossFire, notifyZeroProjectionAlerts, prepareCrossFireAlerts, prepareZeroProjectionAlerts, tapHaptic } from './utils/nativeFeedback';
import { checkZeroProjectionStarters, starterProjectionStatus } from './utils/zeroProjection';
import { decodeSetupJson, encodeSetupPayload, linkIsLocalOnly, phoneSyncOrigin, setupLinkFor } from './utils/setupSync';

const LEAGUES_STORAGE_KEY = 'rootmap_leagues';
const THEME_STORAGE_KEY = 'rootmap_theme';

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
  { icon: '🟢', title: 'Double Down (+2 or more)', detail: 'Started on multiple of your rosters.' },
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

function getLeagueDisplayName(lg) {
  return lg?.name || lg?.myTeamName || lg?.userTeam?.name || 'My Team';
}

function getUserTeamName(lg) {
  return lg?.myTeamName || lg?.userTeam?.name || getLeagueDisplayName(lg);
}

function fantasyMark(name) {
  const palette = [
    ['#14532d', '#bbf7d0'],
    ['#4c1d95', '#ddd6fe'],
    ['#7f1d1d', '#fecaca'],
    ['#1e3a8a', '#bfdbfe'],
    ['#78350f', '#fde68a'],
    ['#134e4a', '#99f6e4']
  ];
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const initials = `${words[0]?.[0] || 'T'}${words[1]?.[0] || words[0]?.[1] || ''}`.toUpperCase();
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const [bg, fg] = palette[hash % palette.length];
  return { initials, bg, fg };
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

function starterActualLabel(player) {
  const actual = finiteNumber(player?.actualPoints);
  if (actual == null) return '—';
  return scoreText(actual);
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

function matchupOutlook(league) {
  const myLive = finiteNumber(league?.myScore) ?? 0;
  const oppLive = finiteNumber(league?.oppScore) ?? 0;
  const myFull = finiteNumber(league?.myProj);
  const oppFull = finiteNumber(league?.oppProj);
  const myRem = myFull == null ? 0 : Math.max(0, myFull - myLive);
  const oppRem = oppFull == null ? 0 : Math.max(0, oppFull - oppLive);
  const myTotal = myLive + myRem;
  const oppTotal = oppLive + oppRem;
  const sum = myTotal + oppTotal;
  const myPct = sum > 0 ? Math.round((myTotal / sum) * 100) : 50;
  const oppPct = 100 - myPct;
  return { myLive, oppLive, myRem, oppRem, myTotal, oppTotal, myPct, oppPct };
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
  const mine = getLeaguePortfolio(league);
  const opp = getLeagueThreats(league);
  const projected = Boolean(league?.lineupProjected || mine.some((player) => player.projectedStart) || opp.some((player) => player.projectedStart));
  const column = (title, players, align) => (
    <div className={`min-w-0 ${align === 'end' ? 'text-right' : 'text-left'}`}>
      <div className={`text-[9px] font-black uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
        {title}
      </div>
      {players.length === 0 ? (
        <p className={`mt-1 text-[10px] leading-snug ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
          No Week {week} starters saved
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {players.map((player, index) => (
            <li key={`${player.name}-${player.slot || index}`} className="flex items-center justify-between gap-2 min-w-0">
              <div className={`min-w-0 flex-1 ${align === 'end' ? 'text-right' : 'text-left'}`}>
                <div className={`truncate text-[11px] font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{player.name}</div>
                <div className={`truncate text-[9px] font-bold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {player.position || player.slot}{player.nflTeam ? ` · ${player.nflTeam}` : ''}
                </div>
              </div>
              <div className={`w-10 shrink-0 text-right text-[11px] font-black tabular-nums ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {starterActualLabel(player)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className={`space-y-1 border-t pt-2 ${isLight ? 'border-slate-100' : 'border-white/10'}`}>
      <div className={`text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
        {projected ? `Projected Week ${week} starters` : `Week ${week} starters`}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {column(getUserTeamName(league), mine, 'start')}
        {column(getLeagueOppName(league), opp, 'end')}
      </div>
    </div>
  );
}

function LeagueScoreboard({ league, isLight, onRemove }) {
  const myName = getUserTeamName(league);
  const oppName = getLeagueOppName(league);
  const leagueName = getLeagueDisplayName(league);
  const showLeague = Boolean(leagueName);
  const myScore = finiteNumber(league?.myScore) ?? 0;
  const oppScore = finiteNumber(league?.oppScore) ?? 0;
  const myMark = fantasyMark(myName);
  const oppMark = fantasyMark(oppName);
  const mine = leagueSideRecord(league, 'my');
  const opp = leagueSideRecord(league, 'opp');
  const outlook = matchupOutlook(league);
  const scoreClass = (leading) => (
    leading
      ? isLight ? 'text-emerald-700' : 'text-emerald-300'
      : isLight ? 'text-slate-400' : 'text-slate-500'
  );
  const teamSide = (name, record, rank, score, proj, mark, leading, align) => (
    <div className={`min-w-0 flex flex-col gap-1 ${align === 'end' ? 'items-end text-right' : 'items-start text-left'}`}>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-[10px]"
        style={{ backgroundColor: mark.bg, color: mark.fg }}
        aria-hidden="true"
      >
        {mark.initials}
      </div>
      <div className={`w-full min-w-0 font-black text-[13px] leading-tight truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
        {name}
      </div>
      {teamSeasonDetail(record, rank) ? (
        <div className={`w-full min-w-0 truncate text-[10px] font-bold leading-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          {teamSeasonDetail(record, rank)}
        </div>
      ) : null}
      <div className={`font-black text-3xl leading-none tabular-nums ${scoreClass(leading)}`}>
        {scoreText(score)}
      </div>
      {proj != null && (
        <div className={`text-[10px] font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          Proj {scoreText(proj)}
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className={`min-w-0 text-[10px] font-black uppercase tracking-wider truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          {showLeague ? leagueName : 'This week'}
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
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
            isLight ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-purple-950 text-purple-300 border-purple-800'
          }`}>
            {league?.platform || 'League'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {teamSide(myName, mine.record, mine.rank, myScore, league?.myProj, myMark, myScore > oppScore || myScore === oppScore, 'end')}
        <div className={`text-[10px] font-black tracking-[0.2em] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>VS</div>
        {teamSide(oppName, opp.record, opp.rank, oppScore, league?.oppProj, oppMark, oppScore > myScore || myScore === oppScore, 'start')}
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

function normalizeLeague(lg, index = 0) {
  if (!lg || typeof lg !== 'object') return null;
  const portfolio = getLeaguePortfolio(lg).map(cleanListedPlayer);
  const threats = getLeagueThreats(lg).map(cleanListedPlayer);
  const name = getLeagueDisplayName(lg) || `League ${index + 1}`;
  const oppTeamName = getLeagueOppName(lg);
  return {
    ...lg,
    id: lg.id || `lg_${Date.now()}_${index}`,
    name,
    myTeamName: lg.myTeamName || name,
    oppTeamName,
    opponent: lg.opponent || oppTeamName,
    platform: lg.platform || 'Yahoo',
    season: lg.season || '2026',
    myScore: lg.myScore || 0,
    oppScore: lg.oppScore || 0,
    myProj: lg.myProj ?? lg.userTeam?.projectedScore ?? null,
    oppProj: lg.oppProj ?? lg.oppTeam?.projectedScore ?? null,
    portfolio,
    threats,
    starters: portfolio,
    opponentStarters: threats
  };
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
    return leaguesFromJson(raw) || [];
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

function playerCardKey(name, nflTeam) {
  const team = resolveNflTeam(nflTeam);
  return `${String(name || '').trim().toLowerCase()}|${team}`;
}

function knownTeam(value) {
  return resolveNflTeam(value) || '';
}

function buildPlayerMasterIndex(leagueList, games = [], defenseLeagues = null, liveScores = null) {
  const map = new Map();

  const getOrCreate = (name, nflTeam, position, points = 0, isLive = false, inRedZone = false, gameClock = 'Scheduled', bigPlay = null) => {
    const team = knownTeam(nflTeam);
    const key = playerCardKey(name, team);
    if (!map.has(key)) {
      map.set(key, {
        cardKey: key,
        name,
        nflTeam: team || String(nflTeam || '').trim(),
        position,
        points,
        isLive,
        inRedZone,
        gameClock,
        bigPlay,
        myShares: 0,
        myLeagues: [],
        oppShares: 0,
        oppLeagues: []
      });
    }
    const item = map.get(key);
    if (team && !knownTeam(item.nflTeam)) item.nflTeam = team;
    if (points || isLive) item.points = points;
    if (isLive) item.isLive = true;
    if (inRedZone) item.inRedZone = true;
    if (gameClock && gameClock !== 'Scheduled') item.gameClock = gameClock;
    if (bigPlay) item.bigPlay = bigPlay;
    return item;
  };

  const rememberScore = (item, player) => {
    if (player?.projPoints != null && Number.isFinite(Number(player.projPoints))) {
      item.projPoints = Number(player.projPoints);
    }
    if (player?.actualPoints != null && Number.isFinite(Number(player.actualPoints))) {
      item.actualPoints = Number(player.actualPoints);
    }
    if (player?.sleeperId) item.sleeperId = String(player.sleeperId);
    if (player?.scoringKey) item.scoringKey = player.scoringKey;
  };

  (leagueList || []).forEach((lg) => {
    getLeaguePortfolio(lg).forEach((p) => {
      const item = getOrCreate(p.name, p.nflTeam, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay);
      item.myShares += 1;
      item.myLeagues.push({ league: getLeagueDisplayName(lg), opponent: getLeagueOppName(lg) });
      item.isStarter = true;
      item.ownership = p.ownership ?? 1.0;
      rememberScore(item, p);
    });
  });

  (leagueList || []).forEach((lg) => {
    getLeagueThreats(lg).forEach((p) => {
      const item = getOrCreate(p.name, p.nflTeam, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay);
      item.oppShares += 1;
      item.oppLeagues.push({ league: getLeagueDisplayName(lg), opponent: getLeagueOppName(lg) });
      item.isThreat = true;
      rememberScore(item, p);
    });
  });

  markExposureTags(map, defenseLeagues || leagueList, games);
  map.forEach((player) => applyLiveToPlayer(player, games, liveScores));
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
    if (/1:00/.test(text)) return { id: 'early', label: '1:00 PM', rank: 4 };
    if (/4:(00|05|25)/.test(text)) return { id: 'afternoon', label: '4:00 PM', rank: 5 };
    if (/\bmon/i.test(text)) return { id: 'mnf', label: 'Monday Night', rank: 6 };
    if (/\bsun/i.test(text)) return { id: 'snf', label: 'Sunday Night', rank: 6 };
    return { id: 'bye', label: 'Bye Week', rank: 8 };
  }
  if (et.weekday === 'Thu') return { id: 'thursday', label: 'Thursday', rank: 1 };
  if (et.weekday === 'Fri') return { id: 'friday', label: 'Friday', rank: 2 };
  if (et.weekday === 'Sat') return { id: 'saturday', label: 'Saturday', rank: 2 };
  if (et.weekday === 'Sun' && et.minutes < 12 * 60) return { id: 'morning', label: 'Sunday Morning', rank: 3 };
  if (et.weekday === 'Sun' && et.minutes < 16 * 60) return { id: 'early', label: '1:00 PM', rank: 4 };
  if (et.weekday === 'Sun' && et.minutes < 19 * 60) return { id: 'afternoon', label: '4:00 PM', rank: 5 };
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

function passesBoardFilters(player, filters) {
  if (filters?.hideFinal && (player?.gameStatus === 'FINAL')) return false;
  if (filters?.liveOnly && !(player?.isLive || player?.gameStatus === 'IN_PROGRESS')) return false;
  if (filters?.redZoneOnly && !player?.inRedZone) return false;
  return true;
}

function slateBucket(player, sortMode) {
  const slate = slateWindowFor(player);
  if (slate.id === 'bye') return { key: 'bye', label: 'Bye Week', rank: slate.rank };
  if (slate.id === 'final') return { key: 'final', label: 'Final', rank: slate.rank };
  if (sortMode !== 'slate') return { key: 'board', label: '', rank: 0 };
  return { key: slate.id, label: slate.label, rank: slate.rank };
}

function alignedSlateColumns(forPlayers, againstPlayers, sortMode) {
  const buckets = new Map();
  const place = (player, field) => {
    const slate = slateBucket(player, sortMode);
    if (!buckets.has(slate.key)) {
      buckets.set(slate.key, { ...slate, forPlayers: [], againstPlayers: [] });
    }
    buckets.get(slate.key)[field].push(player);
  };
  forPlayers.forEach((player) => place(player, 'forPlayers'));
  againstPlayers.forEach((player) => place(player, 'againstPlayers'));
  return [...buckets.values()].sort((a, b) => a.rank - b.rank);
}

function sideLeagueNames(player, side) {
  const list = side === 'against' ? player?.oppLeagues : player?.myLeagues;
  return [...new Set((list || []).map((item) => item?.league).filter(Boolean))];
}

function applyLiveToPlayer(player, games, liveScores, now = new Date()) {
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
    const live = sleeperLiveNumbers(player, liveScores);
    if (live?.proj != null) player.projPoints = live.proj;
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
  const live = sleeperLiveNumbers(player, liveScores);
  if (live?.proj != null) player.projPoints = live.proj;
  player.zeroProjection = Boolean(starterProjectionStatus(player, { games, liveScores, now })?.zero);
  const storedActual = finiteNumber(player.actualPoints);
  const needsPublicLine = !player.sleeperId && (storedActual == null || storedActual === 0);
  if (live?.actual != null && live.started && phase !== 'UPCOMING' && (player.sleeperId || needsPublicLine)) {
    player.actualPoints = live.actual;
    player.points = live.actual;
  }
  return player;
}

function decorateStoredPlayer(player, games, liveScores) {
  return applyLiveToPlayer({ ...(player || {}) }, games, liveScores);
}

function liveScoreView(player) {
  const actual = finiteNumber(player?.actualPoints);
  const stored = finiteNumber(player?.points);
  const explicitProj = finiteNumber(player?.projPoints);
  const bye = Boolean(player?.isBye || player?.gameStatus === 'BYE');
  const live = !bye && (player?.gameStatus === 'IN_PROGRESS' || Boolean(player?.isLive) || clockIsLive(player?.gameClock));
  const finalGame = !bye && player?.gameStatus === 'FINAL';
  const proj = explicitProj != null
    ? explicitProj
    : (actual == null && stored != null && stored !== 0 ? stored : null);
  const hasActual = actual != null && (live || finalGame);
  const shown = hasActual ? actual : (live ? 0 : (stored ?? 0));
  const delta = hasActual && proj != null ? actual - proj : null;
  return {
    live,
    bye,
    final: finalGame,
    shown,
    proj,
    delta,
    awaiting: live && !hasActual,
    showProj: Boolean((live || finalGame) && proj != null && (live || hasActual))
  };
}

function LivePulse({ size = 6 }) {
  const px = `${size}px`;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: px, height: px }} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-full w-full rounded-full bg-emerald-500" />
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

function LivePoints({ player, isLight, tone = 'for', layout = 'inline' }) {
  const view = liveScoreView(player);
  const [scorePop, setScorePop] = useState(false);
  const previousShown = useRef(null);
  useEffect(() => {
    const shown = view.shown;
    if (previousShown.current != null && shown > previousShown.current + 0.05) {
      setScorePop(true);
      const timer = window.setTimeout(() => setScorePop(false), 420);
      previousShown.current = shown;
      return () => window.clearTimeout(timer);
    }
    previousShown.current = shown;
  }, [view.shown]);
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
  if (layout === 'hero') {
    const scoreLabel = view.bye ? 'Bye' : view.live ? 'Live pts' : view.final ? 'Final pts' : 'Pts';
    return (
      <div className="mt-1.5">
        <div className="flex items-baseline gap-1.5">
          {view.live && <LivePulse size={8} />}
          <span className={`text-[1.7rem] font-black tabular-nums leading-none tracking-tight ${color} ${scorePop ? 'rootmap-score-pop' : ''}`}>
            {view.shown.toFixed(1)}
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
    <div className={`text-right shrink-0 max-w-[9.5rem] leading-tight ${view.live ? (isLight ? 'text-green-600' : 'text-emerald-400') : color}`}>
      <span className="inline-flex items-center justify-end gap-1 font-mono font-black text-xs">
        {view.live && <LivePulse />}
        <span className={scorePop ? 'rootmap-score-pop' : ''}>{view.shown.toFixed(1)} pts</span>
        {deltaText && <span className={`text-[9px] font-black ${deltaColor}`}>{deltaText}</span>}
      </span>
      {view.showProj && (
        <span className={`block font-semibold text-[9px] ${muted}`}>
          {view.awaiting ? `Proj ${view.proj.toFixed(1)}` : `(Proj: ${view.proj.toFixed(1)})`}
        </span>
      )}
    </div>
  );
}

function rosterCardSurface(isLight, isLive, isConflict, isHovered, inRedZone, zeroProj) {
  if (zeroProj && !isLive) {
    return isLight
      ? 'border-rose-500 bg-amber-50 ring-2 ring-inset ring-amber-400'
      : 'border-rose-400 bg-rose-950/40 ring-2 ring-inset ring-amber-400';
  }
  const zone = inRedZone ? 'rootmap-redzone' : '';
  if (isConflict) {
    const pulse = inRedZone ? zone : 'rootmap-crossfire';
    if (isLive) {
      return isLight
        ? `${pulse} border-violet-600 bg-violet-50 ring-2 ring-inset ring-violet-500 ${isHovered ? 'shadow-md' : ''}`
        : `${pulse} border-violet-300 bg-violet-950/50 ring-2 ring-inset ring-violet-300 ${isHovered ? 'shadow-md' : ''}`;
    }
    return isLight
      ? `${pulse} border-violet-500 bg-violet-50 ring-2 ring-violet-400 ${isHovered ? 'shadow-md' : ''}`
      : `${pulse} border-violet-400 bg-violet-950/40 ring-2 ring-violet-400 ${isHovered ? 'shadow-md' : ''}`;
  }
  if (isLive) {
    return isLight
      ? `${zone} border-emerald-600 bg-emerald-50 ring-2 ring-inset ring-emerald-500`
      : `${zone} border-emerald-400 bg-emerald-950/50 ring-2 ring-inset ring-emerald-400`;
  }
  return isLight
    ? `${zone} bg-white border-slate-200 hover:border-slate-300 hover:shadow`
    : `${zone} bg-slate-900 border-slate-800 hover:border-slate-700`;
}

function RosterCard({
  player,
  side,
  isLight,
  isHovered,
  headshotTick,
  stance,
  onSelect,
  onHoverStart,
  onHoverEnd,
  cardRef
}) {
  const isConflict = side === 'cross' || (side === 'for' ? player.oppShares > 0 : player.myShares > 0);
  const shares = side === 'for' ? player.myShares : player.oppShares;
  const live = Boolean(player.isLive || player.gameStatus === 'IN_PROGRESS');
  const accent = getTeamAccent(canonTeam(player.nflTeam) || player.nflTeam);
  const shareColor = side === 'against'
    ? (isLight ? 'text-red-600' : 'text-rose-400')
    : side === 'cross'
      ? 'text-violet-500'
      : (isLight ? 'text-green-600' : 'text-emerald-400');
  return (
    <div
      data-player-name={player.name}
      data-friendly-fire={player.friendlyFire ? 'true' : 'false'}
      data-double-dip={player.doubleDip ? 'true' : 'false'}
      ref={cardRef}
      onClick={onSelect}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`relative w-full min-w-0 overflow-hidden rounded-xl p-2 pl-3 transition active:scale-[0.98] cursor-pointer border shadow-sm touch-manipulation ${rosterCardSurface(isLight, live, isConflict, isHovered, player.inRedZone, player.zeroProjection)}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-1 rounded-full"
        style={{
          backgroundColor: accent.bg,
          boxShadow: live ? `0 0 10px ${accent.bg}` : undefined
        }}
      />
      <div className="flex items-start gap-2">
        <PlayerHeadshot key={`${player.name}-${headshotTick}`} name={player.name} team={player.nflTeam} defense={isTeamDefense(player)} size={36} />
        <div className="min-w-0 flex-1">
          <div className={`font-black text-[13px] leading-snug break-words ${isLight ? 'text-slate-950' : 'text-white'}`}>
            {player.name}
          </div>
          <div className={`text-[10px] font-bold mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            {player.position} · {player.nflTeam}
          </div>
          <ConnotationBadge player={player} isLight={isLight} />
          {player.zeroProjection && (
            <div className="mt-1">
              <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wide bg-amber-400 text-slate-950">
                ⚠️ 0.0 PROJ - CHECK STATUS
              </span>
            </div>
          )}
        </div>
      </div>

      {(player.isBye || player.gameClock || player.inRedZone || player.hasPossession) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {player.isBye && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-slate-600 text-white">
              BYE
            </span>
          )}
          {player.gameClock && !player.isBye && (
            <span className={`text-[10px] font-bold leading-tight break-words ${
              live
                ? isLight ? 'text-emerald-800' : 'text-emerald-200'
                : isLight ? 'text-slate-400' : 'text-slate-500'
            }`}>
              {player.gameClock}
            </span>
          )}
          {player.inRedZone && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-rose-600 text-white tracking-wider">
              RZ
            </span>
          )}
          {player.hasPossession && !player.inRedZone && (
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
              isLight ? 'bg-emerald-600 text-white' : 'bg-emerald-500 text-slate-950'
            }`}>
              Ball
            </span>
          )}
        </div>
      )}

      <LivePoints player={player} isLight={isLight} tone={side === 'against' ? 'against' : side === 'cross' ? 'cross' : 'for'} layout="hero" />

      {player.bigPlay && (
        <div className="mt-1.5">
          <span className={`inline-flex items-center px-1.5 py-0.2 rounded font-mono text-[9px] font-black border ${
            isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          }`}>
            ⚡ {player.bigPlay}
          </span>
        </div>
      )}

      <ExposureFlags player={player} isLight={isLight} />

      {side !== 'cross' && (
        <div className={`flex justify-between items-start gap-1 text-[10px] pt-1 border-t font-mono ${
          live
            ? isLight ? 'border-emerald-200' : 'border-emerald-800/80'
            : isLight ? 'border-slate-100' : 'border-slate-800/80'
        }`}>
          <span className={`min-w-0 font-bold break-words ${shareColor}`}>
            {isConflict ? (
              <>
                <span className="block text-[8px] font-black uppercase tracking-wide">
                  {side === 'against' ? 'Faced in' : 'Started in'}
                </span>
                {sideLeagueNames(player, side).join(', ') || (side === 'against' ? 'Opponent league' : 'Your league')}
              </>
            ) : (
              `${shares} ${shares === 1 ? 'LEAGUE' : 'LEAGUES'}`
            )}
          </span>
          <span className="min-w-0 text-right break-words">{isConflict ? null : stance}</span>
        </div>
      )}
    </div>
  );
}

function getCombinedStance(player) {
  const mine = player?.myShares || 0;
  const opp = player?.oppShares || 0;
  if (mine > 0 && opp > 0) {
    const net = mine - opp;
    const swing = net > 0 ? ` (+${net})` : net < 0 ? ` (${net})` : '';
    return { label: `Cross Fire${swing}`, tone: 'cross' };
  }
  if (mine > 0 && opp === 0) {
    if (mine >= 2) return { label: `Double Down (+${mine})`, tone: 'down' };
    return { label: 'Root For', tone: 'pure' };
  }
  if (opp > 0 && mine === 0) return { label: 'Root Against', tone: 'threat' };
  return { label: 'Neutral / Free Agent', tone: 'neutral' };
}

function canonTeam(team) {
  const key = String(team || '').toUpperCase().trim();
  return TEAM_ALIASES[key] || key;
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
      const card = playerMap.get(playerCardKey(player.name, team));
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

function ConnotationBadge({ player, isLight }) {
  if (!player?.doubleDip && !player?.friendlyFire) return null;
  return (
    <div className="mt-1 space-y-1">
      {player.doubleDip && (
        <div>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-black border text-[8px] leading-tight tracking-wide ${
            isLight ? 'bg-cyan-50 text-amber-700 border-cyan-400' : 'bg-cyan-950/80 text-amber-200 border-cyan-500'
          }`}>
            🎯 DOUBLE DIP
          </span>
          <p className={`mt-0.5 text-[9px] leading-snug font-semibold break-words ${isLight ? 'text-cyan-800' : 'text-cyan-200'}`}>
            Offense vs Opponent DEF (Dual point swing on TDs)
          </p>
        </div>
      )}
      {player.friendlyFire && (
        <div>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-black border text-[8px] leading-tight tracking-wide ${
            isLight ? 'bg-amber-50 text-amber-800 border-amber-400' : 'bg-amber-950/70 text-amber-200 border-amber-500'
          }`}>
            ⚠️ FRIENDLY FIRE
          </span>
          <p className={`mt-0.5 text-[9px] leading-snug font-semibold break-words ${isLight ? 'text-amber-800' : 'text-amber-200'}`}>
            Offense vs Your DEF (Offensive TD reduces defense points)
          </p>
        </div>
      )}
    </div>
  );
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
  return cleanYahooPlayerName(name)
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const [leagueMenuOpen, setLeagueMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState('slate');
  const [boardFilters, setBoardFilters] = useState({ liveOnly: false, redZoneOnly: false, hideFinal: false });
  const [showSortSheet, setShowSortSheet] = useState(false);
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
  const [hiddenLeagueIds, setHiddenLeagueIds] = useState(() => new Set());
  const [filterPos, setFilterPos] = useState({ top: 96, left: 12 });
  const [showSetupImport, setShowSetupImport] = useState(false);
  const [leagueBackupPaste, setLeagueBackupPaste] = useState('');
  const [leagueBackupMessage, setLeagueBackupMessage] = useState('');
  const [leagueBackupError, setLeagueBackupError] = useState(false);
  const [showMobileSync, setShowMobileSync] = useState(false);
  const [mobileSyncLink, setMobileSyncLink] = useState('');
  const [mobileSyncCode, setMobileSyncCode] = useState('');
  const [mobileSyncNote, setMobileSyncNote] = useState('');

  const filterButtonRef = useRef(null);

  const isLight = theme === 'light';

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
    } else if (authError) {
      setSyncStatus(authError);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    return undefined;
  }, []);

  const handleConnectYahoo = async () => {
    setIsSyncing(true);
    setSyncStatus('');
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await openYahooLogin();
        const week = selectedWeek;
        writeYahooSession(result);
        const imported = leagueFromYahooCapture(result, week);
        if (!imported) {
          setIsSyncing(false);
          setSyncStatus('Yahoo session saved. Open your matchup once so this week’s starters can be read.');
          return;
        }
        const normalized = normalizeLeague(imported, leaguesRef.current.length);
        setLeagues((prev) => [
          ...prev.filter((league) => {
            if (league.id === normalized.id) return false;
            if (normalized.yahooLeagueId && league.yahooLeagueId === normalized.yahooLeagueId) {
              if (!normalized.yahooTeamId || !league.yahooTeamId || league.yahooTeamId === normalized.yahooTeamId) return false;
            }
            return true;
          }),
          normalized
        ]);
        setView('matchups');
        setIsSyncing(false);
        closeConnect();
        setSyncStatus(`Synced ${imported.name} from Yahoo for Week ${week}.`);
        return;
      }
      await openYahooLogin();
    } catch (err) {
      setIsSyncing(false);
      const message = String(err?.message || '');
      if (message.toLowerCase().includes('cancel')) return;
      setSyncStatus(message || 'Missing Yahoo Client ID in .env');
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
    const week = Number(selectedWeek);
    if (!week || lineupRefreshRef.current === week) return undefined;
    lineupRefreshRef.current = week;
    let cancelled = false;
    const refreshStoredLineups = async () => {
      const current = leaguesRef.current || [];
      const updates = new Map();
      try {
        const username = localStorage.getItem('rootmap_sleeper_username') || '';
        const sleeperLeagues = current.filter((lg) => lg?.sleeperLeagueId || String(lg?.id || '').startsWith('sleeper-'));
        if (username && sleeperLeagues.length) {
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
        }
      } catch (err) {
        console.warn('Sleeper lineup refresh failed', err);
      }
      const espnSession = readEspnSession();
      for (const lg of current) {
        if (cancelled || !lg?.espnLeagueId || !lg?.espnTeamId) continue;
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
          console.warn('ESPN lineup refresh failed', err);
        }
      }
      if (Capacitor.isNativePlatform()) {
        try {
          const sessions = readYahooSessions().filter((saved) => saved?.matchupUrl);
          let expired = false;
          for (const saved of sessions) {
            if (cancelled || expired) break;
            try {
              const captured = await YahooLogin.refresh({ matchupUrl: saved.matchupUrl, week: String(week) });
              if (cancelled || !captured) continue;
              writeYahooSession({ ...saved, ...captured });
              const imported = leagueFromYahooCapture({ ...saved, ...captured }, week);
              if (imported) updates.set(imported.id, imported);
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
      if (cancelled || !updates.size) return;
      setLeagues((prev) => {
        const used = new Set();
        const next = prev.map((lg) => {
          let updated = updates.get(lg.id);
          if (!updated && lg.yahooLeagueId) {
            updated = [...updates.values()].find((item) => {
              if (!item.yahooLeagueId || item.yahooLeagueId !== lg.yahooLeagueId) return false;
              if (item.yahooTeamId && lg.yahooTeamId) return item.yahooTeamId === lg.yahooTeamId;
              return !item.yahooTeamId || !lg.yahooTeamId;
            });
          }
          if (!updated) return lg;
          used.add(updated.id);
          return normalizeLeague({ ...lg, ...updated, id: lg.id });
        });
        updates.forEach((updated, id) => {
          if (used.has(id) || !String(id).startsWith('yahoo-')) return;
          if (next.some((lg) => lg.id === id || (
            updated.yahooLeagueId
            && lg.yahooLeagueId === updated.yahooLeagueId
            && (!updated.yahooTeamId || !lg.yahooTeamId || lg.yahooTeamId === updated.yahooTeamId)
          ))) return;
          next.push(normalizeLeague(updated));
        });
        return next;
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
    if (!showLegend && !showLeagueFilter && !leaguePendingDelete && !showSetupImport && !showConnect && !showSleeper && !showEspn && !showYahooIngest && !showSortSheet && !showWeekPicker && !showMobileSync) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
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
  }, [showLegend, showLeagueFilter, leaguePendingDelete, showSetupImport, showConnect, showSleeper, showEspn, showYahooIngest, showSortSheet, showWeekPicker, showMobileSync]);

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
      drop.forEach((id) => next.delete(id));
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

  const toggleLeagueVisibility = (leagueId) => {
    setHiddenLeagueIds((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
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
      const savedId = readEspnSession()?.leagueId || '';
      if (savedId) setEspnLeagueId((current) => String(current || '').trim() || savedId);
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
      setLeagues(next);
      setHiddenLeagueIds(new Set());
      setView('matchups');
      closeConnect();
      setSyncStatus(`Synced ${normalized.length} Sleeper league${normalized.length === 1 ? '' : 's'} for Week ${sleeperWeek}.`);
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
        setSyncStatus('Signed in on ESPN. This phone will refresh that league each week.');
        if (leagueId) {
          await loadEspnLeague({ leagueId, swid, espnS2: espnS2Value, teamId });
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
      setLeagues(next);
      setHiddenLeagueIds(new Set());
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
      : (parsed.myTeamName && parsed.myTeamName !== 'My Team' ? parsed.myTeamName : autoName);
    const leagueName = typedName && typedName !== autoName ? typedName : fallbackName;
    const oppTeamName = parsed.oppTeam?.name || parsed.oppTeamName || MISSING_OPPONENT_NAME;
    const myTeamName = espnPaste ? (espnTeamName || leagueName) : (parsed.myTeamName || leagueName);
    const imported = normalizeLeague({
      id: espnPaste ? (parsed.id || `espn-${Date.now()}`) : `lg_${Date.now()}`,
      name: leagueName,
      myTeamName,
      oppTeamName,
      opponent: oppTeamName,
      platform: espnPaste ? 'ESPN' : 'Yahoo',
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

    setLeagues((prev) => [...prev, imported]);
    setView('matchups');
    setYahooIngestError('');
    setYahooPaste('');
    setYahooLeagueName('');
    closeConnect();
    setSyncStatus(`Imported ${myStarters.length} starters and ${oppStarters.length} threats into ${leagueName}.`);
  };

  const visibleLeagues = useMemo(
    () => leagues.filter((lg) => !hiddenLeagueIds.has(lg.id)),
    [leagues, hiddenLeagueIds]
  );

  const hiddenCount = leagues.length - visibleLeagues.length;

  const playerMasterIndex = useMemo(
    () => buildPlayerMasterIndex(visibleLeagues, games, null, liveScores),
    [visibleLeagues, games, liveScores]
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
    if (!zeroProjAlerts || !liveScores) return undefined;
    const found = checkZeroProjectionStarters(leagues, { games, liveScores });
    notifyZeroProjectionAlerts(found);
    return undefined;
  }, [zeroProjAlerts, leagues, games, liveScores]);

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
    if (!previous || !Capacitor.isNativePlatform()) return;
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
    notifyCrossFire({
      name: best.player.name,
      delta: best.delta.toFixed(1),
      mine,
      opp
    });
  }, [playerMasterIndex]);

  const drawerPlayer = selectedPlayer
    ? (
      playerMasterIndex.get(selectedPlayer.cardKey)
      || playerMasterIndex.get(playerCardKey(selectedPlayer.name, selectedPlayer.nflTeam))
      || selectedPlayer
    )
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

  const filterCount = Number(boardFilters.liveOnly) + Number(boardFilters.redZoneOnly) + Number(boardFilters.hideFinal);
  const leagueSortReadyRef = useRef(false);

  useEffect(() => {
    if (leagueSortReadyRef.current || !games.length) return;
    leagueSortReadyRef.current = true;
    const live = games.some((game) => game.gameStatus === 'IN_PROGRESS' || /\bLIVE\b/i.test(`${game.status || ''} ${game.time || ''}`));
    setLeagueSort(live ? 'closest' : 'standing');
  }, [games]);

  const sortedLeagues = useMemo(() => {
    const list = [...leagues];
    list.sort((a, b) => {
      if (leagueSort === 'standing') {
        const ar = Number(leagueSideRecord(a, 'my').rank) || 99;
        const br = Number(leagueSideRecord(b, 'my').rank) || 99;
        if (ar !== br) return ar - br;
      } else if (leagueSort === 'win') {
        const delta = matchupOutlook(b).myPct - matchupOutlook(a).myPct;
        if (delta) return delta;
      } else {
        const ad = Math.abs((finiteNumber(a.myScore) ?? 0) - (finiteNumber(a.oppScore) ?? 0));
        const bd = Math.abs((finiteNumber(b.myScore) ?? 0) - (finiteNumber(b.oppScore) ?? 0));
        if (ad !== bd) return ad - bd;
      }
      return getUserTeamName(a).localeCompare(getUserTeamName(b));
    });
    return list;
  }, [leagues, leagueSort]);

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
              {window.id === 'bye' ? 'Bye Week' : showFinal ? 'Final' : window.label}
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
    if (stance.tone === 'threat') {
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

  return (
    <div className={`min-h-screen pb-[calc(7.5rem+env(safe-area-inset-bottom))] font-sans transition-colors duration-200 ${
      isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
    }`}>
      <div className={`sticky top-0 z-40 max-w-md mx-auto pt-[env(safe-area-inset-top)] ${isLight ? 'bg-white/95' : 'bg-slate-950/95'} backdrop-blur-md`}>
      <header className={`border-b px-3 py-2 space-y-1.5 transition-colors ${
        isLight ? 'border-slate-200 shadow-sm' : 'border-slate-800/80'
      }`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <RootMapLogo className="w-6 h-6 shrink-0" showWordmark={false} />
            <span className={`font-black text-sm tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
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
            <button
              ref={filterButtonRef}
              type="button"
              onClick={() => setShowSortSheet(true)}
              className={`shrink-0 inline-flex h-9 items-center gap-1 rounded-full border px-2.5 text-[10px] font-black whitespace-nowrap ${
                filterCount > 0 || sortMode !== 'slate'
                  ? isLight ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-950 border-white'
                  : isLight ? 'bg-white text-slate-700 border-slate-300' : 'bg-slate-900 text-slate-200 border-slate-700'
              }`}
            >
              Sort & Filter
              {filterCount > 0 && (
                <span className={`rounded-full px-1 text-[9px] ${isLight ? 'bg-white/20' : 'bg-slate-900/10'}`}>{filterCount}</span>
              )}
              <span aria-hidden="true">▾</span>
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
                      setView(view === 'game-slate' ? 'matchups' : 'game-slate');
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
            className={`grid items-end gap-3 px-1 pt-2 ${rootView === 'both' ? 'grid-cols-2' : 'grid-cols-[1fr_auto_1fr]'}`}
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
              className={`min-h-11 text-base font-black tracking-wider uppercase pb-2 border-b-2 transition-colors ${
                rootView !== 'against'
                  ? isLight ? 'text-emerald-700 border-emerald-600' : 'text-emerald-400 border-emerald-500'
                  : isLight ? 'text-slate-400 border-transparent' : 'text-slate-500 border-transparent'
              }`}
            >
              Root For ({forCount})
            </button>
            {rootView !== 'both' && (
              <button
                type="button"
                onClick={() => {
                  setRootView('both');
                  tapHaptic();
                }}
                className={`min-h-11 px-1 pb-2 text-[11px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}
              >
                Both
              </button>
            )}
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
              className={`min-h-11 text-base font-black tracking-wider uppercase pb-2 border-b-2 transition-colors ${
                rootView !== 'for'
                  ? isLight ? 'text-rose-700 border-rose-600' : 'text-rose-400 border-rose-500'
                  : isLight ? 'text-slate-400 border-transparent' : 'text-slate-500 border-transparent'
              }`}
            >
              Root Against ({againstCount})
            </button>
          </div>
        )}
      </header>
      </div>

      {/* Main Container */}
      <main className="max-w-md mx-auto p-3 space-y-3">
        {syncStatus && (
          <div
            role="status"
            className={`px-3 py-2.5 rounded-xl text-xs font-mono font-bold text-center shadow-lg border ${
              /missing|could not|did not/i.test(syncStatus)
                ? 'bg-rose-950/95 text-rose-100 border-rose-600'
                : 'bg-purple-950/90 text-purple-200 border-purple-700'
            }`}
          >
            {syncStatus}
          </div>
        )}

        {/* VIEW 1: MATCHUPS */}
        {view === 'matchups' && leagues.length === 0 && (
          <div className={`rounded-2xl p-5 border text-center space-y-3 shadow-sm ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}>
            <div className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Connect a league on this phone
            </div>
            <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Yahoo sign-in brings every NFL team on that account onto this phone. Each phone keeps its own leagues.
            </p>
            <button
              type="button"
              onClick={() => selectConnectTab('yahoo')}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-black shadow-lg transition"
            >
              + Connect / Import League
            </button>
          </div>
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
                  ? 'Every league is filtered out. Turn one back on in Filter Leagues. Saved rosters stay on this device.'
                  : (boardFilters.liveOnly || boardFilters.redZoneOnly || boardFilters.hideFinal)
                    ? 'No starters match this filter.'
                    : 'No starters in this view.'}
              </div>
            )}

            <div className="relative">
              {rootView === 'both' ? (
                <div className="flex flex-col gap-3">
                  {alignedSlateColumns(myPortfolio, oppThreats, sortMode).map((group) => {
                    const headerClass = `px-1 text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`;
                    const faded = group.key === 'bye' ? 'opacity-60' : group.key === 'final' ? 'opacity-75' : '';
                    const column = (players, side) => (
                      <div className={`flex-1 flex flex-col space-y-3 min-w-0 ${faded}`}>
                        {group.label && players.length > 0 && (
                          <div className={headerClass}>{group.label}</div>
                        )}
                        {players.map((player) => {
                          const cardKey = player.cardKey || player.name;
                          const conflict = (player.myShares || 0) > 0 && (player.oppShares || 0) > 0;
                          return (
                            <RosterCard
                              key={`${side}_${cardKey}`}
                              player={player}
                              side={side}
                              isLight={isLight}
                              isHovered={hoveredConflictPlayer === `${side}_${cardKey}`}
                              headshotTick={headshotTick}
                              stance={renderStance(player)}
                              onSelect={() => setSelectedPlayer(player)}
                              onHoverStart={() => conflict && setHoveredConflictPlayer(`${side}_${cardKey}`)}
                              onHoverEnd={() => setHoveredConflictPlayer(null)}
                            />
                          );
                        })}
                      </div>
                    );
                    return (
                      <div key={group.key} className="flex items-start gap-2">
                        {column(group.forPlayers, 'for')}
                        {column(group.againstPlayers, 'against')}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  {renderBoardColumn(rootView === 'for' ? myPortfolio : oppThreats, rootView)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: GAME SLATE */}
        {view === 'game-slate' && (
          <div className="space-y-3">
            <div className={`rounded-2xl p-3 border flex justify-between items-center gap-3 shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div>
                <div className={`text-xs font-black uppercase tracking-wide ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                  {slateMeta.label || 'NFL Slate'} · {slateMeta.range}
                </div>
                <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Tuesday 6:00 AM ET slate. ESPN scores fill in once a game is posted.
                </div>
                {slateMeta.byes?.length > 0 && (
                  <div className={`text-[11px] mt-1 font-bold ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                    Bye weeks: {slateMeta.byes.join(', ')}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                }`}>
                  Week {slateMeta.week}
                </span>
              </div>
            </div>

            {orderedGames.map(game => {
              const activeMatchPlayers = getGamePlayers(game);
              return (
                <div key={game.id} className={`rounded-2xl overflow-hidden border shadow-sm ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
                }`}>
                  <div className={`px-3.5 py-2.5 border-b flex justify-between items-center text-xs ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{game.away} @ {game.home}</span>
                      <span className={`font-mono text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        ({game.awayScore || 0} - {game.homeScore || 0})
                      </span>
                    </div>
                    <span className={`text-[11px] font-bold text-right ${
                      game.status?.includes('LIVE') 
                        ? isLight ? 'text-emerald-700' : 'text-emerald-400' 
                        : isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      <span className="block">{game.status || game.time}</span>
                      {(game.possession || game.isRedZone) && (
                        <span className={`block text-[9px] font-black uppercase ${game.isRedZone ? 'text-rose-500' : ''}`}>
                          {game.possession ? `${game.possession} ball` : 'Ball'}{game.isRedZone ? ' · RZ' : ''}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className={`divide-y p-1 ${isLight ? 'divide-slate-100' : 'divide-slate-800/60'}`}>
                    {activeMatchPlayers.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400 italic">
                        No portfolio starters active in this matchup
                      </div>
                    ) : (
                      activeMatchPlayers.map(player => (
                        <div
                          key={player.name}
                          onClick={() => setSelectedPlayer(player)}
                          className={`p-2.5 cursor-pointer rounded-xl transition ${
                            isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <PlayerHeadshot key={`${player.name}-${headshotTick}`} name={player.name} team={player.nflTeam} defense={isTeamDefense(player)} size={40} />
                              <div className="min-w-0">
                                <div className={`font-bold text-xs truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>{player.name}</div>
                                <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{player.position} • {player.nflTeam}</div>
                                <ConnotationBadge player={player} isLight={isLight} />
                              <div className="mt-0.5">{renderStance(player)}</div>
                              </div>
                            </div>
                            <div className="text-right font-mono shrink-0">
                              <LivePoints
                                player={player}
                                isLight={isLight}
                                tone={
                                  getCombinedStance(player).tone === 'threat'
                                    ? 'against'
                                    : getCombinedStance(player).tone === 'cross'
                                      ? 'cross'
                                      : 'for'
                                }
                              />
                              <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                {player.myShares > 0
                                  ? `${player.myShares} ${player.myShares === 1 ? 'League' : 'Leagues'}`
                                  : `${player.oppShares} ${player.oppShares === 1 ? 'Opponent' : 'Opponents'}`}
                              </div>
                            </div>
                          </div>
                          <ExposureFlags player={player} isLight={isLight} />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VIEW 3: ALL LEAGUES */}
        {view === 'all-leagues' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => selectConnectTab('yahoo')}
              className="w-full min-h-11 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-black shadow-lg"
            >
              + Connect / Import League
            </button>

            <div className="flex items-center justify-between gap-2">
              <div className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                Connected Leagues ({leagues.length})
              </div>
              <label className="shrink-0 flex items-center">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-medium mr-1.5">Sort by:</span>
                <select
                  value={leagueSort}
                  onChange={(event) => {
                    setLeagueSort(event.target.value);
                    tapHaptic();
                  }}
                  className={`max-w-[11.5rem] rounded-xl border px-2 py-1.5 text-[11px] font-black ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-100'
                  }`}
                >
                  <option value="closest">⚡ Closest Matchup</option>
                  <option value="standing">🏆 League Standing</option>
                  <option value="win">🎯 Highest Win Probability</option>
                </select>
              </label>
            </div>

            {leagues.length > 0 && (
              <div className="relative w-fit max-w-full">
                <button
                  type="button"
                  aria-expanded={leagueMenuOpen}
                  aria-haspopup="listbox"
                  onClick={() => {
                    setLeagueMenuOpen((open) => !open);
                    tapHaptic();
                  }}
                  className={`min-h-9 px-3 rounded-xl text-[11px] font-black border inline-flex items-center gap-1.5 ${
                    isLight
                      ? 'bg-white text-slate-700 border-slate-200'
                      : 'bg-slate-950 text-slate-200 border-slate-700'
                  }`}
                >
                  Manage Leagues
                  <span aria-hidden="true">{leagueMenuOpen ? '▴' : '▾'}</span>
                </button>
                {leagueMenuOpen && (
                  <div
                    role="listbox"
                    aria-label="Manage leagues"
                    className={`absolute left-0 top-full z-20 mt-1 w-56 max-h-64 overflow-y-auto rounded-xl border shadow-xl p-1 ${
                      isLight ? 'bg-white border-slate-200' : 'bg-slate-950 border-slate-700'
                    }`}
                  >
                    {leagues.map((lg) => {
                      const leagueName = getLeagueDisplayName(lg);
                      const onBoard = !hiddenLeagueIds.has(lg.id);
                      return (
                        <div key={lg.id} className="flex items-center gap-1 rounded-lg">
                          <label className="flex items-center gap-2 min-w-0 flex-1 px-2 py-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={onBoard}
                              onChange={() => toggleLeagueVisibility(lg.id)}
                              aria-label={`${onBoard ? 'Hide' : 'Show'} ${leagueName} on the board`}
                              className="accent-emerald-500 w-3.5 h-3.5 shrink-0"
                            />
                            <span className={`truncate text-xs font-bold ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
                              {leagueName}
                            </span>
                          </label>
                          <button
                            type="button"
                            aria-label={`Remove ${leagueName}`}
                            title={`Remove ${leagueName}`}
                            onClick={() => setLeaguePendingDelete(lg)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              isLight ? 'text-rose-600 hover:bg-rose-50' : 'text-rose-400 hover:bg-rose-950/70'
                            }`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {leagues.length === 0 && (
              <div className={`rounded-2xl p-5 border text-center space-y-3 shadow-sm ${
                isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
              }`}>
                <div className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Connect a Yahoo, Sleeper, or ESPN league
                </div>
              </div>
            )}

            {sortedLeagues.map((lg) => {
              const myScore = finiteNumber(lg.myScore) ?? 0;
              const oppScore = finiteNumber(lg.oppScore) ?? 0;
              const ahead = myScore > oppScore;
              const behind = oppScore > myScore;
              const nailbiter = Math.abs(myScore - oppScore) <= 10 && leagueHasLivePlayers(lg, games);
              return (
              <div
                key={lg.id}
                onClick={() => setActiveLeagueDrawer(lg)}
                className={`rounded-3xl p-4 space-y-3 cursor-pointer border shadow-sm transition ${
                  hiddenLeagueIds.has(lg.id) ? 'opacity-60' : ''
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
                {nailbiter && (
                  <div className={`text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                    Nailbiter
                  </div>
                )}
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
                  <span className={`font-bold ${
                    hiddenLeagueIds.has(lg.id)
                      ? isLight ? 'text-slate-400' : 'text-slate-500'
                      : isLight ? 'text-emerald-700' : 'text-emerald-400'
                  }`}>
                    {hiddenLeagueIds.has(lg.id) ? 'Off the board' : ahead ? 'Winning' : behind ? 'Trailing' : 'Tied'}
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
            { id: 'all-leagues', label: 'All Leagues' }
          ].map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
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
                  <span>{drawerPlayer.position} • {drawerPlayer.nflTeam}</span>
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
                const checked = !hiddenLeagueIds.has(lg.id);
                const leagueName = getLeagueDisplayName(lg);
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
              <div role="alert" className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/70 text-rose-200 border-rose-700'
              }`}>
                {syncStatus}
              </div>
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
                const p = decorateStoredPlayer(raw, games, liveScores);
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
