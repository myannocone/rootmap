import handler from './espn.js';

export default function discoverEspn(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  url.searchParams.set('discover', '1');
  req.url = `${url.pathname}${url.search}`;
  if (!req.query || typeof req.query !== 'object') req.query = {};
  req.query.discover = '1';
  return handler(req, res);
}
