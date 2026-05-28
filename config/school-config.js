// ─────────────────────────────────────────────────────────────────────────────
// Config loader — reads school-config.json and re-exports named constants.
//
// To edit school data, open school-config.json (same folder).
// This file only needs to change if you rename or add a top-level JSON key.
// ─────────────────────────────────────────────────────────────────────────────

const cfg = await fetch(new URL('school-config.json', import.meta.url))
  .then(r => r.json());

// ─── Simple re-exports ────────────────────────────────────────────────────────
export const STORAGE_KEY       = cfg.storageKey;
export const DAYS              = cfg.days;
export const PERIODS           = cfg.periods;
export const SAT_HALF_BASES    = cfg.satHalfDayClasses;
export const UPPER_BASES       = cfg.upperClasses;
export const SECTION_LABELS    = cfg.sectionLabels;
export const MAX_PD            = cfg.maxPeriodsPerDay;
export const NO_P1_LOCK_CLASSES          = cfg.noP1LockClasses          || [];
export const COMBINED_SECTIONS          = cfg.combinedSections          || [];
export const COMBINED_AFTER_LUNCH_GROUPS = cfg.combinedAfterLunchGroups || [];
export const NO_P8_CLASSES              = cfg.noPeriod8Classes          || [];

// Work periods that fall after the lunch break
const lchIdx = PERIODS.findIndex(p => p.id === 'LCH');
export const AFTER_LUNCH_PERIODS = lchIdx >= 0
  ? PERIODS.slice(lchIdx + 1).filter(p => !p.isBreak).map(p => p.id)
  : [];

// Derived: only the non-break period IDs (e.g. P1, P2, P3 …)
export const WORK_PERIODS = PERIODS.filter(p => !p.isBreak).map(p => p.id);

// ─── Expand the combined subjects map into three separate lookups ─────────────
// The JSON stores colour + text-colour + frequency together per subject.
// The views still consume them as three distinct objects, so we split them here.
export const SUBJECT_COLORS = Object.fromEntries(
  Object.entries(cfg.subjects).map(([name, s]) => [name, s.color])
);
export const SUBJECT_TEXT = Object.fromEntries(
  Object.entries(cfg.subjects).map(([name, s]) => [name, s.textColor])
);
export const DEFAULT_SUBJECT_FREQ = Object.fromEntries(
  Object.entries(cfg.subjects).map(([name, s]) => [name, s.periodsPerWeek])
);
export const DEFAULT_SUBJECT_MIN_FREQ = Object.fromEntries(
  Object.entries(cfg.subjects).map(([name, s]) => [name, s.minPeriodsPerWeek ?? s.periodsPerWeek])
);
export const DEFAULT_SUBJECT_MUST_APPEAR_DAILY = Object.fromEntries(
  Object.entries(cfg.subjects).map(([name, s]) => [name, s.mustAppearDaily ?? false])
);

// Full subjects map (includes scheduling flags like anyClassTeacher / anyFreeTeacher)
export const SUBJECTS_CONFIG = cfg.subjects;

// ─── Teachers & class config ──────────────────────────────────────────────────
export const DEFAULT_TEACHERS     = cfg.teachers;
export const DEFAULT_CLASS_CONFIG = cfg.classes;

export const DEFAULT_CONSTRAINTS = cfg.constraints || {
  maxSubjectPeriodsPerDay: 2,
  maxTeacherPeriodsPerDay: 6,
  peOncePerDay: true,
};
