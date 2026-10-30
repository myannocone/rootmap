function decodeOnce(value) {
  const text = String(value || '');
  if (!text.includes('%')) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
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

export default async function handler(req, res) {
  const leagueId = String(queryValue(req, 'leagueId')).trim();
  const season = String(queryValue(req, 'season') || '2026').trim();
  const week = String(queryValue(req, 'week') || '8').trim();
  const swid = decodeOnce(queryValue(req, 'swid')).trim();
  const espnS2 = decodeOnce(queryValue(req, 'espn_s2')).trim();

  if (!/^\d+$/.test(leagueId)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Enter an ESPN league ID.' }));
    return;
  }

  const target = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${encodeURIComponent(season)}/segments/0/leagues/${leagueId}?view=mMatchup&view=mRoster&view=mTeam&view=mSettings&scoringPeriodId=${encodeURIComponent(week)}`;
  const headers = { Accept: 'application/json' };
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
