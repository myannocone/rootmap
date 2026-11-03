import { Capacitor } from '@capacitor/core';
import { SITE_ORIGIN } from './siteOrigin';

export async function openYahooLogin() {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: `${SITE_ORIGIN}/api/auth/yahoo/login?app=1` });
    return;
  }
  window.location.assign('/api/auth/yahoo/login');
}
