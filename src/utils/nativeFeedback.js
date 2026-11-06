import { Capacitor } from '@capacitor/core';

export async function tapHaptic(kind = 'light') {
  if (!Capacitor.isNativePlatform()) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  const style = kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
  await Haptics.impact({ style });
}

let notificationsReady = false;

export async function prepareCrossFireAlerts() {
  if (!Capacitor.isNativePlatform() || notificationsReady) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const perm = await LocalNotifications.requestPermissions();
  notificationsReady = perm.display === 'granted';
}

const ZERO_ALERT_KEY = 'rootmap_zero_proj_notified';
const notifiedZeroProj = new Set();
let zeroProjLoaded = false;
let zeroPermissionAsked = false;

function loadZeroProjNotified() {
  if (zeroProjLoaded) return;
  zeroProjLoaded = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(ZERO_ALERT_KEY) || '[]');
    if (Array.isArray(saved)) saved.forEach((id) => notifiedZeroProj.add(String(id)));
  } catch {
    // session storage is optional
  }
}

function rememberZeroProj(ids) {
  ids.forEach((id) => notifiedZeroProj.add(id));
  try {
    sessionStorage.setItem(ZERO_ALERT_KEY, JSON.stringify([...notifiedZeroProj]));
  } catch {
    // session storage is optional
  }
}

function notificationId(text) {
  let hash = 0;
  for (const char of String(text || '')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return (hash % 2147483646) + 1;
}

export async function prepareZeroProjectionAlerts({ request = false } = {}) {
  if (Capacitor.isNativePlatform()) {
    await prepareCrossFireAlerts();
    return notificationsReady;
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (!request && zeroPermissionAsked) return false;
  zeroPermissionAsked = true;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export async function notifyZeroProjectionAlerts(alerts) {
  loadZeroProjNotified();
  const fresh = (alerts || []).filter((alert) => alert?.id && alert?.name && !notifiedZeroProj.has(alert.id));
  if (!fresh.length) return;
  const granted = await prepareZeroProjectionAlerts();
  if (!granted) return;
  rememberZeroProj(fresh.map((alert) => alert.id));
  if (Capacitor.isNativePlatform()) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: fresh.map((alert) => ({
        id: notificationId(alert.id),
        title: '🚨 Inactive Starter Alert',
        body: `${alert.name} is starting in ${alert.leagueName} with 0.0 projected points. Tap to adjust your lineup before kickoff.`,
        schedule: { at: new Date(Date.now() + 800) }
      }))
    });
    return;
  }
  fresh.forEach((alert) => {
    const body = `${alert.name} is starting in ${alert.leagueName} with 0.0 projected points. Tap to adjust your lineup before kickoff.`;
    try {
      new Notification('🚨 Inactive Starter Alert', { body });
    } catch {
      // the browser can refuse a notification after permission changes
    }
  });
}

export async function notifyCrossFire({ name, delta, mine, opp }) {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await prepareCrossFireAlerts();
  if (!notificationsReady) return;
  await LocalNotifications.schedule({
    notifications: [{
      id: Math.floor(Date.now() % 2147483647),
      title: 'Cross Fire Alert',
      body: `${name} scored! You gain +${delta} in ${mine}, but Opponent gains +${delta} in ${opp}.`,
      schedule: { at: new Date(Date.now() + 800) }
    }]
  });
}
