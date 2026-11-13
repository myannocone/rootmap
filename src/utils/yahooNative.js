import { registerPlugin } from '@capacitor/core';
import { parseYahooMatchupText } from './yahooPaste';

export const YahooLogin = registerPlugin('YahooLogin');

const YAHOO_SESSION_KEY = 'rootmap_yahoo_session';

function textValue(value) {
  return String(value || '').trim();
}

export function readYahooSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(YAHOO_SESSION_KEY) || 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const identity = yahooIdentity(raw);
    if (!identity.matchupUrl && !identity.leagueId) return null;
    return identity;
  } catch {
    return null;
  }
}

export function writeYahooSession(session) {
  const identity = yahooIdentity(session);
  if (!identity.matchupUrl && !identity.leagueId) return;
  try {
    localStorage.setItem(YAHOO_SESSION_KEY, JSON.stringify(identity));
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
  const parsed = parsedLineups(result?.pageText, result?.html);
  if (!parsed) return null;
  const myStarters = parsed.myStarters || [];
  const oppStarters = parsed.oppStarters || [];
  if (!myStarters.length && !oppStarters.length) return null;
  const myTeamName = parsed.myTeamName && parsed.myTeamName !== 'My Team'
    ? parsed.myTeamName
    : (identity.leagueId ? `Yahoo ${identity.leagueId}` : 'Yahoo');
  const oppTeamName = parsed.oppTeamName && parsed.oppTeamName !== 'Opponent'
    ? parsed.oppTeamName
    : 'Opponent';
  return {
    id: identity.leagueId ? `yahoo-${identity.leagueId}` : `yahoo-${Date.now()}`,
    yahooLeagueId: identity.leagueId,
    yahooTeamId: identity.teamId,
    yahooMatchupUrl: identity.matchupUrl,
    name: myTeamName,
    myTeamName,
    oppTeamName,
    opponent: oppTeamName,
    platform: 'Yahoo',
    season: '2026',
    lineupWeek: Number(week) || null,
    myScore: parsed.myScore ?? 0,
    oppScore: parsed.oppScore ?? 0,
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
