/**
 * Tiny pub/sub for foreground RootMap toast banners.
 * App.jsx subscribes; notification emitters publish formatted payloads.
 * Only the active week's live or upcoming alerts are surfaced.
 */
import { getActiveSlate } from '../data/nflSchedule.js';

const listeners = new Set();
const HISTORY_KEY = 'rootmap_notification_history';
const MAX_HISTORY = 40;
const LIVE_OR_UPCOMING = new Set(['LIVE', 'IN_PROGRESS', 'UPCOMING', 'SCHEDULED']);

export function isCurrentWeekAlert(week, phase) {
  const status = String(phase || '').toUpperCase();
  if (!LIVE_OR_UPCOMING.has(status)) return false;
  const active = Number(getActiveSlate()?.week);
  const current = Number(week);
  if (!Number.isFinite(active) || !Number.isFinite(current)) return false;
  return current === active;
}

export function subscribeInAppBanners(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishInAppBanner(payload) {
  if (!payload?.title) return null;
  if (!isCurrentWeekAlert(payload.week, payload.phase)) return null;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    title: payload.title,
    body: payload.body || '',
    category: payload.category || '',
    outlook: payload.outlook || null,
    accent: payload.accent || '#0F9D68',
    surfaceClass: payload.surfaceClass || 'bg-[#0F9D68] text-white border-[#0F9D68]',
    week: Number(payload.week),
    phase: String(payload.phase || '').toUpperCase()
  };
  listeners.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      // ignore subscriber errors
    }
  });
  rememberBanner(entry);
  return entry;
}

function rememberBanner(entry) {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const list = Array.isArray(raw) ? raw : [];
    list.unshift({
      id: entry.id,
      at: entry.at,
      title: entry.title,
      body: entry.body,
      category: entry.category,
      outlook: entry.outlook,
      accent: entry.accent,
      surfaceClass: entry.surfaceClass,
      week: entry.week,
      phase: entry.phase
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // storage optional
  }
}

export function readBannerHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const list = Array.isArray(raw) ? raw : [];
    return list.filter((entry) => isCurrentWeekAlert(entry?.week, entry?.phase));
  } catch {
    return [];
  }
}
