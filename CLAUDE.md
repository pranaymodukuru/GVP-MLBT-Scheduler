# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser-based school timetable auto-scheduler. ES6 modules — no framework, no bundler, no backend. Requires an HTTP server because browsers block `import` on `file://`.

## Running the App

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

No build, lint, or test commands exist.

## Architecture

```
mlbt-scheduler/
├── index.html                  ← Shell HTML (single <script type="module">)
├── styles/
│   └── main.css                ← All CSS
├── config/
│   ├── school-config.json      ← ✏️  Edit this to change school data
│   └── school-config.js        ← Config loader (re-exports JSON as named constants)
└── js/
    ├── app.js                  ← Entry point — wires modules, exposes window.* for onclick=
    ├── state.js                ← Shared mutable runtime state (one singleton object)
    ├── helpers.js              ← Pure utility functions
    ├── selects.js              ← Dropdown population
    ├── persistence.js          ← localStorage + JSON export/import
    ├── scheduler.js            ← Core scheduling algorithm + conflict detection
    ├── toast.js                ← Notification helper
    ├── views/
    │   ├── class-view.js       ← Class timetable grid
    │   ├── teacher-view.js     ← Teacher timetable grid
    │   ├── dashboard.js        ← Workload / issues / coverage stats
    │   └── admin-view.js       ← Admin panels + mutations
    └── modals/
        ├── cell-modal.js       ← Cell edit dialog
        └── teacher-modal.js    ← Teacher add/edit dialog
```

**Three views:**
- **Class View** — full timetable grid per class/section
- **Teacher View** — personalized timetable per teacher with load statistics
- **Admin View** — manage teachers, classes, subjects, frequencies, and attendance

**Data flow:**
```
config/school-config.json (defaults)
  → state.js (runtime state)
  → generateTimetable()     ← core scheduling algorithm
  → checkConflicts()        ← validates teacher double-bookings
  → renderClassView() / renderTeacherView() / renderDashboard()
```

All mutable state lives in the single `state` object exported from `state.js`. Persistence is via localStorage; changes are auto-saved on every admin edit.

## Key Data Structures

| Property | Type | Purpose |
|---|---|---|
| `state.TEACHERS` | Array | `{id, name, subjects[], classes[], classSubjects?, availablePeriods?}` |
| `state.CLASS_CONFIG` | Object | Maps class names → `{sections, subjects[], sectionTeachers}` |
| `state.SUBJECT_FREQ` | Object | Subject → periods-per-week target |
| `state.TEACHER_AVAILABILITY` | Object | `{tid: {blockedDays: ['Mon', ...]}}` |
| `state.timetable` | 3D Object | `timetable[sectionId][day][period] = {subject, teacherId, locked?}` |
| `state.conflictRecords` | Array | `[{teacherName, teacherId, day, period, sec1, sec2}]` |
| `DAYS` | Array | `['Mon','Tue','Wed','Thu','Fri','Sat']` (from config) |
| `WORK_PERIODS` | Array | Non-break period IDs (e.g. `['P1','P2',…]`) derived from config |

## Scheduling Algorithm (`generateTimetable`)

1. **Seed locked cells** from the existing timetable when `preserveLocked=true`.
2. **Pin Period 1** every day to the class teacher's subject (except `NO_P1_LOCK_CLASSES`; combined sections like 10-A/10-B share a single teacher for P1).
3. Build a **subject queue** from `SUBJECT_FREQ`, shuffle for randomness, pad to cover all slots.
4. **Greedy 1st pass** — assign teachers respecting the `MAX_PD` soft daily cap and teacher absence/availability.
5. **Relaxed 2nd pass** — fill remaining empty cells ignoring the daily cap.
6. **Minimum enforcement pass** — for each section, swap excess cells to fix subjects below `SUBJECT_MIN_FREQ`.
7. **Daily appearance pass** — for subjects with `mustAppearDaily`, swap to ensure at least one period per day.
8. Run `checkConflicts()` to surface unresolved double-bookings.

## Config — `config/school-config.json`

This JSON file is the single source of truth. `config/school-config.js` only loads it and re-exports named constants — it rarely needs editing.

Top-level keys:

| Key | Purpose |
|---|---|
| `teachers` → `DEFAULT_TEACHERS` | Teacher roster with subjects, classes, and optional restrictions |
| `classConfig` → `DEFAULT_CLASS_CONFIG` | Classes, sections, subjects, and class teacher assignments |
| `subjects` | Per-subject: `color`, `textColor`, `periodsPerWeek`, `minPeriodsPerWeek`, `mustAppearDaily`, scheduling flags |
| `periods` | Period IDs, times, and `isBreak` flags |
| `satHalfDayClasses` | Classes with half-day Saturdays (skip last two periods) |
| `upperClasses` | Classes that get a Work Review period appended |
| `noP1LockClasses` | Classes where Period 1 is NOT pinned to the class teacher |
| `combinedSections` | Section pairs that share a teacher for Period 1 |
| `maxPeriodsPerDay` | Soft cap on teacher load per day |

## Hardcoded School Rules (see also `SCHEDULING_CONSTRAINTS.md`)

- **Saturday half-day**: `satHalfDayClasses` skip the last two work periods on Saturdays.
- **Pre-primary** (PP1, PP2): No Period 8.
- **Upper classes**: "Work Review" (WRK) slot appended at end of day.
- **Period 1 lock**: Pinned to the class teacher's subject; combined sections share a teacher.
- **Subject colors**: Defined in `config/school-config.json` under `subjects[name].color` and `subjects[name].textColor`.

## Making Changes

- **Add a teacher**: Add an entry to `teachers` in `school-config.json`; add the teacher's ID to `sectionTeachers` in the relevant class in `classConfig`.
- **Add a subject**: Add an entry under `subjects` (with `color`, `textColor`, `periodsPerWeek`), then add it to the relevant class's `subjects[]` list in `classConfig`.
- **Add a class/section**: Add a key to `classConfig` with `sections`, `subjects`, and `sectionTeachers`.
- **Change period timings**: Edit the `periods` array; update `satHalfDayClasses` / `upperClasses` if period indices shift.
- **Apply config changes**: After editing the JSON, click **Reset to Defaults** in Admin → Scheduler Settings to clear localStorage and reload with fresh defaults.
