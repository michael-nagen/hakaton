// ── Lesson Assistant — personalization persistence ───────────────────
//
// Persists the active teaching preference on-device (localStorage), matching how
// the rest of the app persists small UI prefs. Isolated behind this module so
// "remove personalization" can also delete it from storage. Non-fatal on any
// storage error (falls back to in-memory only).

import type { TeachingPreference } from './lesson-assistant.types';

const KEY = 'maestro.teachingPreference';

export function loadTeachingPreference(): TeachingPreference | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TeachingPreference>;
    if (!parsed || typeof parsed.instruction !== 'string' || !parsed.instruction.trim()) return null;
    if (parsed.source !== 'preset' && parsed.source !== 'custom') return null;
    return {
      source: parsed.source,
      instruction: parsed.instruction,
      label: parsed.label,
      presetId: parsed.presetId,
    };
  } catch {
    return null;
  }
}

export function saveTeachingPreference(pref: TeachingPreference): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    // Non-fatal: preference still lives in memory for this session.
  }
}

export function clearTeachingPreference(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
