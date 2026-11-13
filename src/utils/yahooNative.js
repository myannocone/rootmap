import { registerPlugin } from '@capacitor/core';
import { cleanYahooPlayerName, parseYahooMatchupText } from './yahooPaste';

export const YahooLogin = registerPlugin('YahooLogin');

const YAHOO_SESSION_KEY = 'rootmap_yahoo_session';

function textValue(value) {
  return String(value || '').trim();
}

function sessionList(raw) {
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
  return rows
    .map((row) => yahooIdentity(row))
    .filter((identity) => identity.matchupUrl || identity.leagueId);
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
  if (!identity.matchupUrl && !identity.leagueId) return;
  const next = readYahooSessions().filter((item) => {
    if (identity.matchupUrl && item.matchupUrl === identity.matchupUrl) return false;
    if (identity.leagueId && item.leagueId === identity.leagueId) {
      if (!identity.teamId || !item.teamId || item.teamId === identity.teamId) return false;
    }
    return true;
  });
  next.push(identity);
  try {
    localStorage.setItem(YAHOO_SESSION_KEY, JSON.stringify(next.length === 1 ? next[0] : next));
  } catch {
    // private mode can block storage
  }
}

export function yahooIdentity(result) {
  const matchupUrl = textValue(result?.matchupUrl);
  let leagueId = textValue(result?.leagueId);
  let teamId = textValue(result?.teamId);
  const match = matchupUrl.match(/\/f1\/(\d+)(?:\/(\d+))?/);
  if (!leagueId && match) leagueId = match[1];
  if (!teamId && match?.[2]) teamId = match[2];
  const url = matchupUrl || (leagueId ? `https://football.fantasysports.yahoo.com/f1/${leagueId}/matchup` : '');
  return { leagueId, teamId, matchupUrl: url };
}

export function isYahooSessionExpired(error) {
  const message = `${error?.code || ''} ${error?.message || error || ''}`;
  return message.includes('SESSION_EXPIRED');
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
  if (!text || /^(my team|opponent|yahoo(?:\s+\d+)?)$/i.test(text)) return fallback;
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
  const isMine = side === 'mine';
  return {
    name,
    nflTeam: String(player.nflTeam || '').toUpperCase(),
    position: player.position || player.slot || 'FLEX',
    slot: player.slot || player.position || 'FLEX',
    points: actualPoints ?? 0,
    projPoints: null,
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
  const myTeamName = usableName(parsed.myTeamName, 'My Team');
  const oppTeamName = usableName(parsed.oppTeamName, 'Opponent');
  const leagueName = usableName(parsed.leagueName, myTeamName);
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
