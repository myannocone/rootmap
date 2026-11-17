import { Capacitor } from '@capacitor/core';
import { YahooLogin, yahooIdentity } from './yahooNative';

/**
 * Open Yahoo sign-in (web OAuth) or the native in-app Yahoo browser.
 * Pass matchupUrl/week on native to jump straight to the Matchup tab.
 */
export async function openYahooLogin(options = {}) {
  if (Capacitor.isNativePlatform()) {
    const identity = yahooIdentity(options);
    const week = options?.week != null && options.week !== '' ? String(options.week) : undefined;
    const payload = {};
    if (identity.matchupUrl) payload.matchupUrl = identity.matchupUrl;
    if (week) payload.week = week;
    return Object.keys(payload).length ? YahooLogin.login(payload) : YahooLogin.login();
  }
  const response = await fetch('/api/auth/yahoo/login?format=json', {
    headers: { Accept: 'application/json' }
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || !data.url) {
    throw new Error(data.error || 'Missing Yahoo Client ID in .env');
  }
  window.location.assign(data.url);
}
