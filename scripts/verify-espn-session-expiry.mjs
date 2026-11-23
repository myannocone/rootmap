/**
 * ESPN cookie expiry: dead SWID / espn_s2 are flagged, and imported leagues stay put.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const loginSource = readFileSync(join(root, 'src/utils/espnLogin.js'), 'utf8');
const apiSource = readFileSync(join(root, 'src/utils/espnDirectApi.js'), 'utf8');
const appSource = readFileSync(join(root, 'src/App.jsx'), 'utf8');

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
}

function loadEspnLogin() {
  const transformed = loginSource
    .replace(/import\s*\{[^}]+\}\s*from\s*'@capacitor\/core';/, 'const registerPlugin = () => ({ login() { return Promise.resolve(); } });')
    .replaceAll('export const ', 'const ')
    .replaceAll('export function ', 'function ');
  const factory = new Function(`${transformed}
    return {
      ESPN_SESSION_EXPIRED_HINT,
      readEspnSession,
      readEspnLeagueIdentity,
      writeEspnSession,
      invalidateEspnSession,
      isEspnSessionExpired,
      isEspnSessionRejected
    };
  `);
  return factory();
}

globalThis.localStorage = new MemoryStorage();
const espn = loadEspnLogin();

const leaguesBefore = JSON.stringify([{ id: 'espn-1', espnLeagueId: '99', espnTeamId: '2', name: 'Keep me' }]);
localStorage.setItem('rootmap_leagues', leaguesBefore);

espn.writeEspnSession({ swid: '{ABC}', espnS2: 'secret-s2', leagueId: '99', teamId: '2' });
const live = espn.readEspnSession();
assert(live?.swid === '{ABC}' && live?.espnS2 === 'secret-s2', 'live session returns both cookies');
assert(espn.isEspnSessionExpired() === false, 'fresh session is not expired');

espn.invalidateEspnSession();
assert(espn.readEspnSession() === null, 'expired session does not return cookies');
assert(espn.isEspnSessionExpired() === true, 'expired flag is set');
const identity = espn.readEspnLeagueIdentity();
assert(identity.leagueId === '99' && identity.teamId === '2', 'league identity survives expiry');
const stored = JSON.parse(localStorage.getItem('rootmap_espn_session'));
assert(stored.expired === true, 'rootmap_espn_session is flagged expired');
assert(stored.swid === '' && stored.espnS2 === '', 'dead cookies are cleared');
assert(localStorage.getItem('rootmap_leagues') === leaguesBefore, 'invalidate does not touch rootmap_leagues');

espn.writeEspnSession({ swid: '{NEW}', espnS2: 'fresh-s2', leagueId: '99', teamId: '2' });
assert(espn.readEspnSession()?.espnS2 === 'fresh-s2', 'a new sign-in replaces the expired pair');
assert(espn.isEspnSessionExpired() === false, 'a new sign-in clears the expired flag');
assert(JSON.parse(localStorage.getItem('rootmap_espn_session')).expired !== true, 'stored record drops the expired flag');

const rejected = new Error('ESPN rejected that SWID and espn_s2. Copy both cookies again from espn.com.');
rejected.status = 401;
rejected.code = 'ESPN_SESSION_EXPIRED';
assert(espn.isEspnSessionRejected(rejected), '401 with a session code is rejected');
const forbidden = new Error('ESPN rejected that SWID and espn_s2. Copy both cookies again from espn.com.');
forbidden.status = 403;
assert(espn.isEspnSessionRejected(forbidden), '403 cookie rejection is rejected');
const privateLeague = new Error("This ESPN league is private. Ask your commissioner to set 'Viewable to Public' or use the Desktop Extension.");
privateLeague.status = 401;
assert(!espn.isEspnSessionRejected(privateLeague), 'private-league 401 is not a dead session');
const other = new Error('ESPN request failed (500).');
other.status = 500;
assert(!espn.isEspnSessionRejected(other), 'other ESPN failures stay retryable');

assert(apiSource.includes("error.code = 'ESPN_SESSION_EXPIRED'"), 'league fetch marks 401/403 session rejection');
assert(apiSource.includes('error.status = response.status'), 'league fetch keeps the HTTP status');
assert(appSource.includes('isEspnSessionRejected(err)'), 'weekly refresh detects a rejected ESPN session');
assert(appSource.includes('invalidateEspnSession()'), 'weekly refresh flags the stored ESPN session');
assert(appSource.includes('setEspnSessionExpired(true)'), 'weekly refresh marks ESPN expired in state');
assert(appSource.includes('ESPN_SESSION_EXPIRED_HINT'), 'board shows the ESPN reconnect notice');
assert(appSource.includes('handleEspnSessionExpiredTap'), 'reconnect notice is tappable');
assert(appSource.includes("selectConnectTab('espn')"), 'tap opens the ESPN import modal');
assert(!/isEspnSessionRejected[\s\S]{0,400}setLeagues\(/.test(appSource), 'auth failure does not rewrite the league board');
assert(!loginSource.includes('rootmap_leagues'), 'session helper never writes the league board');
assert(loginSource.includes("export const ESPN_FANTASY_URL = 'https://fantasy.espn.com/'"), 'fantasy.espn.com helper url');
assert(appSource.includes('ESPN_FANTASY_URL'), 'browser modal links to fantasy.espn.com');
assert(appSource.includes('Private League Sign-In'), 'browser modal explains private sign-in');
assert(appSource.includes("espnSigningIn ? 'Signing in…' : 'Sign in to ESPN'"), 'native modal leads with Sign in to ESPN');
assert(appSource.includes('openNativeEspnLogin()'), 'native button still opens EspnLoginPlugin');
assert(appSource.includes('>Load league<') || appSource.includes("espnBusy || 'Load league'"), 'public league load remains');
assert(appSource.includes('Import pasted matchup'), 'yahoo/espn paste import remains');
assert(appSource.includes('Paste an ESPN or Yahoo matchup here'), 'unified paste box remains');

console.log('espn session expiry checks passed');
