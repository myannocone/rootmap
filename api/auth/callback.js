import { completeYahooOAuth } from '../../lib/yahooFantasy.js';

export default function handler(req, res) {
  return completeYahooOAuth(req, res);
}
