import { randomBytes } from 'node:crypto';

const YAHOO_AUTH = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';
const BENCH = new Set(['BN', 'IR', 'IR+', 'NA', 'TAXI']);
const STATE_COOKIE = 'yahoo_oauth_state';

export function yahooRedirectUri() {
  const configured = String(process.env.YAHOO_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const appUrl = String(process.env.APP_URL || 'https://rootmap-wine.vercel.app').trim().replace(/\/+$/, '');
  return `${appUrl}/api/auth/callback`;
}

export function collectionItems(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  return Object.keys(node)
    .filter((key) => key !== 'count' && /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => node[key]);
}

export function mergeYahoo(value) {
  if (Array.isArray(value)) {
    return value.reduce((acc, part) => Object.assign(acc, mergeYahoo(part)), {});
  }
  if (value && typeof value === 'object') return { ...value };
  return {};
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function selectedSlot(player) {
  const selected = player?.selected_position;
  const list = Array.isArray(selected) ? selected : (selected ? [selected] : []);
  const hit = list.find((entry) => entry && entry.position) || list[0];
  return String(hit?.position || player?.display_position || player?.primary_position || '').toUpperCase();
}

export function mapYahooPlayer(player, week) {
  const merged = mergeYahoo(player?.player || player);
  const slot = selectedSlot(merged);
  if (!slot || BENCH.has(slot)) return null;
  const rawName = merged.name?.full
    || [merged.name?.first, merged.name?.last].filter(Boolean).join(' ')
    || '';
  const name = String(rawName).trim();
  if (!name) return null;
  const position = String(merged.display_position || merged.primary_position || slot).toUpperCase();
  const isDefense = position === 'DEF' || slot === 'DEF';
  const nflTeam = String(merged.editorial_team_abbr || '').toUpperCase();
  const displayName = isDefense && !/d\/st|defense/i.test(name) ? `${name} D/ST` : name;
  const actual = finiteNumber(merged.player_points?.total);
  const proj = finiteNumber(merged.player_projected_points?.total);
  return {
    name: displayName,
    slot: isDefense ? 'D/ST' : slot,
    position: isDefense ? 'D/ST' : position,
    nflTeam,
    team: nflTeam,
    points: actual != null ? actual : (proj ?? 0),
    projPoints: proj,
    actualPoints: actual,
    isStarter: true,
    inRedZone: false,
    gameClock: `Week ${week}`,
    bigPlay: null
  };
}

export function parseLeagues(body) {
  const leagues = [];
  collectionItems(body?.fantasy_content?.users).forEach((entry) => {
    const user = mergeYahoo(entry?.user);
    collectionItems(user.games).forEach((gameEntry) => {
      const game = mergeYahoo(gameEntry?.game);
      collectionItems(game.leagues).forEach((leagueEntry) => {
        const league = mergeYahoo(leagueEntry?.league);
        if (!league.league_key) return;
        leagues.push({
          leagueKey: String(league.league_key),
          name: String(league.name || 'Yahoo League'),
          week: finiteNumber(league.current_week) || finiteNumber(game.current_week) || null,
          season: String(league.season || game.season || '')
        });
      });
    });
  });
  return leagues;
}

export function parseTeams(body) {
  const teams = [];
  collectionItems(body?.fantasy_content?.users).forEach((entry) => {
    const user = mergeYahoo(entry?.user);
    collectionItems(user.games).forEach((gameEntry) => {
      const game = mergeYahoo(gameEntry?.game);
      collectionItems(game.teams).forEach((teamEntry) => {
        const team = mergeYahoo(teamEntry?.team);
        if (!team.team_key) return;
        const teamKey = String(team.team_key);
        teams.push({
          teamKey,
          name: String(team.name || 'My Team'),
          leagueKey: teamKey.split('.t.')[0]
        });
      });
    });
  });
  return teams;
}

export function parseRoster(body, week) {
  const rosterRoot = mergeYahoo(body?.fantasy_content?.team);
  const roster = mergeYahoo(rosterRoot.roster);
  const playersNode = roster.players || roster['0']?.players;
  return collectionItems(playersNode)
    .map((entry) => mapYahooPlayer(entry, week))
    .filter(Boolean);
}

export function parseMatchup(body, myTeamKey) {
  const teamRoot = mergeYahoo(body?.fantasy_content?.team);
  const matchups = collectionItems(teamRoot.matchups);
  const matchup = mergeYahoo(matchups[0]?.matchup || matchups[0]);
  const sides = collectionItems(matchup.teams).map((entry) => {
    const team = mergeYahoo(entry?.team);
    return {
      teamKey: String(team.team_key || ''),
      name: String(team.name || ''),
      score: finiteNumber(team.team_points?.total) || 0
    };
  }).filter((side) => side.teamKey);
  const mine = sides.find((side) => side.teamKey === myTeamKey) || null;
  const opp = sides.find((side) => side.teamKey && side.teamKey !== myTeamKey) || null;
  return { mine, opp };
}

async function yahooGet(path, token) {
  const response = await fetch(`${YAHOO_API}${path}${path.includes('?') ? '' : '?format=json'}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(yahooFailureMessage(response.status, body, text));
    error.status = response.status;
    throw error;
  }
  return body;
}

function yahooFailureMessage(status, body, text) {
  const description = body?.error?.description || body?.error_description || '';
  if (status === 403 || /not authorized/i.test(description) || /not authorized/i.test(text || '')) {
    return 'Yahoo signed you in, then blocked the league read. This app still needs Fantasy Sports approval in the Yahoo developer console.';
  }
  if (description) return `Yahoo could not load the leagues. ${description}`;
  return `Yahoo could not load the leagues (${status}).`;
}

export async function importYahooLeagues(token) {
  const [leagueBody, teamBody] = await Promise.all([
    yahooGet('/users;use_login=1/games;game_keys=nfl/leagues', token),
    yahooGet('/users;use_login=1/games;game_keys=nfl/teams', token)
  ]);
  const leagues = parseLeagues(leagueBody);
  const teams = parseTeams(teamBody);
  const leagueByKey = new Map(leagues.map((league) => [league.leagueKey, league]));
  const mine = teams.length
    ? teams
    : leagues.map((league) => ({ teamKey: '', name: league.name, leagueKey: league.leagueKey }));

  const mapped = [];
  for (const team of mine) {
    const league = leagueByKey.get(team.leagueKey);
    const week = league?.week || 1;
    if (!team.teamKey) continue;
    let roster = [];
    let matchup = { mine: null, opp: null };
    let oppRoster = [];
    try {
      const rosterBody = await yahooGet(`/team/${encodeURIComponent(team.teamKey)}/roster;week=${week}`, token);
      roster = parseRoster(rosterBody, week);
    } catch {
      roster = [];
    }
    try {
      const matchupBody = await yahooGet(`/team/${encodeURIComponent(team.teamKey)}/matchups;week=${week}`, token);
      matchup = parseMatchup(matchupBody, team.teamKey);
    } catch {
      matchup = { mine: null, opp: null };
    }
    if (matchup.opp?.teamKey) {
      try {
        const oppBody = await yahooGet(`/team/${encodeURIComponent(matchup.opp.teamKey)}/roster;week=${week}`, token);
        oppRoster = parseRoster(oppBody, week);
      } catch {
        oppRoster = [];
      }
    }
    const oppTeamName = matchup.opp?.name || 'No matchup';
    const myTeamName = team.name || matchup.mine?.name || 'My Team';
    const leagueName = league?.name || myTeamName;
    mapped.push({
      id: `yahoo-${team.leagueKey}`,
      name: leagueName,
      platform: 'Yahoo',
      season: league?.season || '2026',
      myScore: matchup.mine?.score || 0,
      oppScore: matchup.opp?.score || 0,
      myTeamName,
      oppTeamName,
      opponent: oppTeamName,
      userTeam: { name: myTeamName, starters: roster },
      oppTeam: { name: oppTeamName, starters: oppRoster },
      portfolio: roster,
      threats: oppRoster,
      starters: roster,
      opponentStarters: oppRoster
    });
  }
  return mapped;
}

function readCookie(req, name) {
  const raw = String(req.headers?.cookie || '');
  const hit = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!hit) return '';
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return hit.slice(name.length + 1);
  }
}

function sendHtml(res, status, html, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(html);
}

function clearStateCookie() {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function renderErrorPage(message) {
  const safe = String(message || 'Yahoo sign-in did not finish.').replace(/[&<>]/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]
  ));
  return `<!DOCTYPE html>
<html lang="en">
<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RootMap</title></head>
<body style="margin:0;background:#020617;color:#f8fafc;font-family:system-ui,sans-serif">
  <main style="max-width:24rem;margin:4rem auto;padding:1.25rem">
    <h1 style="font-size:1.25rem">Yahoo did not connect</h1>
    <p>${safe}</p>
    <p><a href="/" style="color:#c4b5fd">Back to RootMap</a></p>
  </main>
</body>
</html>`;
}

export function renderImportPage(leagues) {
  const payload = JSON.stringify(leagues).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RootMap</title></head>
<body style="margin:0;background:#020617;color:#f8fafc;font-family:system-ui,sans-serif">
  <main style="max-width:24rem;margin:4rem auto;padding:1.25rem">
    <h1 style="font-size:1.25rem">Saving your Yahoo leagues on this phone…</h1>
  </main>
  <script>
    (function () {
      var incoming = ${payload};
      var key = 'rootmap_leagues';
      try {
        var existing = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(existing)) existing = [];
        var byId = new Map();
        existing.forEach(function (league, index) {
          if (!league) return;
          byId.set(league.id ? String(league.id) : ('legacy-' + index), league);
        });
        incoming.forEach(function (league) {
          if (league && league.id) byId.set(String(league.id), league);
        });
        localStorage.setItem(key, JSON.stringify(Array.from(byId.values())));
        location.replace('/?yahoo=synced&count=' + incoming.length);
      } catch (err) {
        document.body.insertAdjacentHTML('beforeend', '<p style="max-width:24rem;margin:1rem auto;padding:0 1.25rem">This browser blocked saving the leagues. Turn off private browsing and try Connect Yahoo again.</p>');
      }
    })();
  </script>
</body>
</html>`;
}

export function startYahooLogin(_req, res) {
  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  if (!clientId) {
    sendHtml(res, 500, renderErrorPage('Yahoo sign-in is not configured on the server yet.'));
    return;
  }
  const state = randomBytes(16).toString('hex');
  const redirectUri = yahooRedirectUri();
  const authUrl = new URL(YAHOO_AUTH);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'fspt-r');
  authUrl.searchParams.set('language', 'en-us');
  authUrl.searchParams.set('state', state);
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

export async function completeYahooOAuth(req, res) {
  const error = req.query?.error;
  const code = req.query?.code;
  const state = req.query?.state;
  const expected = readCookie(req, STATE_COOKIE);
  if (error) {
    sendHtml(res, 400, renderErrorPage('Yahoo cancelled the sign-in.'), { 'Set-Cookie': clearStateCookie() });
    return;
  }
  if (!code) {
    sendHtml(res, 400, renderErrorPage('Yahoo did not return a sign-in code.'), { 'Set-Cookie': clearStateCookie() });
    return;
  }
  if (!expected || state !== expected) {
    sendHtml(res, 400, renderErrorPage('This sign-in link expired. Tap Connect Yahoo and try again.'), { 'Set-Cookie': clearStateCookie() });
    return;
  }

  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YAHOO_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    sendHtml(res, 500, renderErrorPage('Yahoo sign-in is not configured on the server yet.'), { 'Set-Cookie': clearStateCookie() });
    return;
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenParams = new URLSearchParams();
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('redirect_uri', yahooRedirectUri());
    tokenParams.set('code', String(code));
    const tokenRes = await fetch(YAHOO_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      const detail = tokenData.error_description || tokenData.error || 'Token exchange failed';
      sendHtml(res, 400, renderErrorPage(`Yahoo could not finish sign-in. ${detail} The Yahoo app redirect URI must be ${yahooRedirectUri()}.`), { 'Set-Cookie': clearStateCookie() });
      return;
    }
    const leagues = await importYahooLeagues(tokenData.access_token);
    if (!leagues.length) {
      sendHtml(res, 200, renderErrorPage('That Yahoo account has no NFL teams to import.'), { 'Set-Cookie': clearStateCookie() });
      return;
    }
    sendHtml(res, 200, renderImportPage(leagues), { 'Set-Cookie': clearStateCookie() });
  } catch (err) {
    sendHtml(res, err.status && err.status < 500 ? 400 : 500, renderErrorPage(err.message || 'Yahoo sign-in failed.'), { 'Set-Cookie': clearStateCookie() });
  }
}
