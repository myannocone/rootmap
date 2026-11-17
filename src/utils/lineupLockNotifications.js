import { Capacitor } from '@capacitor/core';
import { prepareCrossFireAlerts } from './nativeFeedback.js';
import {
  formatRootMapNotification,
  NOTIFICATION_CATEGORIES
} from './notificationFormatter.js';
import { isActiveStarterSlot, isBeforeKickoff } from './zeroProjection.js';

const SCHEDULED_KEY = 'rootmap_lineup_lock_ids';
const PRE_LOCK_MS = 30 * 60 * 1000;

function notificationId(text) {
  let hash = 0;
  for (const char of String(text || '')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return (hash % 2147483646) + 1;
}

function sundayWindowLabel(kickoffMs) {
  const date = new Date(kickoffMs);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  if (parts.weekday === 'Mon') return 'Monday Night';
  if (parts.weekday === 'Thu') return 'Thursday Night';
  if (parts.weekday !== 'Sun') return `${parts.weekday || 'Upcoming'} Slate`;
  const minutes = (Number(parts.hour) * 60) + Number(parts.minute);
  if (minutes < 12 * 60) return 'Sunday Morning';
  if (minutes < 16 * 60) return 'Sunday 1:00 PM';
  if (minutes < 19 * 60) return 'Sunday 4:00 PM';
  return 'Sunday Night';
}

export function windowLabelForKickoff(kickoffMs) {
  return sundayWindowLabel(kickoffMs);
}

function readScheduledIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '[]');
    return Array.isArray(raw) ? raw.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function writeScheduledIds(ids) {
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // optional
  }
}

function collectUpcomingKickoffs(leagues, games, now) {
  const byWindow = new Map();
  (leagues || []).forEach((league) => {
    const starters = [
      ...(league?.portfolio || []),
      ...(league?.userTeam?.starters || []),
      ...(league?.starters || [])
    ];
    starters.forEach((player) => {
      if (!isActiveStarterSlot(player)) return;
      if (!isBeforeKickoff(player, games, now)) return;
      const kickoff = Date.parse(player?.kickoff || '');
      if (!Number.isFinite(kickoff) || kickoff <= now.getTime()) return;
      const windowMs = Math.floor(kickoff / 60000) * 60000;
      byWindow.set(windowMs, windowMs);
    });
  });
  return [...byWindow.keys()].sort((a, b) => a - b);
}

/**
 * Schedule one LINEUP LOCK local notification per upcoming kickoff window
 * at kickoff - 30 minutes. Cancels stale ids on refresh.
 */
export async function syncLineupLockNotifications({
  leagues,
  games = [],
  week,
  enabled = true,
  now = new Date()
} = {}) {
  if (!Capacitor.isNativePlatform()) return [];
  const previous = readScheduledIds();
  if (!enabled) {
    if (previous.length) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) });
      } catch {
        // best-effort
      }
      writeScheduledIds([]);
    }
    return [];
  }

  await prepareCrossFireAlerts();
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const nowDate = now instanceof Date ? now : new Date(now);
  const kickoffs = collectUpcomingKickoffs(leagues, games, nowDate);
  const nextIds = [];
  const notifications = [];

  kickoffs.forEach((kickoffMs) => {
    const fireAt = kickoffMs - PRE_LOCK_MS;
    if (!(fireAt > instant) || !(kickoffMs > instant)) return;
    const label = windowLabelForKickoff(kickoffMs);
    const id = notificationId(`lineup-lock|${week}|${kickoffMs}`);
    const formatted = formatRootMapNotification(NOTIFICATION_CATEGORIES.LINEUP_LOCK, {
      windowLabel: label
    });
    nextIds.push(id);
    notifications.push({
      id,
      title: formatted.title,
      body: formatted.body,
      schedule: { at: new Date(fireAt), allowWhileIdle: true },
      extra: { category: formatted.category, week: Number(week) || null, kickoff: kickoffMs }
    });
  });

  const stale = previous.filter((id) => !nextIds.includes(id));
  if (stale.length) {
    try {
      await LocalNotifications.cancel({ notifications: stale.map((id) => ({ id })) });
    } catch {
      // ignore
    }
  }

  if (notifications.length) {
    try {
      await LocalNotifications.cancel({ notifications: nextIds.map((id) => ({ id })) });
    } catch {
      // ignore
    }
    await LocalNotifications.schedule({ notifications });
  }

  writeScheduledIds(nextIds);
  return nextIds;
}
