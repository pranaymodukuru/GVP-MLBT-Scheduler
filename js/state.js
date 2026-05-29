// ─────────────────────────────────────────────────────────────────────────────
// SHARED MUTABLE STATE
// All modules import { state } from this file and read/write state.* directly.
// Initial values come from config/school-config.js defaults; they are
// overwritten by persistence.js when a localStorage snapshot is loaded.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_TEACHERS,
  DEFAULT_CLASS_CONFIG,
  DEFAULT_SUBJECT_FREQ,
  DEFAULT_SUBJECT_MIN_FREQ,
  DEFAULT_SUBJECT_MUST_APPEAR_DAILY,
  DEFAULT_TEACHER_AVAILABILITY,
  DEFAULT_CONSTRAINTS,
} from '../config/school-config.js';

export const state = {
  // ── School data (overwritten by localStorage snap on load) ──
  TEACHERS:             DEFAULT_TEACHERS.map(t => ({
    ...t,
    subjects: [...t.subjects],
    classes:  [...t.classes],
    ...(t.classSubjects    && { classSubjects:    JSON.parse(JSON.stringify(t.classSubjects)) }),
    ...(t.availablePeriods && { availablePeriods: [...t.availablePeriods] }),
  })),
  CLASS_CONFIG:         JSON.parse(JSON.stringify(DEFAULT_CLASS_CONFIG)),
  SUBJECT_FREQ:         { ...DEFAULT_SUBJECT_FREQ },
  SUBJECT_MIN_FREQ:          { ...DEFAULT_SUBJECT_MIN_FREQ },
  SUBJECT_MUST_APPEAR_DAILY: { ...DEFAULT_SUBJECT_MUST_APPEAR_DAILY },
  TEACHER_AVAILABILITY: JSON.parse(JSON.stringify(DEFAULT_TEACHER_AVAILABILITY)),
  CONSTRAINTS:          { ...DEFAULT_CONSTRAINTS },

  // ── Timetable ──
  timetable:            {},   // timetable[sectionId][day][period] = { subject, teacherId, locked? }

  // ── Conflict tracking ──
  conflictRecords:      [],   // [{ teacherName, teacherId, day, period, sec1, sec2 }]
  conflictSet:          new Set(), // 'secId|day|period'

  // ── Duty assignments (teacher responsibilities beyond class teaching) ──
  DUTY_ASSIGNMENTS:     [],   // [{ id, type, day, period, teacherId }]

  // ── Venue overrides for parallel-groups subjects (e.g. Games) ──
  venueFlips:           {},   // 'subject|day|period' → true (flipped from default)

  // ── UI state ──
  currentTab:           'class',
  modalState:           {},
  teacherModalState:    {},
  tmSubjects:           [],   // chip editor: subjects being edited
  tmClasses:            [],   // chip editor: classes being edited
};
