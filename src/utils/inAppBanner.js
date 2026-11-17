/**
 * Tiny pub/sub for foreground RootMap toast banners.
 * App.jsx subscribes; notification emitters publish formatted payloads.
 */

const listeners = new Set();
const HISTORY_KEY = 'rootmap_notification_history';
const MAX_HISTORY = 40;

export function subscribeInAppBanners(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishInAppBanner(payload) {
  if (!payload?.title) return;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    title: payload.title,
    body: payload.body || '',
    category: payload.category || '',
    outlook: payload.outlook || null,
    accent: payload.accent || '#0F9D68',
    surfaceClass: payload.surfaceClass || 'bg-[#0F9D68] text-white border-[#0F9D68]'
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
      accent: entry.accent
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // storage optional
  }
}

export function readBannerHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
