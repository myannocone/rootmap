import { randomBytes } from 'node:crypto';
import { activeOrProjected, isActiveYahooSlot } from '../src/utils/activeLineup.js';

const YAHOO_AUTH = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';
const YAHOO_SCOPE = 'openid fspt-r';
const YAHOO_LEAGUES_PATH = '/users;use_login=1/games;game_keys=nfl/leagues';
const STATE_COOKIE = 'yahoo_oauth_state';
const APP_COOKIE = 'yahoo_return_app';
const ACCESS_COOKIE = 'yahoo_access_token';
const REFRESH_COOKIE = 'yahoo_refresh_token';
const ACCESS_MAX_AGE = 3600;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

function requestHost(req) {
  return String(req?.headers?.host || '').split(',')[0].trim();
}

function requestIsLocal(req) {
  return /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)(:\d+)?$/i.test(requestHost(req));
}

export function requestIsSecure(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return !requestIsLocal(req);
}

export function yahooRedirectUri(req) {
  if (req && requestIsLocal(req)) {
    return `http://${requestHost(req)}/api/auth/yahoo/callback`;
  }
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
  if (!selected) return '';
  if (typeof selected === 'string') return selected.toUpperCase();
  if (Array.isArray(selected)) {
    const hit = selected.find((entry) => entry?.position) || selected[0];
    return String(hit?.position || '').toUpperCase();
  }
  if (selected.position) return String(selected.position).toUpperCase();
  const nested = Object.values(selected).find((entry) => entry && typeof entry === 'object' && entry.position);
  return String(nested?.position || '').toUpperCase();
}

export function mapYahooPlayer(player, week) {
  const merged = mergeYahoo(player?.player || player);
  const slot = selectedSlot(merged);
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
  const isStarter = isActiveYahooSlot(slot);
  return {
    name: displayName,
    slot: isDefense ? 'D/ST' : (slot || position),
    position: isDefense ? 'D/ST' : position,
    nflTeam,
    team: nflTeam,
    points: actual != null ? actual : (proj ?? 0),
    projPoints: proj,
    actualPoints: actual,
    isStarter,
    inRedZone: false,
    gameClock: `Week ${week}`,
    bigPlay: null
  };
}

function walkYahoo(node, visit, seen = new Set(), depth = 0) {
  if (node == null || depth > 12) return;
  if (typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  visit(node);
  const entries = Array.isArray(node) ? node.map((child, index) => [String(index), child]) : Object.entries(node);
  entries.forEach(([key, child]) => {
    if (key === 'managers' || key === 'manager') return;
    walkYahoo(child, visit, seen, depth + 1);
  });
}

function stringFields(node, field) {
  const found = [];
  walkYahoo(node, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (typeof value[field] === 'string' && value[field].trim()) found.push(value[field].trim());
  });
  return found;
}

function firstNumberField(node, field) {
  let found = null;
  walkYahoo(node, (value) => {
    if (found != null || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const number = finiteNumber(value[field]);
    if (number != null) found = number;
  });
  return found;
}

function nestedTotal(node, parentKey) {
  let found = null;
  walkYahoo(node, (value) => {
    if (found != null || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const bucket = value[parentKey];
    if (!bucket || typeof bucket !== 'object') return;
    const total = finiteNumber(bucket.total);
    if (total != null) found = total;
  });
  return found;
}

function ownRecord(node, field) {
  const keys = [...new Set(stringFields(node, field))];
  if (keys.length !== 1) return '';
  return keys[0];
}

function nameForKey(node, keyField) {
  if (!node || typeof node !== 'object') return '';
  const parts = Array.isArray(node) ? node : [node];
  let sibling = '';
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const named = typeof part.name === 'string' ? part.name.trim() : '';
    if (!named) continue;
    if (part[keyField]) return named;
    if (!sibling && !part.league_key && !part.team_key && !part.teams && !part.team && !part.roster) {
      sibling = named;
    }
  }
  return sibling;
}

function recordName(node, keyField) {
  const direct = nameForKey(node, keyField);
  if (direct) return direct;
  if (node && typeof node === 'object') {
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const named = nameForKey(child, keyField);
      if (named) return named;
    }
  }
  return '';
}

export function parseLeagues(body) {
  const leagues = [];
  const seen = new Set();
  walkYahoo(body, (node) => {
    const leagueKey = ownRecord(node, 'league_key');
    if (!leagueKey || !leagueKey.includes('.l.') || seen.has(leagueKey)) return;
    const name = recordName(node, 'league_key');
    if (!name) return;
    seen.add(leagueKey);
    leagues.push({
      leagueKey,
      name,
      week: firstNumberField(node, 'current_week'),
      season: stringFields(node, 'season')[0] || ''
    });
  });
  return leagues;
}

export function parseTeams(body) {
  const teams = [];
  const seen = new Set();
  walkYahoo(body, (node) => {
    const teamKey = ownRecord(node, 'team_key');
    if (!teamKey || !teamKey.includes('.t.') || seen.has(teamKey)) return;
    const name = recordName(node, 'team_key');
    if (!name) return;
    seen.add(teamKey);
    teams.push({
      teamKey,
      name,
      leagueKey: teamKey.split('.t.')[0]
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

function readTeamSide(teamNode) {
  const teamKey = ownRecord(teamNode, 'team_key');
  if (!teamKey) return null;
  let standing = null;
  walkYahoo(teamNode, (value) => {
    if (standing || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const totals = value.outcome_totals;
    if (!totals || typeof totals !== 'object') return;
    const wins = finiteNumber(totals.wins);
    const losses = finiteNumber(totals.losses);
    if (wins == null || losses == null) return;
    standing = {
      wins,
      losses,
      ties: finiteNumber(totals.ties) || 0,
      rank: finiteNumber(value.rank)
    };
  });
  return {
    teamKey,
    name: recordName(teamNode, 'team_key'),
    score: nestedTotal(teamNode, 'team_points'),
    proj: nestedTotal(teamNode, 'team_projected_points'),
    record: standing ? { wins: standing.wins, losses: standing.losses, ties: standing.ties } : null,
    rank: standing?.rank || null
  };
}

export function parseScoreboard(body, myTeamKey) {
  const matchups = [];
  walkYahoo(body, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !node.teams) return;
    const sides = collectionItems(node.teams)
      .map((entry) => readTeamSide(entry?.team || entry))
      .filter(Boolean);
    if (sides.length === 2 && sides[0].teamKey !== sides[1].teamKey) matchups.push(sides);
  });
  const wanted = String(myTeamKey || '');
  const hit = matchups.find((sides) => sides.some((side) => side.teamKey === wanted));
  if (!hit) return { mine: null, opp: null };
  return {
    mine: hit.find((side) => side.teamKey === wanted) || null,
    opp: hit.find((side) => side.teamKey !== wanted) || null
  };
}

export function parseMatchup(body, myTeamKey) {
  return parseScoreboard(body, myTeamKey);
}

function yahooUrl(path) {
  const url = new URL(`${YAHOO_API}${path}`);
  url.searchParams.set('format', 'json');
  return url;
}

async function yahooGet(path, token) {
  const response = await fetch(yahooUrl(path), {
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

async function currentNflWeek() {
  try {
    const response = await fetch('https://api.sleeper.app/v1/state/nfl');
    if (response.ok) {
      const state = await response.json();
      const week = Number(state?.week);
      if (week >= 1 && week <= 18) return week;
    }
  } catch {
    // the dated fallback stays on the current NFL week
  }
  return 9;
}

function startingLineup(players) {
  return activeOrProjected(players);
}

export async function importYahooLeagues(token) {
  const [leagueBody, teamBody, nflWeek] = await Promise.all([
    yahooGet(YAHOO_LEAGUES_PATH, token),
    yahooGet('/users;use_login=1/games;game_keys=nfl/teams', token),
    currentNflWeek()
  ]);
  const leagues = parseLeagues(leagueBody);
  const teams = parseTeams(teamBody);
  const leagueByKey = new Map(leagues.map((league) => [league.leagueKey, { ...league }]));

  const mapped = [];
  for (const sourceTeam of teams) {
    const teamKey = String(sourceTeam.teamKey || '');
    const leagueKey = teamKey.includes('.t.') ? teamKey.split('.t.')[0] : String(sourceTeam.leagueKey || '');
    if (!teamKey || !leagueKey) continue;
    const league = leagueByKey.get(leagueKey) || null;
    const leagueWeek = Number(league?.week);
    const week = leagueWeek >= 1 && leagueWeek <= 18 ? leagueWeek : nflWeek;
    let roster = [];
    let scoreboard = { mine: null, opp: null };
    let oppRoster = [];
    try {
      const rosterBody = await yahooGet(`/team/${encodeURIComponent(teamKey)}/roster;week=${week}`, token);
      roster = parseRoster(rosterBody, week);
    } catch {
      roster = [];
    }
    try {
      const boardBody = await yahooGet(`/league/${encodeURIComponent(leagueKey)}/scoreboard;week=${week}`, token);
      scoreboard = parseScoreboard(boardBody, teamKey);
    } catch {
      scoreboard = { mine: null, opp: null };
    }
    if (!scoreboard.opp?.name) {
      try {
        const matchupBody = await yahooGet(`/team/${encodeURIComponent(teamKey)}/matchups;week=${week}`, token);
        const fromTeam = parseMatchup(matchupBody, teamKey);
        scoreboard = {
          mine: scoreboard.mine?.name ? scoreboard.mine : fromTeam.mine,
          opp: scoreboard.opp?.name ? scoreboard.opp : fromTeam.opp
        };
      } catch {
        scoreboard = { mine: scoreboard.mine, opp: scoreboard.opp };
      }
    }
    const opponentKey = scoreboard.opp?.teamKey || '';
    if (opponentKey) {
      try {
        const oppBody = await yahooGet(`/team/${encodeURIComponent(opponentKey)}/roster;week=${week}`, token);
        oppRoster = parseRoster(oppBody, week);
      } catch {
        oppRoster = [];
      }
    }
    const myTeamName = sourceTeam.name || scoreboard.mine?.name || 'My Team';
    const oppTeamName = scoreboard.opp?.name || 'Opponent';
    const leagueName = league?.name || myTeamName;
    const myRoster = startingLineup(roster).map((player) => ({ ...player }));
    const theirRoster = startingLineup(oppRoster).map((player) => ({ ...player }));
    mapped.push({
      id: `yahoo-${leagueKey}`,
      leagueKey,
      teamKey,
      lineupWeek: week,
      lineupProjected: myRoster.some((player) => player.projectedStart) || theirRoster.some((player) => player.projectedStart),
      name: leagueName,
      platform: 'Yahoo',
      season: league?.season || '2026',
      myScore: scoreboard.mine?.score || 0,
      oppScore: scoreboard.opp?.score || 0,
      myProj: scoreboard.mine?.proj ?? null,
      oppProj: scoreboard.opp?.proj ?? null,
      myTeamName,
      oppTeamName,
      opponent: oppTeamName,
      myRecord: scoreboard.mine?.record || null,
      oppRecord: scoreboard.opp?.record || null,
      myRank: scoreboard.mine?.rank || null,
      oppRank: scoreboard.opp?.rank || null,
      userTeam: { name: myTeamName, starters: myRoster.map((player) => ({ ...player })) },
      oppTeam: { name: oppTeamName, starters: theirRoster.map((player) => ({ ...player })) },
      portfolio: myRoster,
      threats: theirRoster,
      starters: myRoster.map((player) => ({ ...player })),
      opponentStarters: theirRoster.map((player) => ({ ...player }))
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

function cookie(name, value, maxAge, secure = true) {
  const secureFlag = secure ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearYahooCookies(secure = true) {
  return [cookie(STATE_COOKIE, '', 0, secure), cookie(APP_COOKIE, '', 0, secure)];
}

function tokenCookies(secure, tokenData) {
  const cookies = clearYahooCookies(secure);
  const access = String(tokenData?.access_token || '');
  const refresh = String(tokenData?.refresh_token || '');
  const accessAge = Number(tokenData?.expires_in);
  if (access) cookies.push(cookie(ACCESS_COOKIE, access, Number.isFinite(accessAge) && accessAge > 0 ? accessAge : ACCESS_MAX_AGE, secure));
  if (refresh) cookies.push(cookie(REFRESH_COOKIE, refresh, REFRESH_MAX_AGE, secure));
  return cookies;
}

function grantedFantasyRead(tokenData) {
  const scope = String(tokenData?.scope || '').trim();
  if (!scope) return true;
  return scope.split(/\s+/).includes('fspt-r');
}

function wantsJson(req) {
  return req.query?.format === 'json' || String(req.headers?.accept || '').includes('application/json');
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
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

export function renderImportPage(leagues, { returnToApp = false } = {}) {
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
        if (${returnToApp ? 'true' : 'false'}) {
          location.replace('rootmap://yahoo-synced#' + encodeURIComponent(JSON.stringify(incoming)));
          return;
        }
        location.replace('/?yahoo=synced&count=' + incoming.length);
      } catch (err) {
        document.body.insertAdjacentHTML('beforeend', '<p style="max-width:24rem;margin:1rem auto;padding:0 1.25rem">This browser blocked saving the leagues. Turn off private browsing and try Connect Yahoo again.</p>');
      }
    })();
  </script>
</body>
</html>`;
}

export function startYahooLogin(req, res) {
  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YAHOO_CLIENT_SECRET || '').trim();
  const json = wantsJson(req);
  if (!clientId) {
    if (json) {
      sendJson(res, 500, { error: 'Missing Yahoo Client ID in .env' });
      return;
    }
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client ID in .env'));
    return;
  }
  if (!clientSecret) {
    if (json) {
      sendJson(res, 500, { error: 'Missing Yahoo Client Secret in .env' });
      return;
    }
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client Secret in .env'));
    return;
  }
  const state = randomBytes(16).toString('hex');
  const redirectUri = yahooRedirectUri(req);
  const authUrl = new URL(YAHOO_AUTH);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', YAHOO_SCOPE);
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('language', 'en-us');
  authUrl.searchParams.set('state', state);
  const secure = requestIsSecure(req);
  const cookies = [cookie(STATE_COOKIE, state, 600, secure)];
  if (req.query?.app === '1') cookies.push(cookie(APP_COOKIE, '1', 600, secure));
  if (json) {
    sendJson(res, 200, { url: authUrl.toString() }, { 'Set-Cookie': cookies });
    return;
  }
  res.setHeader('Set-Cookie', cookies);
  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

export async function completeYahooOAuth(req, res) {
  const error = req.query?.error;
  const code = req.query?.code;
  const state = req.query?.state;
  const expected = readCookie(req, STATE_COOKIE);
  const secure = requestIsSecure(req);
  const clearCookies = { 'Set-Cookie': clearYahooCookies(secure) };
  if (error) {
    sendHtml(res, 400, renderErrorPage('Yahoo cancelled the sign-in.'), clearCookies);
    return;
  }
  if (!code) {
    sendHtml(res, 400, renderErrorPage('Yahoo did not return a sign-in code.'), clearCookies);
    return;
  }
  if (!expected || state !== expected) {
    sendHtml(res, 400, renderErrorPage('This sign-in link expired. Tap Connect Yahoo and try again.'), clearCookies);
    return;
  }

  const clientId = String(process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YAHOO_CLIENT_SECRET || '').trim();
  if (!clientId) {
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client ID in .env'), clearCookies);
    return;
  }
  if (!clientSecret) {
    sendHtml(res, 500, renderErrorPage('Missing Yahoo Client Secret in .env'), clearCookies);
    return;
  }

  let tokenData = null;
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenParams = new URLSearchParams();
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('redirect_uri', yahooRedirectUri(req));
    tokenParams.set('code', String(code));
    const tokenRes = await fetch(YAHOO_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });
    tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      const detail = tokenData.error_description || tokenData.error || 'Token exchange failed';
      sendHtml(res, 400, renderErrorPage(`Yahoo could not finish sign-in. ${detail} The Yahoo app redirect URI must be ${yahooRedirectUri(req)}.`), clearCookies);
      return;
    }
    const storedTokens = { 'Set-Cookie': tokenCookies(secure, tokenData) };
    if (!grantedFantasyRead(tokenData)) {
      sendHtml(res, 400, renderErrorPage('Yahoo signed you in without Fantasy Sports read access. Connect Yahoo again and allow fantasy sports when Yahoo asks.'), storedTokens);
      return;
    }
    const returnToApp = readCookie(req, APP_COOKIE) === '1';
    const leagues = await importYahooLeagues(tokenData.access_token);
    if (!leagues.length) {
      sendHtml(res, 200, renderErrorPage('That Yahoo account has no NFL teams to import.'), storedTokens);
      return;
    }
    sendHtml(res, 200, renderImportPage(leagues, { returnToApp }), storedTokens);
  } catch (err) {
    const headers = tokenData?.access_token
      ? { 'Set-Cookie': tokenCookies(secure, tokenData) }
      : clearCookies;
    sendHtml(res, err.status && err.status < 500 ? 400 : 500, renderErrorPage(err.message || 'Yahoo sign-in failed.'), headers);
  }
}
