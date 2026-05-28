// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — localStorage save/load and JSON export
// This module is purely data-layer: it does not call any render functions.
// UI orchestration (banners, toasts, re-renders after import) lives in app.js.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { STORAGE_KEY, DEFAULT_CLASS_CONFIG, DEFAULT_TEACHERS, DEFAULT_TEACHER_AVAILABILITY, RAW_CONFIG } from '../config/school-config.js';

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
  if (snap.TEACHER_AVAILABILITY) {
    state.TEACHER_AVAILABILITY = snap.TEACHER_AVAILABILITY;
    // Seed config-level defaults for teachers that have none saved yet
    for (const [tid, defaults] of Object.entries(DEFAULT_TEACHER_AVAILABILITY)) {
      if (!state.TEACHER_AVAILABILITY[tid]) {
        state.TEACHER_AVAILABILITY[tid] = JSON.parse(JSON.stringify(defaults));
      }
    }
  }
  if (snap.CONSTRAINTS)          state.CONSTRAINTS          = snap.CONSTRAINTS;
  if (snap.timetable)            state.timetable            = snap.timetable;
}

/**
 * Reconstruct a school-config.json-shaped object from current state.
 * Static fields (periods, days, colors, etc.) are preserved from RAW_CONFIG;
 * editable admin fields (teachers, classes, subjects freq, constraints) come
 * from state.
 */
function buildConfigSnapshot() {
  const out = JSON.parse(JSON.stringify(RAW_CONFIG));

  out.constraints = { ...state.CONSTRAINTS };

  // Rebuild teachers: preserve static per-teacher fields (classSubjects,
  // availablePeriods, etc.) and write current name/subjects/classes +
  // period-level unavailability derived from TEACHER_AVAILABILITY.
  const origById = Object.fromEntries((RAW_CONFIG.teachers || []).map(t => [t.id, t]));
  out.teachers = state.TEACHERS.map(t => {
    const orig  = origById[t.id] || {};
    const avail = state.TEACHER_AVAILABILITY[t.id] || {};
    const entry = {
      ...orig,
      id:       t.id,
      name:     t.name,
      subjects: [...t.subjects],
      classes:  [...t.classes],
    };
    const bp = avail.blockedPeriods;
    if (bp && Object.keys(bp).length) {
      entry.unavailablePeriods = JSON.parse(JSON.stringify(bp));
    } else {
      delete entry.unavailablePeriods;
    }
    return entry;
  });

  // Update freq fields on existing subjects (preserve color/textColor/flags).
  for (const [name, freq] of Object.entries(state.SUBJECT_FREQ)) {
    if (out.subjects[name]) out.subjects[name].periodsPerWeek = freq;
  }
  for (const [name, min] of Object.entries(state.SUBJECT_MIN_FREQ)) {
    if (out.subjects[name]) out.subjects[name].minPeriodsPerWeek = min;
  }
  for (const [name, daily] of Object.entries(state.SUBJECT_MUST_APPEAR_DAILY)) {
    if (out.subjects[name]) out.subjects[name].mustAppearDaily = daily;
  }

  out.classes = JSON.parse(JSON.stringify(state.CLASS_CONFIG));

  return out;
}

/** POST current state as school-config.json to the dev server. Fire-and-forget. */
export async function saveConfig() {
  const snapshot = buildConfigSnapshot();
  try {
    const res = await fetch('/save-config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(snapshot, null, 2),
    });
    if (!res.ok) console.warn('Config save failed:', res.status);
  } catch (_) {
    // server not running — silently ignore
  }
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

/** Fetch the backup schedule from the server. Returns {filename, data} or null. */
export async function fetchBackup() {
  try {
    const res = await fetch('/backup-schedule');
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return await res.json(); // { filename, data }
  } catch (_) {
    return null;
  }
}

/** Save current state as the backup (default) schedule. Returns true if server saved. */
export async function saveAsBackup() {
  const json = buildSnapshot();
  try {
    const res = await fetch('/save-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    if (res.ok) return true;
  } catch (_) {
    // server not running — fall through to download
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'backup.json';
  a.click();
  return false;
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
