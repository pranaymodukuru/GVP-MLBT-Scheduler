// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPER FUNCTIONS — no DOM access, no side effects
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { SAT_HALF_BASES, UPPER_BASES, SECTION_LABELS, NO_P8_CLASSES } from '../config/school-config.js';

/** Returns all section IDs in CLASS_CONFIG order, expanding multi-section classes */
export function allSectionIds() {
  const ids = [];
  Object.entries(state.CLASS_CONFIG).forEach(([base, cfg]) => {
    if ((cfg.sections || 1) <= 1) {
      ids.push(base);
    } else {
      SECTION_LABELS.slice(0, cfg.sections).forEach(l => ids.push(`${base} - ${l}`));
    }
  });
  return ids;
}

/** Splits "Class 10 - B" → { base: 'Class 10', label: 'B' } */
export function parseSection(secId) {
  const m = secId.match(/^(.+) - ([A-F])$/);
  return m ? { base: m[1], label: m[2] } : { base: secId, label: 'A' };
}

/** Subject list for a given section ID */
export function getSubjects(secId) {
  return (state.CLASS_CONFIG[parseSection(secId).base] || {}).subjects || [];
}

/** Class teacher ID for a given section ID */
export function getClassTeacherId(secId) {
  const { base, label } = parseSection(secId);
  return (state.CLASS_CONFIG[base]?.sectionTeachers || {})[label] || null;
}

/** True if this class has a half-day Saturday (no P7/P8) */
export function isSatHalf(secId) {
  return SAT_HALF_BASES.includes(parseSection(secId).base);
}

/** True if this class is an upper class (gets Work Review appended) */
export function isUpper(secId) {
  return UPPER_BASES.includes(parseSection(secId).base);
}

/** True if the teacher is available on the given day (and period, if supplied) */
export function isTeacherAvailable(tid, day, period = null) {
  const avail = state.TEACHER_AVAILABILITY[tid] || {};
  if ((avail.blockedDays || []).includes(day)) return false;
  if (period !== null) {
    const t = state.TEACHERS.find(x => x.id === tid);
    if (t?.availablePeriods && !t.availablePeriods.includes(period)) return false;
    if ((avail.blockedPeriods?.[day] || []).includes(period)) return false;
  }
  return true;
}

/**
 * Returns the subjects a teacher can teach for the given base class.
 * Uses teacher.classSubjects[base] when present, otherwise teacher.subjects.
 */
export function getEffectiveSubjects(teacher, base) {
  return (teacher.classSubjects && teacher.classSubjects[base]) || teacher.subjects;
}

/** True if a period should be scheduled/shown for the given section */
export function isActivePeriod(secId, periodId) {
  if (periodId === 'P8' && NO_P8_CLASSES.includes(parseSection(secId).base)) return false;
  return true;
}

/** Fisher–Yates shuffle — returns a new shuffled array */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
