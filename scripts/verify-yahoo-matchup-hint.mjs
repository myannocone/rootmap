/**
 * Smoke checks for Yahoo matchup identity + multi-league discovery helpers (no network).
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
assert(source.includes('export function discoverYahooLeagues'), 'discoverYahooLeagues exported');
assert(source.includes('export async function captureAllYahooLeagueMatchups'), 'captureAllYahooLeagueMatchups exported');
assert(source.includes('/matchup'), 'identity prefers /matchup URLs');
assert(openLoginSource.includes('matchupUrl'), 'openYahooLogin forwards matchupUrl');
assert(appSource.includes('handleYahooMatchupHintTap'), 'banner tap handler exists');
assert(appSource.includes('ingestYahooLoginResult'), 'shared ingest path exists');
assert(appSource.includes('discoverYahooLeagues'), 'app uses league discovery');
assert(appSource.includes('captureAllYahooLeagueMatchups'), 'app captures all league matchups');
assert(appSource.includes('Could not find any Yahoo leagues'), 'zero-league error toast copy');
assert(swiftSource.includes('finishWithDiscoveredLeagues'), 'native multi-league finish exists');
assert(swiftSource.includes('listTeamsScript'), 'lobby scrape script exists');
assert(swiftSource.includes('App.main'), 'lobby script probes App.main');
assert(swiftSource.includes('window.ydb'), 'lobby script probes ydb');
assert(swiftSource.includes('Finding your leagues'), 'native title reflects discovery');
assert(swiftSource.includes('https://football.fantasysports.yahoo.com/f1"'), 'home loads Fantasy lobby');

function textValue(value) {
  return String(value || '').trim();
}

function isConcreteYahooMatchupUrl(url) {
  return /football\.fantasysports\.yahoo\.com\/f1\/\d+/i.test(String(url || ''));
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
  const url = preferred || (isConcreteYahooMatchupUrl(matchupUrl) ? matchupUrl : '');
  return {
    leagueId,
    teamId,
    matchupUrl: url,
    leagueName: textValue(result?.leagueName),
    teamName: textValue(result?.teamName || result?.name)
  };
}

function discoverYahooLeagues(result) {
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

const YAHOO_MATCHUP_HINT =
  "Yahoo connected! Tap here to open your Yahoo Matchup tab once so RootMap can load this week's starters.";

function isYahooMatchupHint(status) {
  const text = String(status || '');
  return text === YAHOO_MATCHUP_HINT
    || /tap here to open your yahoo matchup/i.test(text)
    || /open your matchup once/i.test(text);
}

assert(isYahooMatchupHint(YAHOO_MATCHUP_HINT), 'current hint matches');
assert(!isYahooMatchupHint('Synced BCliff from Yahoo for Week 11.'), 'success status is not a hint');

const homePoison = yahooIdentity({ matchupUrl: 'https://football.fantasysports.yahoo.com/' });
assert(!homePoison.leagueId, 'bare home has no leagueId');
assert(!homePoison.matchupUrl, `bare home must not invent matchupUrl, got ${homePoison.matchupUrl}`);

const lobbyPoison = yahooIdentity({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1' });
assert(!lobbyPoison.leagueId, 'lobby has no leagueId');
assert(!lobbyPoison.matchupUrl, `lobby must not invent matchupUrl, got ${lobbyPoison.matchupUrl}`);

const fromHome = yahooIdentity({ leagueId: '12345', teamId: '2', matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345' });
assert(fromHome.matchupUrl.includes('/f1/12345/2/matchup'), `upgraded league home → ${fromHome.matchupUrl}`);

const multi = discoverYahooLeagues({
  leagues: [
    { leagueId: '111', teamId: '1', leagueName: 'BCliff Football', teamName: 'YANNACONDA' },
    { leagueId: '222', teamId: '3', leagueName: 'Mantasy', teamName: 'RootMap FC' },
    { leagueId: '111', teamId: '1', leagueName: 'dup' }
  ]
});
assert(multi.length === 2, `deduped leagues ${multi.length}`);
assert(multi[0].matchupUrl.includes('/f1/111/1/matchup'), multi[0].matchupUrl);
assert(multi[1].matchupUrl.includes('/f1/222/3/matchup'), multi[1].matchupUrl);

assert(discoverYahooLeagues({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1' }).length === 0, 'lobby-only discover is empty');

console.log('verify-yahoo-matchup-hint: ok');
