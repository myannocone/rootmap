import assert from 'node:assert/strict';
import test from 'node:test';
import { clampFreeActiveHidden, MAX_FREE_ACTIVE_LEAGUES } from './proEntitlement.js';
import {
  FAMILY_UNLOCK_OFF_MESSAGE,
  FAMILY_UNLOCK_ON_MESSAGE,
  FAMILY_UNLOCK_STORAGE_KEY,
  loadFamilyUnlock,
  maxLeaguesFor,
  noteFamilyUnlockTap,
  saveFamilyUnlock
} from './familyUnlock.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};

test('family unlock defaults off and caps the board at 2 leagues', () => {
  store.clear();
  assert.equal(loadFamilyUnlock(), false);
  assert.equal(maxLeaguesFor(false), 2);
  assert.equal(maxLeaguesFor(false), MAX_FREE_ACTIVE_LEAGUES);
  assert.equal(FAMILY_UNLOCK_ON_MESSAGE, 'Multi-league test mode unlocked');
  assert.equal(FAMILY_UNLOCK_OFF_MESSAGE, 'Standard 2-league cap restored');
});

test('saving the flag lifts the cap to Infinity and clearing it restores 2', () => {
  saveFamilyUnlock(true);
  assert.equal(store.get(FAMILY_UNLOCK_STORAGE_KEY), '1');
  assert.equal(loadFamilyUnlock(), true);
  assert.equal(maxLeaguesFor(true), Infinity);

  saveFamilyUnlock(false);
  assert.equal(store.has(FAMILY_UNLOCK_STORAGE_KEY), false);
  assert.equal(loadFamilyUnlock(), false);
  assert.equal(maxLeaguesFor(loadFamilyUnlock()), MAX_FREE_ACTIVE_LEAGUES);
});

test('five quick Week-badge taps trigger, and a slow tap starts over', () => {
  let stamps = [];
  let now = 1_000;
  for (let i = 0; i < 4; i += 1) {
    const result = noteFamilyUnlockTap(stamps, now);
    assert.equal(result.triggered, false);
    assert.equal(result.burst, i > 0);
    stamps = result.stamps;
    now += 250;
  }
  const fifth = noteFamilyUnlockTap(stamps, now);
  assert.equal(fifth.triggered, true);
  assert.deepEqual(fifth.stamps, []);

  const first = noteFamilyUnlockTap([], 10_000);
  const late = noteFamilyUnlockTap(first.stamps, 10_000 + 3_000);
  assert.equal(late.triggered, false);
  assert.equal(late.burst, false);
  assert.equal(late.stamps.length, 1);
});

test('an infinite cap does not hide leagues, and the default cap still keeps 2', () => {
  const leagues = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const open = clampFreeActiveHidden(leagues, new Set(), Infinity);
  assert.equal(open.size, 0);
  const capped = clampFreeActiveHidden(leagues, new Set());
  assert.deepEqual([...capped], ['c']);
});
