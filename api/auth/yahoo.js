import { startYahooLogin } from '../../lib/yahooFantasy.js';

export default function handler(req, res) {
  return startYahooLogin(req, res);
}
