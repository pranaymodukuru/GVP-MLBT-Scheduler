// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — localStorage save/load and JSON export
// This module is purely data-layer: it does not call any render functions.
// UI orchestration (banners, toasts, re-renders after import) lives in app.js.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { STORAGE_KEY } from '../config/school-config.js';

/** Serialise current state to localStorage */
export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      savedAt:              new Date().toISOString(),
      TEACHERS:             state.TEACHERS,
      CLASS_CONFIG:         state.CLASS_CONFIG,
      SUBJECT_FREQ:         state.SUBJECT_FREQ,
      SUBJECT_MIN_FREQ:          state.SUBJECT_MIN_FREQ,
      SUBJECT_MUST_APPEAR_DAILY: state.SUBJECT_MUST_APPEAR_DAILY,
      TEACHER_AVAILABILITY: state.TEACHER_AVAILABILITY,
      CONSTRAINTS:          state.CONSTRAINTS,
      timetable:            state.timetable,
    }));
  } catch (e) { /* storage full or unavailable — silently ignore */ }
}

/** Load snapshot from localStorage. Returns the parsed object or null. */
export function loadSavedSnap() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : null;
  } catch (e) { return null; }
}

/** Overwrite mutable state with values from a snapshot object */
export function applySnap(snap) {
  if (snap.TEACHERS)             state.TEACHERS             = snap.TEACHERS;
  if (snap.CLASS_CONFIG)         state.CLASS_CONFIG         = snap.CLASS_CONFIG;
  if (snap.SUBJECT_FREQ)         state.SUBJECT_FREQ         = snap.SUBJECT_FREQ;
  if (snap.SUBJECT_MIN_FREQ)          state.SUBJECT_MIN_FREQ          = snap.SUBJECT_MIN_FREQ;
  if (snap.SUBJECT_MUST_APPEAR_DAILY) state.SUBJECT_MUST_APPEAR_DAILY = snap.SUBJECT_MUST_APPEAR_DAILY;
  if (snap.TEACHER_AVAILABILITY) state.TEACHER_AVAILABILITY = snap.TEACHER_AVAILABILITY;
  if (snap.CONSTRAINTS)          state.CONSTRAINTS          = snap.CONSTRAINTS;
  if (snap.timetable)            state.timetable            = snap.timetable;
}

/** Download the current state as a JSON file */
export function exportJSON() {
  const blob = new Blob([JSON.stringify({
    savedAt:              new Date().toISOString(),
    TEACHERS:             state.TEACHERS,
    CLASS_CONFIG:         state.CLASS_CONFIG,
    SUBJECT_FREQ:         state.SUBJECT_FREQ,
    SUBJECT_MIN_FREQ:     state.SUBJECT_MIN_FREQ,
    TEACHER_AVAILABILITY: state.TEACHER_AVAILABILITY,
    CONSTRAINTS:          state.CONSTRAINTS,
    timetable:            state.timetable,
  }, null, 2)], { type: 'application/json' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `timetable_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
