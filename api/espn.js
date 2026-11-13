function decodeOnce(value) {
  const text = String(value || '');
  if (!text.includes('%')) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function headerValue(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function queryValue(req, name) {
  const fromQuery = req.query?.[name];
  if (Array.isArray(fromQuery)) return fromQuery[0] || '';
  if (fromQuery != null && fromQuery !== '') return String(fromQuery);
  try {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function bareSwid(value) {
  return String(value || '').replace(/[{}]/g, '').trim();
}

function collectFflLeagues(node, inheritedAbbrev, found) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectFflLeagues(item, inheritedAbbrev, found));
    return;
  }
  const own = String(node.abbrev || node.gameAbbrev || '').toLowerCase();
  const abbrev = own || inheritedAbbrev;
  const leagueId = node.groupId ?? node.leagueId;
  if (abbrev === 'ffl' && /^\d+$/.test(String(leagueId ?? ''))) {
    const id = String(leagueId);
    if (!found.has(id)) {
      found.set(id, {
        id,
        name: String(node.groupName || node.leagueName || node.name || '').trim()
      });
    }
  }
  const next = own === 'ffl' ? 'ffl' : (own ? '' : inheritedAbbrev);
  Object.values(node).forEach((value) => collectFflLeagues(value, next, found));
}

async function discoverLeagues(res, swid, espnS2) {
  res.setHeader('Content-Type', 'application/json');
  if (!swid || !espnS2) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Sign in to ESPN to find your leagues.', leagues: [] }));
    return;
  }
  const target = `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(bareSwid(swid))}`;
  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: 'application/json',
        'User-Agent': BROWSER_USER_AGENT,
        Cookie: `SWID=${swid}; espn_s2=${espnS2};`
      }
    });
    const text = await upstream.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.end(JSON.stringify({ error: 'ESPN did not return your leagues.', leagues: [] }));
      return;
    }
    const found = new Map();
    collectFflLeagues(body, '', found);
    res.statusCode = 200;
    res.end(JSON.stringify({ leagues: [...found.values()] }));
  } catch {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Could not reach ESPN.', leagues: [] }));
  }
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-SWID, X-ESPN-S2');
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const leagueId = String(queryValue(req, 'leagueId')).trim();
  const season = String(queryValue(req, 'season') || '2026').trim();
  const week = String(queryValue(req, 'week') || '9').trim();
  const swid = decodeOnce(queryValue(req, 'swid') || headerValue(req, 'x-swid')).trim();
  const espnS2 = decodeOnce(queryValue(req, 'espn_s2') || headerValue(req, 'x-espn-s2')).trim();
  let pathname = '';
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    pathname = '';
  }
  if (queryValue(req, 'discover') === '1' || pathname.endsWith('/discover-espn')) {
    await discoverLeagues(res, swid, espnS2);
    return;
  }

  if (!/^\d+$/.test(leagueId)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Enter an ESPN league ID.' }));
    return;
  }

  const target = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${encodeURIComponent(season)}/segments/0/leagues/${leagueId}?view=mMatchup&view=mRoster&view=mTeam&view=mSettings&scoringPeriodId=${encodeURIComponent(week)}&matchupPeriodId=${encodeURIComponent(week)}`;
  const headers = {
    Accept: 'application/json',
    'User-Agent': BROWSER_USER_AGENT
  };
  if (swid && espnS2) {
    headers.Cookie = `SWID=${swid}; espn_s2=${espnS2};`;
  }

  try {
    const upstream = await fetch(target, { headers });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.end(text);
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Could not reach ESPN.' }));
  }
}
