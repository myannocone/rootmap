export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Top-level, low-privilege API fetch to see user's roster game permissions
    const targetUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json';
    
    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const status = response.status;
    const contentType = response.headers.get('content-type') || 'unknown';
    const rawText = await response.text();

    // Check if permissions succeeded and extract user's fantasy games list
    let leagues = [];
    if (response.ok) {
      try {
        const data = JSON.parse(rawText);
        const userObj = data?.fantasy_content?.users?.[0]?.user;
        const gamesBlock = userObj?.find(item => item?.games)?.games;
        
        if (gamesBlock && typeof gamesBlock === 'object') {
          const count = gamesBlock.count || 0;
          for (let i = 0; i < count; i++) {
            const g = gamesBlock[i]?.game?.[0];
            if (g) {
              leagues.push({
                id: g.game_key,
                name: `Yahoo Season ${g.season} (${g.code.toUpperCase()})`,
                season: String(g.season),
                numTeams: 12,
                platform: 'Yahoo',
                starters: [] // placeholder for custom lineup maps
              });
            }
          }
        }
      } catch (e) {
        // Continue with diagnostic transmission if parsing fails
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      debug: true,
      httpStatus: status,
      contentType: contentType,
      targetUrl: targetUrl,
      rawLength: rawText.length,
      rawPayload: rawText,
      leagues: leagues // populate directly if permission was success
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Endpoint failure', message: err.message }));
  }
}
