// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — localStorage save/load and JSON export
// This module is purely data-layer: it does not call any render functions.
// UI orchestration (banners, toasts, re-renders after import) lives in app.js.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { STORAGE_KEY, DEFAULT_CLASS_CONFIG, DEFAULT_TEACHERS } from '../config/school-config.js';

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
  if (snap.TEACHERS) {
    // Merge saved teachers with defaults to pick up any new subjects/classes
    // added to the canonical DEFAULT_TEACHERS (avoid losing new data when
    // an older snapshot is applied).
    const merged = JSON.parse(JSON.stringify(snap.TEACHERS));
    const byId = Object.fromEntries(merged.map(t => [t.id, t]));
    for (const d of DEFAULT_TEACHERS) {
      const saved = byId[d.id];
      if (!saved) {
        merged.push(JSON.parse(JSON.stringify(d)));
      } else {
        // Ensure subjects include any new defaults (preserve saved order)
        saved.subjects = saved.subjects || [];
        const seen = new Set(saved.subjects);
        for (const s of (d.subjects || [])) if (!seen.has(s)) saved.subjects.push(s);

        // Ensure classes include any new defaults
        saved.classes = saved.classes || [];
        const seenC = new Set(saved.classes);
        for (const c of (d.classes || [])) if (!seenC.has(c)) saved.classes.push(c);

        // Merge classSubjects maps (union of arrays)
        if (d.classSubjects) {
          saved.classSubjects = saved.classSubjects || {};
          for (const [base, subs] of Object.entries(d.classSubjects)) {
            const cur = saved.classSubjects[base] || [];
            const sseen = new Set(cur);
            for (const s of subs) if (!sseen.has(s)) cur.push(s);
            saved.classSubjects[base] = cur;
          }
        }

        // Ensure availablePeriods present
        if (d.availablePeriods && !saved.availablePeriods) saved.availablePeriods = JSON.parse(JSON.stringify(d.availablePeriods));
      }
    }
    state.TEACHERS = merged;
  }
  if (snap.CLASS_CONFIG) {
    // Merge defaults into loaded class config to include any newly added
    // subjects or classes present in DEFAULT_CLASS_CONFIG but missing from
    // the saved snapshot. This avoids losing new config entries when a
    // user has an older saved schedule.
    const merged = JSON.parse(JSON.stringify(snap.CLASS_CONFIG));
    for (const [base, defCfg] of Object.entries(DEFAULT_CLASS_CONFIG)) {
      if (!merged[base]) {
        merged[base] = JSON.parse(JSON.stringify(defCfg));
      } else {
        // Ensure subjects list includes any new defaults (preserve saved order)
        const savedSubjects = merged[base].subjects || [];
        const defaultSubjects = defCfg.subjects || [];
        const seen = new Set(savedSubjects);
        for (const s of defaultSubjects) if (!seen.has(s)) savedSubjects.push(s);
        merged[base].subjects = savedSubjects;

        // Ensure sections and sectionTeachers exist
        if (merged[base].sections == null && defCfg.sections != null) merged[base].sections = defCfg.sections;
        if (!merged[base].sectionTeachers && defCfg.sectionTeachers) merged[base].sectionTeachers = JSON.parse(JSON.stringify(defCfg.sectionTeachers));
      }
    }
    state.CLASS_CONFIG = merged;
  }
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
