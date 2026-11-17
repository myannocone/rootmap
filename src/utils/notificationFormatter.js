/**
 * Unified RootMap notification copy + palette.
 * Titles: ALL CAPS CATEGORY • CONTEXT (no "RootMap" in single-league titles —
 * iOS already shows the app icon/name). Bodies: at most 2 short sentences, under 95 chars.
 */

export const NOTIFICATION_COLORS = Object.freeze({
  upside: '#0F9D68', // Emerald - chance to win / outperformer
  danger: '#E11D48', // Crimson - danger of loss / inactive / red zone
  lock: '#0D9488' // Deep Teal - lineup locks
});

export const NOTIFICATION_CATEGORIES = Object.freeze({
  NAIL_BITER: 'NAIL BITER',
  RED_ZONE: 'RED ZONE',
  OUTPERFORMER: 'OUTPERFORMER',
  INACTIVE: 'INACTIVE ALERT',
  LINEUP_LOCK: 'LINEUP LOCK',
  CROSS_FIRE: 'CROSS FIRE'
});

const MAX_BODY = 94;

function clipBody(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_BODY) return cleaned;
  const cut = cleaned.slice(0, MAX_BODY - 1);
  const soft = cut.replace(/\s+\S*$/, '');
  return `${(soft.length >= 40 ? soft : cut).trimEnd()}...`;
}

function scoreText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toFixed(1).replace(/\.0$/, '');
}

/**
 * @param {string} category - ALL CAPS category label
 * @param {object} options
 * @param {string} [options.leagueName]
 * @param {number} [options.leagueCount] - multi-league aggregate
 * @param {string} [options.windowLabel] - for LINEUP LOCK
 * @param {string} [options.context] - explicit context override
 */
export function formatNotificationTitle(category, options = {}) {
  const cat = String(category || '').trim().toUpperCase();
  const windowLabel = String(options.windowLabel || '').trim();
  if (cat === NOTIFICATION_CATEGORIES.LINEUP_LOCK && windowLabel) {
    return `${cat} • ${windowLabel}`;
  }

  const count = Number(options.leagueCount);
  if (Number.isFinite(count) && count > 1) {
    return `${cat} • ${count} RootMap Leagues`;
  }

  if (options.context) {
    return `${cat} • ${String(options.context).trim()}`;
  }

  const leagueName = String(options.leagueName || '').trim();
  if (leagueName) return `${cat} • ${leagueName}`;
  return cat;
}

export function notificationAccent(category, outlook = null) {
  const cat = String(category || '').trim().toUpperCase();
  if (cat === NOTIFICATION_CATEGORIES.LINEUP_LOCK) return NOTIFICATION_COLORS.lock;
  if (cat === NOTIFICATION_CATEGORIES.INACTIVE) return NOTIFICATION_COLORS.danger;
  if (cat === NOTIFICATION_CATEGORIES.RED_ZONE) return NOTIFICATION_COLORS.danger;
  if (cat === NOTIFICATION_CATEGORIES.OUTPERFORMER) return NOTIFICATION_COLORS.upside;
  if (cat === NOTIFICATION_CATEGORIES.CROSS_FIRE) return NOTIFICATION_COLORS.danger;
  if (cat === NOTIFICATION_CATEGORIES.NAIL_BITER) {
    return outlook === 'danger' ? NOTIFICATION_COLORS.danger : NOTIFICATION_COLORS.upside;
  }
  return NOTIFICATION_COLORS.upside;
}

/** Tailwind-friendly surface classes for in-app banners / drawer cards. */
export function notificationSurfaceClass(category, outlook = null) {
  const accent = notificationAccent(category, outlook);
  if (accent === NOTIFICATION_COLORS.danger) {
    return 'bg-[#E11D48] text-white border-[#E11D48]';
  }
  if (accent === NOTIFICATION_COLORS.lock) {
    return 'bg-[#0D9488] text-white border-[#0D9488]';
  }
  return 'bg-[#0F9D68] text-white border-[#0F9D68]';
}

export function formatNailBiterBody({ outlook, playerName, multiCount } = {}) {
  if (multiCount > 1) {
    const lead = outlook === 'danger'
      ? 'Watch out \u2014 losses are still in play.'
      : 'You have a chance to win!';
    return clipBody(`${lead} ${multiCount} leagues kick off in 10 mins.`);
  }
  const lead = outlook === 'danger'
    ? "Watch out \u2014 you're in danger of a loss!"
    : 'You have a chance to win!';
  const who = playerName ? `${playerName} kicks off in 10 mins.` : 'Final slate kicks off in 10 mins.';
  return clipBody(`${lead} ${who}`);
}

export function formatInactiveBody({ playerName, leagueName } = {}) {
  const name = playerName || 'A starter';
  const league = leagueName || 'your league';
  return clipBody(`${name} is inactive in ${league}. Set a replacement before kickoff.`);
}

export function formatCrossFireBody({ playerName, delta, mine, opp } = {}) {
  const name = playerName || 'Player';
  const gain = delta != null ? `+${scoreText(delta)}` : 'points';
  return clipBody(`${name} scored! You gain ${gain} in ${mine || 'your league'}, but so does ${opp || 'your opponent'}.`);
}

export function formatRedZoneBody({ playerName, leagueName } = {}) {
  const name = playerName || 'Your offense';
  const league = leagueName || 'your league';
  return clipBody(`${name} is inside the 20 in ${league}. Stay locked on this drive.`);
}

export function formatOutperformerBody({ playerName, leagueName, delta } = {}) {
  const name = playerName || 'A starter';
  const boom = delta != null ? ` (+${scoreText(delta)})` : '';
  const league = leagueName || 'your league';
  return clipBody(`${name}${boom} is crushing projections in ${league}. Ride the hot hand.`);
}

export function formatLineupLockBody({ windowLabel } = {}) {
  const window = windowLabel || 'this slate';
  return clipBody(`Lineups lock soon for ${window}. Confirm your starters now.`);
}

/**
 * Build a Capacitor / Web Notification payload.
 * @returns {{ title: string, body: string, category: string, outlook: string|null, accent: string, surfaceClass: string }}
 */
export function formatRootMapNotification(category, options = {}) {
  const cat = String(category || '').trim().toUpperCase();
  const outlook = options.outlook === 'danger' ? 'danger' : (options.outlook === 'upside' ? 'upside' : null);
  const title = formatNotificationTitle(cat, options);
  let body = '';

  switch (cat) {
    case NOTIFICATION_CATEGORIES.NAIL_BITER:
      body = formatNailBiterBody(options);
      break;
    case NOTIFICATION_CATEGORIES.INACTIVE:
      body = formatInactiveBody(options);
      break;
    case NOTIFICATION_CATEGORIES.CROSS_FIRE:
      body = formatCrossFireBody(options);
      break;
    case NOTIFICATION_CATEGORIES.RED_ZONE:
      body = formatRedZoneBody(options);
      break;
    case NOTIFICATION_CATEGORIES.OUTPERFORMER:
      body = formatOutperformerBody(options);
      break;
    case NOTIFICATION_CATEGORIES.LINEUP_LOCK:
      body = formatLineupLockBody(options);
      break;
    default:
      body = clipBody(options.body || '');
  }

  return {
    title,
    body,
    category: cat,
    outlook,
    accent: notificationAccent(cat, outlook),
    surfaceClass: notificationSurfaceClass(cat, outlook)
  };
}
