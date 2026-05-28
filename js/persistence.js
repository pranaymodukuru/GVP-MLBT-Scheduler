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

function buildSnapshot() {
  return JSON.stringify({
    savedAt:              new Date().toISOString(),
    TEACHERS:             state.TEACHERS,
    CLASS_CONFIG:         state.CLASS_CONFIG,
    SUBJECT_FREQ:         state.SUBJECT_FREQ,
    SUBJECT_MIN_FREQ:     state.SUBJECT_MIN_FREQ,
    TEACHER_AVAILABILITY: state.TEACHER_AVAILABILITY,
    CONSTRAINTS:          state.CONSTRAINTS,
    timetable:            state.timetable,
  }, null, 2);
}

function timestampedFilename() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `timetable_${ts}.json`;
}

/** Fetch the list of saved schedules from the server. Returns [{filename, mtime}] or null. */
export async function fetchSavedList() {
  try {
    const res = await fetch('/saved-schedules');
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

/** Fetch the latest saved schedule from the server. Returns {filename, data} or null. */
export async function fetchLatest() {
  try {
    const res = await fetch('/latest-schedule');
    if (res.status === 204) return null; // no saves yet
    if (!res.ok) return null;
    return await res.json(); // { filename, data }
  } catch (_) {
    return null; // server not running
  }
}

/** Save the current state — POSTs to /save (server.py) if available, else downloads */
export async function exportJSON() {
  const json = buildSnapshot();
  const filename = timestampedFilename();

  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Filename': filename },
      body: json,
    });
    if (res.ok) {
      const { saved } = await res.json();
      return { saved };
    }
  } catch (_) {
    // server not running — fall through to download
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = filename;
  a.click();
  return { saved: filename };
}
