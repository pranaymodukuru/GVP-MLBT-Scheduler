// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPER FUNCTIONS — no DOM access, no side effects
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { SAT_HALF_BASES, UPPER_BASES, SECTION_LABELS, NO_P8_CLASSES, COMBINED_SECTIONS, COMBINABLE_GROUPS, AFTER_LUNCH_PERIODS, SUBJECTS_CONFIG } from '../config/school-config.js';

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

/**
 * Returns other section IDs that are ACTUALLY combined with secId at the given
 * day + period — i.e. the timetable has the same teacher+subject there AND the
 * pairing is an intentional combined group (not a scheduling conflict).
 */
export function getCombinedSections(secId, day, periodId) {
  const cell = (state.timetable[secId] || {})[day]?.[periodId];
  if (!cell?.teacherId || !cell?.subject) return [];

  const { teacherId, subject } = cell;
  const { base: myBase } = parseSection(secId);
  const isAfterLunch = AFTER_LUNCH_PERIODS.includes(periodId);
  const fixedGroup   = COMBINED_SECTIONS.find(
    cs => cs.period === periodId && cs.sections.includes(secId)
  );

  return allSectionIds().filter(s => {
    if (s === secId) return false;
    const c = (state.timetable[s] || {})[day]?.[periodId];
    if (c?.teacherId !== teacherId || c?.subject !== subject) return false;

    const { base: otherBase } = parseSection(s);

    if (fixedGroup) return fixedGroup.sections.includes(s);

    if (isAfterLunch) {
      return COMBINABLE_GROUPS.some(g => g.includes(myBase) && g.includes(otherBase));
    }

    return false;
  });
}

/** Returns combinable sections for the same period/day that share the subject
 *  but have a different teacher assigned — each entry is {secId, teacherName}. */
export function getCombinableDiffTeacher(secId, day, periodId) {
  const cell = (state.timetable[secId] || {})[day]?.[periodId];
  if (!cell?.subject) return [];

  const { teacherId, subject } = cell;
  const { base: myBase } = parseSection(secId);
  const isAfterLunch = AFTER_LUNCH_PERIODS.includes(periodId);
  const fixedGroup   = COMBINED_SECTIONS.find(
    cs => cs.period === periodId && cs.sections.includes(secId)
  );

  return allSectionIds().flatMap(s => {
    if (s === secId) return [];
    const c = (state.timetable[s] || {})[day]?.[periodId];
    if (c?.subject !== subject) return [];
    if (c?.teacherId === teacherId) return [];       // same teacher — already shown by getCombinedSections

    const { base: otherBase } = parseSection(s);
    let inGroup = false;
    if (fixedGroup) {
      inGroup = fixedGroup.sections.includes(s);
    } else if (isAfterLunch) {
      inGroup = COMBINABLE_GROUPS.some(g => g.includes(myBase) && g.includes(otherBase));
    }
    if (!inGroup) return [];

    const teacher = state.TEACHERS.find(x => x.id === c.teacherId);
    return [{ secId: s, teacherName: teacher ? teacher.name : '⚠️ Unassigned' }];
  });
}

/** Compact section label — strips "Class " prefix and converts " - " to "-" */
export function shortSec(secId) {
  return secId.replace(/^Class /, '').replace(' - ', '-');
}

/**
 * For subjects with allowParallelGroups (e.g. Games), returns 'Indoor' or 'Outdoor'
 * based on a deterministic split of concurrent teacher groups.
 * Returns null if the subject doesn't support parallel groups or only one teacher group exists.
 */
export function getGamesVenue(secId, day, periodId) {
  const cell = (state.timetable[secId] || {})[day]?.[periodId];
  if (!cell?.subject || !SUBJECTS_CONFIG[cell.subject]?.allowParallelGroups) return null;

  // Group all concurrent sections by teacher
  const teacherGroups = {};
  allSectionIds().forEach(s => {
    const c = (state.timetable[s] || {})[day]?.[periodId];
    if (c?.subject === cell.subject) {
      const tid = c.teacherId || '__none__';
      (teacherGroups[tid] ||= []).push(s);
    }
  });

  const sortedTeachers = Object.keys(teacherGroups).sort();
  if (sortedTeachers.length <= 1) return null;

  const flipped   = !!state.venueFlips[`${cell.subject}|${day}|${periodId}`];
  const myTeacher = cell.teacherId || '__none__';
  const isFirst   = sortedTeachers.indexOf(myTeacher) === 0;
  return (isFirst !== flipped) ? 'Indoor' : 'Outdoor';
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
