/**
 * Smoke checks for Yahoo matchup identity + fallback hint helpers (no network).
 * Mirrors the pure helpers in src/utils/yahooNative.js (avoids Capacitor ESM import).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/utils/yahooNative.js'), 'utf8');
const appSource = readFileSync(join(root, 'src/App.jsx'), 'utf8');
const openLoginSource = readFileSync(join(root, 'src/utils/openYahooLogin.js'), 'utf8');
const swiftSource = readFileSync(join(root, 'ios/App/App/YahooLoginPlugin.swift'), 'utf8');

assert(source.includes("Yahoo connected! Tap here to open your Yahoo Matchup tab once so RootMap can load this week's starters."), 'hint copy updated');
assert(source.includes('export function isYahooMatchupHint'), 'isYahooMatchupHint exported');
assert(source.includes('/matchup'), 'identity prefers /matchup URLs');
assert(openLoginSource.includes('matchupUrl'), 'openYahooLogin forwards matchupUrl');
assert(appSource.includes('handleYahooMatchupHintTap'), 'banner tap handler exists');
assert(appSource.includes('isYahooMatchupHint(syncStatus)'), 'banner uses hint detector');
assert(appSource.includes('syncYahooLeaguesFromApi'), 'api/sync fallback remains wired');
assert(swiftSource.includes('kickMatchupAfterCookies'), 'native cookie kick exists');
assert(swiftSource.includes('static func isMatchup'), 'native matchup detector exists');
assert(swiftSource.includes('redirectedToMatchup'), 'silent refresh re-nav to matchup');
assert(swiftSource.includes('startURL'), 'login sheet accepts startURL');
assert(swiftSource.includes('teamId: String = ""'), 'matchupURL accepts teamId');

function textValue(value) {
  return String(value || '').trim();
}

function yahooIdentity(result) {
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
  if (!matchupUrl || (leagueId && !/\/matchup(?:\/|$|\?)/i.test(matchupUrl))) {
    matchupUrl = preferred;
  }
  const url = matchupUrl || preferred;
  return { leagueId, teamId, matchupUrl: url };
}

const YAHOO_MATCHUP_HINT =
  "Yahoo connected! Tap here to open your Yahoo Matchup tab once so RootMap can load this week's starters.";

function isYahooMatchupHint(status) {
  const text = String(status || '');
  return text === YAHOO_MATCHUP_HINT
    || /tap here to open your yahoo matchup/i.test(text)
    || /open your matchup once/i.test(text);
}

assert(isYahooMatchupHint(YAHOO_MATCHUP_HINT), 'current hint matches');
assert(isYahooMatchupHint("Yahoo session saved. Open your matchup once so this week's starters can be read."), 'legacy hint matches');
assert(!isYahooMatchupHint('Synced BCliff from Yahoo for Week 11.'), 'success status is not a hint');

const fromHome = yahooIdentity({ leagueId: '12345', teamId: '2', matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345' });
assert(fromHome.matchupUrl.includes('/f1/12345/2/matchup'), `upgraded league home → ${fromHome.matchupUrl}`);

const fromLeagueOnly = yahooIdentity({ leagueId: '999' });
assert(fromLeagueOnly.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/999/matchup', fromLeagueOnly.matchupUrl);

const keepsWeek = yahooIdentity({
  matchupUrl: 'https://football.fantasysports.yahoo.com/f1/111?week=12'
});
assert(keepsWeek.leagueId === '111', keepsWeek.leagueId);
assert(keepsWeek.matchupUrl.includes('/matchup'), keepsWeek.matchupUrl);
assert(keepsWeek.matchupUrl.includes('week=12'), keepsWeek.matchupUrl);

console.log('verify-yahoo-matchup-hint: ok');
