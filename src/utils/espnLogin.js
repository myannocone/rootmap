import { registerPlugin } from '@capacitor/core';

export const ESPN_LOGIN_URL = 'https://www.espn.com/login';
const ESPN_SESSION_KEY = 'rootmap_espn_session';

const EspnLogin = registerPlugin('EspnLogin');

export function openNativeEspnLogin() {
  return EspnLogin.login();
}

export function readEspnSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(ESPN_SESSION_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const swid = String(raw.swid || '').trim();
    const espnS2 = String(raw.espnS2 || '').trim();
    if (!swid || !espnS2) return null;
    return {
      swid,
      espnS2,
      leagueId: String(raw.leagueId || '').trim(),
      teamId: String(raw.teamId || '').trim()
    };
  } catch {
    return null;
  }
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
  } catch {
    // private mode can block storage
  }
}
