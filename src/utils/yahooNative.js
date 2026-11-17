import { registerPlugin } from '@capacitor/core';
import { resolveNflTeam } from './leagueParser';
import { canonTeamCode, displayPlayerPosition } from './playerIdentity';
import { cleanYahooPlayerName, parseYahooMatchupText } from './yahooPaste';

export const YahooLogin = registerPlugin('YahooLogin');

const YAHOO_SESSION_KEY = 'rootmap_yahoo_session';

function textValue(value) {
  return String(value || '').trim();
}

function isConcreteYahooMatchupUrl(url) {
  return /football\.fantasysports\.yahoo\.com\/f1\/\d+/i.test(String(url || ''));
}

function sessionList(raw) {
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
  return rows
    .map((row) => yahooIdentity(row))
    .filter((identity) => identity.leagueId && identity.matchupUrl);
}

export function readYahooSessions() {
  try {
    return sessionList(JSON.parse(localStorage.getItem(YAHOO_SESSION_KEY) || 'null'));
  } catch {
    return [];
  }
}

export function readYahooSession() {
  const sessions = readYahooSessions();
  return sessions[sessions.length - 1] || null;
}

export function writeYahooSession(session) {
  const identity = yahooIdentity(session);
  // Never persist bare Yahoo home / lobby URLs — they poison later banner taps.
  if (!identity.leagueId || !identity.matchupUrl || !isConcreteYahooMatchupUrl(identity.matchupUrl)) return;
  const next = readYahooSessions().filter((item) => {
    if (identity.matchupUrl && item.matchupUrl === identity.matchupUrl) return false;
    const sameLeague = identity.leagueId && item.leagueId === identity.leagueId;
    const sameTeam = Boolean(identity.teamId && item.teamId && item.teamId === identity.teamId);
    const bothUntagged = Boolean(sameLeague && !identity.teamId && !item.teamId);
    return !(sameTeam || bothUntagged);
  });
  next.push(identity);
  try {
    localStorage.setItem(YAHOO_SESSION_KEY, JSON.stringify(next.length === 1 ? next[0] : next));
  } catch {
    // private mode can block storage
  }
}

export function writeYahooSessions(sessions) {
  (Array.isArray(sessions) ? sessions : []).forEach((session) => writeYahooSession(session));
}

export function yahooIdentity(result) {
  let matchupUrl = textValue(result?.matchupUrl);
  let leagueId = textValue(result?.leagueId);
  let teamId = textValue(result?.teamId);
  const match = matchupUrl.match(/\/f1\/(\d+)(?:\/(\d+))?/);
  if (!leagueId && match) leagueId = match[1];
  if (!teamId && match?.[2]) teamId = match[2];
  const weekMatch = matchupUrl.match(/[?&]week=(\d+)/i);
  const weekQuery = weekMatch ? `?week=${weekMatch[1]}` : '';
  const preferred = leagueId
    ? (teamId
      ? `https://football.fantasysports.yahoo.com/f1/${leagueId}/${teamId}/matchup${weekQuery}`
      : `https://football.fantasysports.yahoo.com/f1/${leagueId}/matchup${weekQuery}`)
    : '';
  // Always prefer a concrete /matchup URL — league home pages do not expose starters.
  if (!matchupUrl || (leagueId && !/\/matchup(?:\/|$|\?)/i.test(matchupUrl))) {
    matchupUrl = preferred;
  }
  const url = preferred || (isConcreteYahooMatchupUrl(matchupUrl) ? matchupUrl : '');
  return {
    leagueId,
    teamId,
    matchupUrl: url,
    leagueName: textValue(result?.leagueName),
    teamName: textValue(result?.teamName || result?.name)
  };
}

export function isYahooSessionExpired(error) {
  const message = `${error?.code || ''} ${error?.message || error || ''}`;
  return message.includes('SESSION_EXPIRED');
}

/** Shown only when silent matchup refresh cannot read starters. */
export const YAHOO_MATCHUP_HINT =
  "Yahoo connected! Tap here to open your Yahoo Matchup tab once so RootMap can load this week's starters.";

export function isYahooMatchupHint(status) {
  const text = String(status || '');
  return text === YAHOO_MATCHUP_HINT
    || /tap here to open your yahoo matchup/i.test(text)
    || /open your matchup once/i.test(text);
}

/**
 * Normalize leagues discovered by the native Yahoo lobby scan (or a single capture).
 */
export function discoverYahooLeagues(result) {
  const rows = Array.isArray(result?.leagues) ? result.leagues : [];
  const fromArray = rows
    .map((row) => yahooIdentity(row))
    .filter((identity) => identity.leagueId && identity.matchupUrl);
  if (fromArray.length) {
    const seen = new Set();
    return fromArray.filter((identity) => {
      const key = `${identity.leagueId}:${identity.teamId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const single = yahooIdentity(result);
  if (single.leagueId && single.matchupUrl) return [single];
  return [];
}

function htmlToMatchupText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|td|th|h\d|section|article|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordFrom(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const match = String(value).match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return { wins: Number(match[1]), losses: Number(match[2]), ties: Number(match[3]) };
}

function rankFrom(value) {
  const match = String(value ?? '').match(/(\d+)/);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function usableName(value, fallback) {
  const text = cleanYahooPlayerName(value) || String(value || '').trim();
  if (!text || /^(my team|opponent|league|matchup|players|standings|yahoo(?:\s+\d+)?)$/i.test(text)) return fallback;
  return text;
}

function isOpponentLabel(value) {
  return /^(?:@|vs\.?|at)\s+[A-Za-z]{2,3}$/i.test(String(value || '').trim());
}

function lineupObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function starterFromStructured(player, side) {
  const name = cleanYahooPlayerName(player?.name);
  if (!name || isOpponentLabel(name)) return null;
  const actualPoints = numberOrNull(player.actualPoints ?? player.points);
  const projPoints = numberOrNull(player.projPoints ?? player.projectedPoints ?? player.projected);
  const teamRaw = player.nflTeam || player.team || '';
  const nflTeam = canonTeamCode(teamRaw)
    || resolveNflTeam(teamRaw)
    || String(teamRaw || '').trim().toUpperCase();
  const slot = player.slot || player.position || '';
  const position = displayPlayerPosition({ position: player.position || slot, slot });
  const isMine = side === 'mine';
  return {
    name,
    nflTeam,
    team: nflTeam,
    position,
    slot,
    points: actualPoints ?? projPoints ?? 0,
    projPoints,
    actualPoints,
    isLive: /^(Q[1-4]|OT|Halftime)/i.test(player.gameClock || ''),
    inRedZone: false,
    gameClock: player.gameClock || 'Scheduled',
    bigPlay: null,
    isStarter: true,
    ownership: isMine ? 1 : 0,
    isThreat: !isMine,
    opponent: null
  };
}

function fromStructured(result) {
  const lineup = lineupObject(result?.lineup);
  if (!lineup) return null;
  const myStarters = (lineup.myStarters || []).map((player) => starterFromStructured(player, 'mine')).filter(Boolean);
  const oppStarters = (lineup.oppStarters || []).map((player) => starterFromStructured(player, 'opp')).filter(Boolean);
  if (!myStarters.length && !oppStarters.length) return null;
  return {
    leagueName: usableName(lineup.leagueName, ''),
    myTeamName: usableName(lineup.myTeamName, ''),
    oppTeamName: usableName(lineup.oppTeamName, ''),
    myRecord: recordFrom(lineup.myRecord),
    oppRecord: recordFrom(lineup.oppRecord),
    myRank: rankFrom(lineup.myRank),
    oppRank: rankFrom(lineup.oppRank),
    myScore: numberOrNull(lineup.myScore),
    oppScore: numberOrNull(lineup.oppScore),
    myProj: null,
    oppProj: null,
    myStarters,
    oppStarters
  };
}

function parsedLineups(pageText, html) {
  const first = parseYahooMatchupText(pageText || '');
  if ((first.myStarters || []).length || (first.oppStarters || []).length) return first;
  if (!html) return null;
  const second = parseYahooMatchupText(htmlToMatchupText(html));
  if ((second.myStarters || []).length || (second.oppStarters || []).length) return second;
  return null;
}

export function leagueFromYahooCapture(result, week) {
  const identity = yahooIdentity(result);
  const parsed = fromStructured(result) || parsedLineups(result?.pageText, result?.html);
  if (!parsed) return null;
  const myStarters = parsed.myStarters || [];
  const oppStarters = parsed.oppStarters || [];
  if (!myStarters.length && !oppStarters.length) return null;
  const myTeamName = usableName(parsed.myTeamName || identity.teamName, 'My Team');
  const oppTeamName = usableName(parsed.oppTeamName, 'Opponent');
  const leagueName = usableName(parsed.leagueName || identity.leagueName, myTeamName);
  const teamKey = identity.teamId ? `${identity.leagueId}-${identity.teamId}` : identity.leagueId;
  return {
    id: teamKey ? `yahoo-${teamKey}` : `yahoo-${Date.now()}`,
    yahooLeagueId: identity.leagueId,
    yahooTeamId: identity.teamId,
    yahooMatchupUrl: identity.matchupUrl,
    name: leagueName,
    myTeamName,
    oppTeamName,
    opponent: oppTeamName,
    platform: 'Yahoo',
    season: '2026',
    lineupWeek: Number(week) || null,
    myScore: parsed.myScore ?? myStarters.reduce((sum, player) => sum + (numberOrNull(player.actualPoints) ?? 0), 0),
    oppScore: parsed.oppScore ?? oppStarters.reduce((sum, player) => sum + (numberOrNull(player.actualPoints) ?? 0), 0),
    myProj: parsed.myProj ?? null,
    oppProj: parsed.oppProj ?? null,
    myRecord: parsed.myRecord || null,
    oppRecord: parsed.oppRecord || null,
    myRank: parsed.myRank ?? null,
    oppRank: parsed.oppRank ?? null,
    userTeam: {
      name: myTeamName,
      starters: myStarters,
      record: parsed.myRecord || null,
      rank: parsed.myRank ?? null
    },
    oppTeam: {
      name: oppTeamName,
      starters: oppStarters,
      record: parsed.oppRecord || null,
      rank: parsed.oppRank ?? null
    },
    portfolio: myStarters,
    threats: oppStarters
  };
}

/**
 * Hidden WebView navigation to the saved matchup URL (uses Yahoo session cookies).
 * Returns a capture payload suitable for leagueFromYahooCapture.
 */
export async function fetchYahooMatchupCapture(session, week) {
  const identity = yahooIdentity(session);
  if (!identity.matchupUrl || !identity.leagueId) {
    throw new Error('A saved Yahoo matchup URL is required.');
  }
  const captured = await YahooLogin.refresh({
    matchupUrl: identity.matchupUrl,
    week: week != null && week !== '' ? String(week) : undefined
  });
  return {
    ...captured,
    leagueId: identity.leagueId || captured?.leagueId || '',
    teamId: identity.teamId || captured?.teamId || '',
    matchupUrl: identity.matchupUrl || captured?.matchupUrl || '',
    leagueName: identity.leagueName || captured?.leagueName || '',
    teamName: identity.teamName || captured?.teamName || ''
  };
}

/**
 * After native login/lobby discovery, silently fetch each league's /matchup and parse starters.
 */
export async function captureAllYahooLeagueMatchups(leagues, week, { onProgress } = {}) {
  const list = (Array.isArray(leagues) ? leagues : [])
    .map((row) => yahooIdentity(row))
    .filter((identity) => identity.leagueId && identity.matchupUrl);
  const imported = [];
  let expired = false;
  let lastError = null;

  for (let index = 0; index < list.length; index += 1) {
    const league = list[index];
    if (typeof onProgress === 'function') {
      onProgress({
        index,
        total: list.length,
        league
      });
    }
    try {
      writeYahooSession(league);
      const refreshed = await fetchYahooMatchupCapture(league, week);
      writeYahooSession(refreshed);
      const parsed = leagueFromYahooCapture({
        ...refreshed,
        leagueName: league.leagueName || refreshed.leagueName,
        teamName: league.teamName || refreshed.teamName
      }, week);
      if (parsed) imported.push(parsed);
    } catch (error) {
      lastError = error;
      if (isYahooSessionExpired(error)) {
        expired = true;
        break;
      }
      console.warn('Yahoo league matchup capture failed', league.leagueId, error);
    }
  }

  return {
    imported,
    expired,
    lastError,
    discoveredCount: list.length
  };
}
