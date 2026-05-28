# MLBT School Timetable Scheduler

A browser-based auto-scheduler for school timetables — no backend, no build step.

---

## Running the app

ES6 modules require an HTTP server (browsers block `import` on `file://`).

```bash
cd mlbt-scheduler
python3 -m http.server 8080
# then open http://localhost:8080
```

---

## File structure

```
mlbt-scheduler/
├── index.html                  ← Shell HTML (one <script type="module">)
├── styles/
│   └── main.css                ← All CSS
├── config/
│   ├── school-config.json      ← ✏️  Edit this to change school data
│   └── school-config.js        ← Config loader (re-exports JSON as named constants)
└── js/
    ├── app.js                  ← Entry point, wires everything together
    ├── state.js                ← Shared mutable runtime state
    ├── helpers.js              ← Pure utility functions
    ├── selects.js              ← Dropdown population
    ├── persistence.js          ← localStorage + JSON export/import
    ├── scheduler.js            ← Core scheduling algorithm
    ├── toast.js                ← Notification helper
    ├── views/
    │   ├── class-view.js       ← Class timetable grid
    │   ├── teacher-view.js     ← Teacher timetable grid
    │   ├── subject-view.js     ← Subject timetable grid
    │   ├── dashboard.js        ← Workload / issues / coverage
    │   └── admin-view.js       ← Admin panels + mutations
    └── modals/
        ├── cell-modal.js       ← Cell edit dialog
        └── teacher-modal.js    ← Teacher add/edit dialog
```

---

## Editing school data

Open **`config/school-config.json`** — it is the single source of truth for defaults. (`config/school-config.js` is just a loader that re-exports the JSON as named constants; it rarely needs editing.)

| JSON key | What to edit |
|---|---|
| `teachers` | Add / remove teachers, their subjects and classes |
| `classConfig` | Add / remove classes, sections, subjects, class teachers |
| `subjects` | Colour, text colour, `periodsPerWeek`, `minPeriodsPerWeek`, and `mustAppearDaily` per subject |
| `periods` | Period IDs, timings, and break flags |
| `satHalfDayClasses` | Classes with a Saturday half-day |
| `upperClasses` | Classes that get a Work Review slot |
| `noP1LockClasses` | Classes where Period 1 is not pinned to the class teacher |
| `combinedSections` | Section pairs that share a teacher for Period 1 |

Changes take effect on a **fresh start** (no localStorage snapshot). To apply them when a saved state exists, click **Reset to Defaults** in the Admin → Scheduler Settings panel.

---

## How config changes are saved

| Event | What happens |
|---|---|
| First load | Defaults from `config/school-config.js` |
| Any admin change (teacher, class, frequency) | Saved to **localStorage** immediately |
| Page reload | "Load Saved" banner appears — click to restore |
| Export JSON | Downloads the full current state |
| Import JSON | Restores that state and saves to localStorage |
| Reset to Defaults | Clears localStorage and reloads — reverts to `config/school-config.js` |

---

## Making changes

- **Add a teacher**: append to `teachers` in `config/school-config.json`, add their ID to `sectionTeachers` in the relevant class in `classConfig`.
- **Add a subject**: add an entry under `subjects` (with `color`, `textColor`, `periodsPerWeek`, and optionally `minPeriodsPerWeek` and `mustAppearDaily`), then add it to the relevant class's `subjects[]` in `classConfig`.
- **Add a class**: add a new key to `classConfig` with `sections`, `subjects`, and `sectionTeachers`.
- **Change period timings**: edit the `periods` array and update `satHalfDayClasses` / `upperClasses` if needed.
