/**
 * TEMPORARY — client-side multi-league test unlock.
 *
 * Lets a device show more than the free 2-league cap without waiting on
 * App Store review or a Sandbox promo code. Stored only in localStorage
 * under `rootmap_family_unlock`. This module does not read or write Yahoo
 * or ESPN session cookies, and it does not change pasted matchup import.
 *
 * Remove before the public launch:
 * 1. Delete this file and src/utils/familyUnlock.test.js.
 * 2. Delete every `familyUnlock` call site in src/App.jsx.
 * Or set FAMILY_UNLOCK_TESTING to false to ignore a saved flag and disable
 * the Week-badge gesture without deleting those call sites.
 */

import { MAX_FREE_ACTIVE_LEAGUES } from './proEntitlement.js';

/** Flip to false to disable the test unlock ahead of public launch. */
export const FAMILY_UNLOCK_TESTING = true;

export const FAMILY_UNLOCK_STORAGE_KEY = 'rootmap_family_unlock';
export const FAMILY_UNLOCK_TAP_COUNT = 5;
export const FAMILY_UNLOCK_TAP_WINDOW_MS = 2500;

export const FAMILY_UNLOCK_ON_MESSAGE = 'Multi-league test mode unlocked';
export const FAMILY_UNLOCK_OFF_MESSAGE = 'Standard 2-league cap restored';

export function loadFamilyUnlock() {
  if (!FAMILY_UNLOCK_TESTING) return false;
  try {
    return localStorage.getItem(FAMILY_UNLOCK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveFamilyUnlock(enabled) {
  try {
    if (FAMILY_UNLOCK_TESTING && enabled) localStorage.setItem(FAMILY_UNLOCK_STORAGE_KEY, '1');
    else localStorage.removeItem(FAMILY_UNLOCK_STORAGE_KEY);
  } catch {
    // preference storage is optional
  }
}

/** Free-board cap. Paid Pro is applied by the caller, not here. */
export function maxLeaguesFor(isUnlocked) {
  const unlocked = FAMILY_UNLOCK_TESTING && Boolean(isUnlocked);
  const maxLeagues = unlocked ? Infinity : MAX_FREE_ACTIVE_LEAGUES;
  return maxLeagues;
}

/**
 * Record one Week-badge tap.
 * `triggered` is true on the 5th tap inside the window (the sequence resets).
 * `burst` is true once a second quick tap arrives, so the picker can stay shut.
 */
export function noteFamilyUnlockTap(stamps, now = Date.now()) {
  if (!FAMILY_UNLOCK_TESTING) {
    return { stamps: [], triggered: false, burst: false };
  }
  const next = (Array.isArray(stamps) ? stamps : []).filter((stamp) => now - stamp <= FAMILY_UNLOCK_TAP_WINDOW_MS);
  next.push(now);
  if (next.length >= FAMILY_UNLOCK_TAP_COUNT) {
    return { stamps: [], triggered: true, burst: true };
  }
  return { stamps: next, triggered: false, burst: next.length > 1 };
}
