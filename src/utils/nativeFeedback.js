import { Capacitor } from '@capacitor/core';
import { isCurrentWeekAlert, publishInAppBanner } from './inAppBanner.js';
import {
  formatRootMapNotification,
  NOTIFICATION_CATEGORIES
} from './notificationFormatter.js';

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

const RED_ZONE_KEY = 'rootmap_redzone_notified';
const notifiedRedZone = new Set();
let redZoneLoaded = false;

const OUTPERFORM_KEY = 'rootmap_outperform_notified';
const notifiedOutperform = new Set();
let outperformLoaded = false;

function rememberSessionSet(key, target, ids) {
  ids.forEach((id) => target.add(String(id)));
  try {
    sessionStorage.setItem(key, JSON.stringify([...target]));
  } catch {
    // session storage is optional
  }
}

function loadSessionIds(key, target, loadedFlag) {
  if (loadedFlag.value) return;
  loadedFlag.value = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) saved.forEach((id) => target.add(String(id)));
  } catch {
    // session storage is optional
  }
}

function loadZeroProjNotified() {
  const flag = { value: zeroProjLoaded };
  loadSessionIds(ZERO_ALERT_KEY, notifiedZeroProj, flag);
  zeroProjLoaded = flag.value;
}

function rememberZeroProj(ids) {
  rememberSessionSet(ZERO_ALERT_KEY, notifiedZeroProj, ids);
}

function notificationId(text) {
  let hash = 0;
  for (const char of String(text || '')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return (hash % 2147483646) + 1;
}

async function scheduleFormatted(formatted, id, meta = {}) {
  if (!isCurrentWeekAlert(meta.week, meta.phase)) return;
  publishInAppBanner({ ...formatted, week: meta.week, phase: meta.phase });
  if (Capacitor.isNativePlatform()) {
    await prepareCrossFireAlerts();
    if (!notificationsReady) return;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title: formatted.title,
        body: formatted.body,
        schedule: { at: new Date(Date.now() + 800) },
        extra: { category: formatted.category, outlook: formatted.outlook }
      }]
    });
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(formatted.title, { body: formatted.body });
    } catch {
      // browser can refuse after permission changes
    }
  }
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

export async function notifyZeroProjectionAlerts(alerts, meta = {}) {
  if (!isCurrentWeekAlert(meta.week, meta.phase || 'upcoming')) return;
  loadZeroProjNotified();
  const fresh = (alerts || []).filter((alert) => alert?.id && alert?.name && !notifiedZeroProj.has(alert.id));
  if (!fresh.length) return;
  const granted = await prepareZeroProjectionAlerts();
  rememberZeroProj(fresh.map((alert) => alert.id));
  for (const alert of fresh) {
    const formatted = formatRootMapNotification(NOTIFICATION_CATEGORIES.INACTIVE, {
      leagueName: alert.leagueName,
      playerName: alert.name
    });
    const banner = { week: meta.week, phase: meta.phase || 'upcoming' };
    if (!granted) {
      publishInAppBanner({ ...formatted, ...banner });
      continue;
    }
    await scheduleFormatted(formatted, notificationId(alert.id), banner);
  }
}

export async function notifyCrossFire({ name, delta, mine, opp, week, phase = 'live' }) {
  if (!isCurrentWeekAlert(week, phase)) return;
  const formatted = formatRootMapNotification(NOTIFICATION_CATEGORIES.CROSS_FIRE, {
    context: name || 'Player',
    playerName: name,
    delta,
    mine,
    opp
  });
  const meta = { week, phase };
  if (!Capacitor.isNativePlatform()) {
    publishInAppBanner({ ...formatted, ...meta });
    return;
  }
  await scheduleFormatted(formatted, Math.floor(Date.now() % 2147483647), meta);
}

export async function notifyRedZoneAlert({ id, playerName, leagueName, week, phase = 'live' }) {
  if (!isCurrentWeekAlert(week, phase)) return;
  const flag = { value: redZoneLoaded };
  loadSessionIds(RED_ZONE_KEY, notifiedRedZone, flag);
  redZoneLoaded = flag.value;
  const key = String(id || `${leagueName}|${playerName}`);
  if (notifiedRedZone.has(key)) return;
  rememberSessionSet(RED_ZONE_KEY, notifiedRedZone, [key]);
  const formatted = formatRootMapNotification(NOTIFICATION_CATEGORIES.RED_ZONE, {
    leagueName,
    playerName
  });
  const meta = { week, phase };
  const granted = await prepareZeroProjectionAlerts();
  if (!granted) {
    publishInAppBanner({ ...formatted, ...meta });
    return;
  }
  await scheduleFormatted(formatted, notificationId(`redzone|${key}`), meta);
}

export async function notifyOutperformerAlert({ id, playerName, leagueName, delta, week, phase = 'live' }) {
  if (!isCurrentWeekAlert(week, phase)) return;
  const flag = { value: outperformLoaded };
  loadSessionIds(OUTPERFORM_KEY, notifiedOutperform, flag);
  outperformLoaded = flag.value;
  const key = String(id || `${leagueName}|${playerName}`);
  if (notifiedOutperform.has(key)) return;
  rememberSessionSet(OUTPERFORM_KEY, notifiedOutperform, [key]);
  const formatted = formatRootMapNotification(NOTIFICATION_CATEGORIES.OUTPERFORMER, {
    leagueName,
    playerName,
    delta
  });
  const meta = { week, phase };
  const granted = await prepareZeroProjectionAlerts();
  if (!granted) {
    publishInAppBanner({ ...formatted, ...meta });
    return;
  }
  await scheduleFormatted(formatted, notificationId(`outperform|${key}`), meta);
}

export async function notifyLineupLock({ windowLabel, id, fireAt, week, phase = 'upcoming' } = {}) {
  if (!isCurrentWeekAlert(week, phase)) return;
  const formatted = formatRootMapNotification(NOTIFICATION_CATEGORIES.LINEUP_LOCK, {
    windowLabel
  });
  const meta = { week, phase };
  if (!Capacitor.isNativePlatform()) {
    publishInAppBanner({ ...formatted, ...meta });
    return;
  }
  await prepareCrossFireAlerts();
  if (!notificationsReady) {
    publishInAppBanner({ ...formatted, ...meta });
    return;
  }
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const notifId = notificationId(id || `lineup-lock|${windowLabel}`);
  const when = fireAt instanceof Date ? fireAt : (fireAt ? new Date(fireAt) : new Date(Date.now() + 800));
  if (!(when.getTime() > Date.now())) {
    publishInAppBanner({ ...formatted, ...meta });
    return;
  }
  await LocalNotifications.schedule({
    notifications: [{
      id: notifId,
      title: formatted.title,
      body: formatted.body,
      schedule: { at: when, allowWhileIdle: true },
      extra: { category: formatted.category }
    }]
  });
}
