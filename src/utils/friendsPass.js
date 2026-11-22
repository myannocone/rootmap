/**
 * Season invite codes that unlock unlimited leagues without a paid subscription.
 * Redemption never calls StoreKit or RevenueCat purchase APIs.
 */
export const FRIENDS_PASS_SEASON = '2026';
const FRIENDS_PASS_KEY = 'rootmap_friends_pass';

const BUILTIN_CODES = ['ROOTMAP-FRIENDS-2026', 'FRIENDS-PASS-2026'];

export function normalizeFriendsCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/[^A-Z0-9-]/g, '');
}

function friendsAllowlist() {
  const codes = new Set(BUILTIN_CODES.map(normalizeFriendsCode));
  const extra = String(import.meta.env?.VITE_FRIENDS_PASS_CODES || '');
  extra.split(',').forEach((code) => {
    const normalized = normalizeFriendsCode(code);
    if (normalized) codes.add(normalized);
  });
  return codes;
}

export function readFriendsPass() {
  try {
    const raw = JSON.parse(localStorage.getItem(FRIENDS_PASS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const season = String(raw.season || '').trim();
    const code = normalizeFriendsCode(raw.code);
    if (!season || !code) return null;
    return {
      season,
      code,
      grantedAt: String(raw.grantedAt || '')
    };
  } catch {
    return null;
  }
}

export function friendsPassGrantsUnlimited(pass = readFriendsPass()) {
  if (!pass || pass.season !== FRIENDS_PASS_SEASON) return false;
  return friendsAllowlist().has(pass.code);
}

export function grantFriendsPass(rawCode) {
  const code = normalizeFriendsCode(rawCode);
  if (!code) {
    return { ok: false, message: 'Enter a Friends Pass code.' };
  }
  if (!friendsAllowlist().has(code)) {
    return { ok: false, message: 'That Friends Pass code is not valid for this season.' };
  }
  const pass = {
    season: FRIENDS_PASS_SEASON,
    code,
    grantedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(FRIENDS_PASS_KEY, JSON.stringify(pass));
  } catch {
    return { ok: false, message: 'Friends Pass could not be saved on this device.' };
  }
  return { ok: true, pass };
}
