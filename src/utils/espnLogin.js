import { registerPlugin } from '@capacitor/core';

export const ESPN_LOGIN_URL = 'https://www.espn.com/login';
export const ESPN_SESSION_EXPIRED_HINT =
  'ESPN session expired. Tap here to sign in again so RootMap can refresh your leagues.';

const ESPN_SESSION_KEY = 'rootmap_espn_session';

const EspnLogin = registerPlugin('EspnLogin');

let sessionRejected = false;

export function openNativeEspnLogin() {
  return EspnLogin.login();
}

function readStoredEspnRecord() {
  try {
    const raw = JSON.parse(localStorage.getItem(ESPN_SESSION_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

export function isEspnSessionExpired() {
  if (sessionRejected) return true;
  return Boolean(readStoredEspnRecord()?.expired);
}

/** League and team ids survive an expired cookie pair so the board can be reconnected. */
export function readEspnLeagueIdentity() {
  const raw = readStoredEspnRecord();
  return {
    leagueId: String(raw?.leagueId || '').trim(),
    teamId: String(raw?.teamId || '').trim()
  };
}

export function readEspnSession() {
  if (sessionRejected) return null;
  const raw = readStoredEspnRecord();
  if (!raw || raw.expired) {
    if (raw?.expired) sessionRejected = true;
    return null;
  }
  const swid = String(raw.swid || '').trim();
  const espnS2 = String(raw.espnS2 || '').trim();
  if (!swid || !espnS2) return null;
  return {
    swid,
    espnS2,
    leagueId: String(raw.leagueId || '').trim(),
    teamId: String(raw.teamId || '').trim()
  };
}

export function writeEspnSession(session) {
  const swid = String(session?.swid || '').trim();
  const espnS2 = String(session?.espnS2 || '').trim();
  if (!swid || !espnS2) return;
  try {
    localStorage.setItem(ESPN_SESSION_KEY, JSON.stringify({
      swid,
      espnS2,
      leagueId: String(session?.leagueId || '').trim(),
      teamId: String(session?.teamId || '').trim()
    }));
    sessionRejected = false;
  } catch {
    // private mode can block storage; keep the rejected flag so dead cookies stay unused
  }
}

/**
 * Drop SWID and espn_s2 after ESPN returns 401/403.
 * League identity stays so imported rows can be refreshed after the next sign-in.
 */
export function invalidateEspnSession() {
  sessionRejected = true;
  const raw = readStoredEspnRecord() || {};
  try {
    localStorage.setItem(ESPN_SESSION_KEY, JSON.stringify({
      swid: '',
      espnS2: '',
      leagueId: String(raw.leagueId || '').trim(),
      teamId: String(raw.teamId || '').trim(),
      expired: true
    }));
  } catch {
    // the in-memory flag still stops this page from resending the dead pair
  }
}

export function isEspnSessionRejected(error) {
  if (error && typeof error === 'object' && error.code === 'ESPN_SESSION_EXPIRED') return true;
  const message = String(error?.message || error || '');
  if (!/rejected that SWID and espn_s2/i.test(message)) return false;
  const status = Number(error?.status);
  return status === 401 || status === 403 || !Number.isFinite(status);
}
