// ── Lesson Assistant — personalization persistence tests ─────────────
//
// Node vitest has no localStorage, so we install a small in-memory mock. This
// proves save → load round-trips and that clearing removes it from storage
// (the "Remove personalization" requirement).

import { beforeEach, describe, expect, it } from 'vitest';
import { clearTeachingPreference, loadTeachingPreference, saveTeachingPreference } from './personalization-store';
import { presetPreference } from './personalization';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

describe('personalization persistence', () => {
  it('saves and loads a preference', () => {
    const pref = presetPreference('step_by_step')!;
    saveTeachingPreference(pref);
    const loaded = loadTeachingPreference();
    expect(loaded?.presetId).toBe('step_by_step');
    expect(loaded?.instruction).toBe(pref.instruction);
  });

  it('clear removes the preference from localStorage', () => {
    saveTeachingPreference(presetPreference('real_world')!);
    expect(loadTeachingPreference()).not.toBeNull();
    clearTeachingPreference();
    expect(loadTeachingPreference()).toBeNull();
  });

  it('returns null for malformed / empty stored values', () => {
    localStorage.setItem('maestro.teachingPreference', '{"nope":true}');
    expect(loadTeachingPreference()).toBeNull();
  });
});
