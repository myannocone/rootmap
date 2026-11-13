import { Capacitor } from '@capacitor/core';
import { YahooLogin } from './yahooNative';

export async function openYahooLogin() {
  if (Capacitor.isNativePlatform()) {
    return YahooLogin.login();
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
