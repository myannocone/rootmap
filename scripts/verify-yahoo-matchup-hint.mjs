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
assert(swiftSource.includes('digYahooJson'), 'matchup extract digs ydb for points/odds');
assert(swiftSource.includes('enrichSide'), 'matchup extract keeps team sides isolated');
assert(swiftSource.includes('attachScores'), 'matchup extract maps proj/actual floats');
assert(swiftSource.includes('myWinOdds'), 'matchup lineup carries win odds');
assert(swiftSource.includes('Finding your leagues'), 'native title reflects discovery');
assert(swiftSource.includes('https://football.fantasysports.yahoo.com/f1"'), 'home loads Fantasy lobby');
assert(swiftSource.includes('function concreteMatchup'), 'lobby scan rewrites league home and team URLs to /matchup');
assert(swiftSource.includes('League home rows have a league id'), 'league home rows are kept');
assert(!swiftSource.includes('if leagueId.isEmpty || teamId.isEmpty { return nil }'), 'missing team id does not drop a league');
assert(swiftSource.includes('websiteDataStore = .default()'), 'Yahoo auth uses WKWebsiteDataStore');
assert(swiftSource.includes('httpCookieStore.getAllCookies'), 'Yahoo auth scrapes the cookie store');
assert(!/oauth|client_id|api\.login\.yahoo\.com/i.test(swiftSource), 'native Yahoo auth is not API OAuth');
assert(source.includes('candidateYahooUrl'), 'identity reads lobby href/url');
assert(source.includes('concreteYahooMatchupUrl'), 'identity builds a concrete /matchup URL');
assert(source.includes('Rewrite league-home'), 'writeYahooSession normalizes before dropping');
assert(source.includes('withoutCoveredLeagueHomes'), 'team URL covers a league-home duplicate');
assert(appSource.includes('liveToast'), 'home uses a single floating toast');
assert(appSource.includes('notifUnread'), 'notification bell tracks unread badge');
assert(appSource.includes('playerEligibleForLiveAlert'), 'live alerts gated on live/final + points');
assert(!appSource.includes('liveBanners.map'), 'inline stacked banners removed from home');

function textValue(value) {
  return String(value || '').trim();
}

function numericYahooId(value, kind) {
  const text = textValue(value);
  if (/^\d+$/.test(text)) return text;
  const pattern = kind === 'team' ? /\.t\.(\d+)/i : /\.l\.(\d+)/i;
  const keyed = text.match(pattern);
  return keyed ? keyed[1] : '';
}

function idsFromYahooUrl(url) {
  const text = textValue(url);
  const match = text.match(/\/f1\/(\d+)(?:\/(\d+))?(?=\/|$|\?|#)/i);
  if (!match) return { leagueId: '', teamId: '' };
  return { leagueId: match[1], teamId: match[2] || '' };
}

function weekFromYahooUrl(url) {
  const weekMatch = textValue(url).match(/[?&]week=(\d+)/i);
  return weekMatch ? weekMatch[1] : '';
}

function concreteYahooMatchupUrl(leagueId, teamId, week) {
  if (!/^\d+$/.test(leagueId || '')) return '';
  const teamPath = /^\d+$/.test(teamId || '') ? `/${teamId}` : '';
  const weekQuery = week ? `?week=${week}` : '';
  return `https://football.fantasysports.yahoo.com/f1/${leagueId}${teamPath}/matchup${weekQuery}`;
}

function isConcreteYahooMatchupUrl(url) {
  return /football\.fantasysports\.yahoo\.com\/f1\/\d+(?:\/\d+)?\/matchup(?:\/|$|\?|#)/i.test(String(url || ''));
}

function candidateYahooUrl(result) {
  const candidates = [result?.matchupUrl, result?.href, result?.url]
    .map((value) => textValue(value))
    .filter(Boolean);
  return candidates.find((url) => /\/f1\/\d+/i.test(url)) || candidates[0] || '';
}

function yahooIdentity(result) {
  const rawUrl = candidateYahooUrl(result);
  const fromUrl = idsFromYahooUrl(rawUrl);
  const leagueId = numericYahooId(result?.leagueId, 'league') || fromUrl.leagueId;
  const teamId = numericYahooId(result?.teamId, 'team') || fromUrl.teamId;
  const matchupUrl = concreteYahooMatchupUrl(leagueId, teamId, weekFromYahooUrl(rawUrl));
  return {
    leagueId,
    teamId,
    matchupUrl,
    leagueName: textValue(result?.leagueName),
    teamName: textValue(result?.teamName || result?.name)
  };
}

function wouldPersistYahooSession(session) {
  const identity = yahooIdentity(session);
  return Boolean(identity.leagueId) && isConcreteYahooMatchupUrl(identity.matchupUrl);
}

function withoutCoveredLeagueHomes(list) {
  const covered = new Set(list.filter((row) => row.teamId).map((row) => row.leagueId));
  return list.filter((row) => row.teamId || !covered.has(row.leagueId));
}

function discoverYahooLeagues(result) {
  const rows = Array.isArray(result?.leagues) ? result.leagues : [];
  const fromArray = withoutCoveredLeagueHomes(rows
    .map((row) => yahooIdentity(row))
    .filter((identity) => identity.leagueId && isConcreteYahooMatchupUrl(identity.matchupUrl)));
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
  if (single.leagueId && isConcreteYahooMatchupUrl(single.matchupUrl)) return [single];
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
assert(discoverYahooLeagues({ matchupUrl: 'https://football.fantasysports.yahoo.com/' }).length === 0, 'bare home discover is empty');
assert(discoverYahooLeagues({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/' }).length === 0, 'bare /f1/ discover is empty');

const alreadyMatchup = yahooIdentity({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345/2/matchup?week=9' });
assert(alreadyMatchup.teamId === '2', alreadyMatchup.teamId);
assert(alreadyMatchup.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/12345/2/matchup?week=9', alreadyMatchup.matchupUrl);
const leagueMatchup = yahooIdentity({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345/matchup' });
assert(leagueMatchup.teamId === '' && leagueMatchup.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/12345/matchup', leagueMatchup.matchupUrl);

const leagueHome = yahooIdentity({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345' });
assert(leagueHome.leagueId === '12345', `league home id ${leagueHome.leagueId}`);
assert(leagueHome.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/12345/matchup', leagueHome.matchupUrl);
assert(wouldPersistYahooSession({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345' }), 'league home is saved');

const teamPage = yahooIdentity({ href: 'https://football.fantasysports.yahoo.com/f1/12345/8' });
assert(teamPage.teamId === '8', `team page id ${teamPage.teamId}`);
assert(teamPage.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/12345/8/matchup', teamPage.matchupUrl);
assert(wouldPersistYahooSession({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/12345/8' }), 'team URL is saved');

const teamWeek = yahooIdentity({ url: 'https://football.fantasysports.yahoo.com/f1/12345/8?week=11' });
assert(teamWeek.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/12345/8/matchup?week=11', teamWeek.matchupUrl);

const keyed = yahooIdentity({ leagueId: '461.l.123456', teamId: '461.l.123456.t.4' });
assert(keyed.leagueId === '123456' && keyed.teamId === '4', `keyed ids ${keyed.leagueId}/${keyed.teamId}`);
assert(keyed.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/123456/4/matchup', keyed.matchupUrl);

assert(!wouldPersistYahooSession({ matchupUrl: 'https://football.fantasysports.yahoo.com/' }), 'bare home is dropped');
assert(!wouldPersistYahooSession({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1' }), 'bare lobby is dropped');
assert(!wouldPersistYahooSession({ matchupUrl: 'https://football.fantasysports.yahoo.com/f1/' }), 'bare /f1/ is dropped');
assert(!wouldPersistYahooSession({ href: 'https://football.fantasysports.yahoo.com/f1' }), 'bare lobby href is dropped');
const lobbyPlusTeam = yahooIdentity({
  matchupUrl: 'https://football.fantasysports.yahoo.com/f1',
  href: 'https://football.fantasysports.yahoo.com/f1/42/3'
});
assert(lobbyPlusTeam.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/42/3/matchup', lobbyPlusTeam.matchupUrl);

const covered = discoverYahooLeagues({
  leagues: [
    { matchupUrl: 'https://football.fantasysports.yahoo.com/f1/42' },
    { href: 'https://football.fantasysports.yahoo.com/f1/42/3' }
  ]
});
assert(covered.length === 1 && covered[0].teamId === '3', `home covered by team ${JSON.stringify(covered)}`);

function swiftString(raw) {
  return raw.replace(/\\(.)/g, (_, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}

const scriptMatch = swiftSource.match(/static let listTeamsScript = """\n([\s\S]*?)\n    """/);
assert(scriptMatch, 'listTeamsScript literal found');
const listTeamsScript = swiftString(scriptMatch[1]);
new Function(listTeamsScript);

function fakeLink(href, text) {
  return {
    href,
    innerText: text || '',
    textContent: text || '',
    getAttribute(name) {
      return name === 'title' || name === 'aria-label' ? (text || '') : '';
    },
    parentElement: null
  };
}

const lobbyLinks = [
  fakeLink('https://football.fantasysports.yahoo.com/f1', 'Fantasy'),
  fakeLink('https://football.fantasysports.yahoo.com/', 'Yahoo'),
  fakeLink('https://football.fantasysports.yahoo.com/f1/321', 'Home Only League'),
  fakeLink('https://football.fantasysports.yahoo.com/f1/654', 'Covered League'),
  fakeLink('https://football.fantasysports.yahoo.com/f1/654/9', 'Covered Team'),
  fakeLink('https://football.fantasysports.yahoo.com/f1/777/4?week=3', 'Keyed Team')
];

globalThis.document = {
  querySelectorAll(selector) {
    if (selector === 'script:not([src])') return [];
    if (selector === 'a[href*="/f1/"]') {
      return lobbyLinks.filter((link) => link.href.includes('/f1/'));
    }
    if (selector === 'a[href]') return lobbyLinks;
    return [];
  }
};
globalThis.window = {
  ydb: {
    league_key: '461.l.777',
    league_name: 'Keyed League',
    team_key: '461.l.777.t.4',
    name: 'Keyed Team',
    url: 'https://football.fantasysports.yahoo.com/f1/777'
  }
};

const discovered = JSON.parse(eval(listTeamsScript));
const byLeague = new Map(discovered.map((row) => [`${row.leagueId}:${row.teamId || ''}`, row]));
assert(!discovered.some((row) => !row.leagueId), 'lobby scan never emits a row without a league id');
assert(discovered.every((row) => /\/f1\/\d+(?:\/\d+)?\/matchup(?:\?|$)/.test(row.matchupUrl)), `every row is a matchup URL ${JSON.stringify(discovered)}`);
assert(!discovered.some((row) => row.matchupUrl === 'https://football.fantasysports.yahoo.com/f1' || row.matchupUrl.endsWith('/f1')), 'bare lobby URL is not saved');
const homeOnly = byLeague.get('321:');
assert(homeOnly?.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/321/matchup', `league home normalized ${homeOnly?.matchupUrl}`);
assert(!byLeague.has('654:'), 'league home is dropped once a team URL exists');
assert(byLeague.get('654:9')?.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/654/9/matchup', byLeague.get('654:9')?.matchupUrl);
const keyedRow = byLeague.get('777:4');
assert(keyedRow?.matchupUrl === 'https://football.fantasysports.yahoo.com/f1/777/4/matchup?week=3', keyedRow?.matchupUrl);

console.log('verify-yahoo-matchup-hint: ok');
