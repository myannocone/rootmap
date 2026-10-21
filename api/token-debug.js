export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');

  try {
    // 1. Inspect OpenID UserInfo to see what Yahoo recognizes about this token
    const userinfoRes = await fetch('https://api.login.yahoo.com/openid/v1/userinfo', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const userinfo = await userinfoRes.json();

    // 2. Query basic game metadata directly without use_login
    const publicGameRes = await fetch('https://fantasysports.yahooapis.com/fantasy/v2/game/nfl?format=json', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const publicGameText = await publicGameRes.text();

    return res.status(200).json({
      tokenPreview: `${token.substring(0, 10)}...${token.slice(-6)}`,
      userinfoStatus: userinfoRes.status,
      userinfo,
      publicGameStatus: publicGameRes.status,
      publicGameResponse: publicGameText
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
