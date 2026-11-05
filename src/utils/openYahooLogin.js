import { Capacitor } from '@capacitor/core';
import { SITE_ORIGIN } from './siteOrigin';

export async function openYahooLogin() {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: `${SITE_ORIGIN}/api/auth/yahoo/login?app=1` });
    return;
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
