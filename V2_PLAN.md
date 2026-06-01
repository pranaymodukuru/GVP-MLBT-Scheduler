# v2 Plan — Calendar-first scheduler with an AI co-pilot

> **Single source of truth for v2.** Supersedes and replaces all earlier plan drafts.
>
> **Decisions locked in:**
> - Stay on the current **vanilla-JS + `server.py`** stack. No auth, no Postgres, no React *yet*.
> - Primary users are **1–2 admins on a shared machine.**
> - **All new work is additive** — the existing app must keep working at every step (see §2).
> - **Auto-scheduling is low priority** — the current generator stays as-is; we invest elsewhere.
> - **AI is the headline differentiator** — proactive conflict help + a conversational agent
>   that can *apply* changes from natural language (see §10).

---

## 1. Core architectural principle — Template vs. Instances

The current app models **one abstract recurring week**:

```
state.timetable[sectionId][day][period] = { subject, teacherId, locked? }
//                          ^^^ 'Mon' is a weekday, NOT a date
```

We keep that exactly as-is and call it the **weekly template**. Everything new is a
**dated layer** on top, in separate collections keyed by ISO date (`YYYY-MM-DD`):

```
HOLIDAYS         [{ date, name, type }]
EVENTS           [{ id, date, endDate?, title, type, scope, note }]
TEACHER_ABSENCES [{ id, teacherId, date, endDate?, kind, reason }]
OVERRIDES        overrides[date][sectionId][period] = { subject?, teacherId?,
                                                         substituteId?, cancelled?, note? }
```

**The one function everything depends on:**

```
effectiveDay(sectionId, isoDate):
    if isHoliday(isoDate): return HOLIDAY
    weekday = weekdayOf(isoDate)              // 'Mon'..'Sat'
    base    = template[sectionId][weekday]    // existing data, untouched
    return applyOverrides(base, overrides[isoDate]?.[sectionId])
```

Because the solver (`scheduler.js`) only ever touches the template, **it never changes.**
The calendar is a **read projection** + a thin **override writer**. Substitutions, absences,
and AI edits write to `OVERRIDES` (date-scoped) or, when intentional, the template — never
silently destroying the master schedule. This is what keeps the whole roadmap low-risk and
keeps every existing feature intact.

---

## 2. Non-regression contract — existing features that must keep working

Every phase below is additive. After each step, this checklist must still pass (manual
smoke test; promote to a scripted check when convenient). **No step is "done" until these
hold.**

**Views**
- [ ] Class view: grid renders per section, legend + per-subject counts, conflict/absent
      highlighting, right-click lock, click-to-edit cell modal.
- [ ] Teacher view: per-teacher grid, load stats, duty assignments.
- [ ] Subject view: coverage grid.
- [ ] Dashboard: workload, issues, coverage stats.
- [ ] Admin view: teacher CRUD, class config, section counts/teachers, subject add/remove,
      frequencies (freq / min / must-appear-daily), teacher day+period blocks, constraints,
      duty types.

**Scheduling**
- [ ] Generate, Regenerate (locks preserved), Fill Empty Slots all run.
- [ ] Conflict detection still flags teacher double-bookings.
- [ ] Combined sections, combinable groups, Games venue flips, Saturday half-day,
      no-P1-lock, no-Period-8, upper-class Work Review all behave as today.

**Persistence & export**
- [ ] localStorage autosave; Save (timestamped snapshot); Backup set/reset; Import
      (file + saved list); Reset to defaults; Save-config to `school-config.json`.
- [ ] PDF export (class/teacher, all/current).
- [ ] Dark mode toggle + persisted theme.

> **Guiding rule:** the existing weekly template + solver are frozen interfaces. New
> features read from them and write to *new* collections. If a change would require editing
> `scheduler.js`'s core passes, stop — it probably belongs in the override/AI layer instead.

---

## 3. Persistence: tiered storage (JSON for config, SQLite for operational data)

Storage is **tiered by access pattern**, not one-size-fits-all. The deciding factor is
volume × write-frequency: most collections are tiny and rarely written (JSON is ideal);
student attendance is high-volume append-heavy time-series (JSON breaks down).

| Tier | Data | Store | Why |
|---|---|---|---|
| **Config / documenty** | `school-config.json`, timetable template snapshot, calendar, events, students roster, constraints, duties | **JSON files** | Small, bounded, edited rarely; benefit from being human-readable + git-trackable |
| **Operational / time-series** | attendance, marks, absences-log, override history | **SQLite** (`saved_schedules/school.db`, stdlib `sqlite3`) | 100k+ rows, queryable, ACID, partial reads — JSON can't |

Rough sizing that drives the split (≈360 students, ~200 school days/yr): attendance is
**72k rows/yr daily, ~575k per-period** — loading that as one JSON array and rewriting it on
every roll-call is not sustainable. Everything else stays in the KB–low-thousands range.

### 3.1 JSON store (Phases 1–7) — `/data/<name>`
Add a generic JSON store to `server.py` (≈20 lines), mirroring the existing `/save`
fallback pattern. **Write atomically** (write to temp + `os.rename`) — the current
`open('w'); json.dump` truncates first, so a crash mid-write corrupts the whole file.

```
GET  /data/<name>   → returns saved_schedules/data/<name>.json  (or 204)
PUT  /data/<name>   → writes  saved_schedules/data/<name>.json   (temp + atomic rename)
```

Low-volume collections (`calendar`, `absences`, `events`, `overrides`, `students`) each
become one file under `saved_schedules/data/`. localStorage stays a fast cache; JSON files
are the source of truth. Falls back to localStorage-only when the server isn't running.

> **Done-when:** `PUT`/`GET /data/calendar` round-trips a file; an interrupted write never
> corrupts the existing file; the app boots unchanged; every box in §2 still passes.

### 3.2 SQLite system-of-record (introduce just before Phase 9.4)
When student attendance arrives, introduce SQLite via stdlib `sqlite3` in `server.py` —
**no daemon, no Docker, no new dependency**, fully within the current stack. **Only the
server's storage layer changes; the frontend keeps talking to REST endpoints** (`/data/*`
GET/PUT just read/write tables instead of files for the operational tiers).

- One file: `saved_schedules/school.db`. Tables: `attendance`, `marks`, `absences`,
  `override_log`, `students`, `exams` (see §4). High-volume reads become indexed `SELECT`s.
- This is the payoff for **Phase 12 analytics** (attendance↔performance correlation,
  coverage heatmap) — a few queries instead of shipping megabytes of JSON to the browser.
- It is a **clean stepping stone to Postgres** later: schema + queries port ≈1:1, so this
  de-risks the eventual rewrite rather than being throwaway work.
- `school-config.json` stays JSON (hand-editable, git-tracked); the timetable template
  stays a JSON snapshot (small; `applySnap()`/versioning already work on it).

> **Sequencing:** JSON (3.1) is fine through Phase 7. SQLite (3.2) lands as the step directly
> before **9.4 Student attendance** — the first collection that needs it. Nothing earlier is
> blocked on it.
>
> **Done-when:** attendance/marks read & write through SQLite; a 100k-row attendance query
> for one student returns instantly; a fresh DB auto-creates its schema on first run; §2
> still passes.

### 3.3 Backups & restore points  *(evolves with each storage tier)*

Same buttons (Save / Set Backup / Reset), same flat-file spirit — but what a backup
captures grows with the tiers. Two concepts stay deliberately separate:

| Concept | Captures | Restoring it… |
|---|---|---|
| **Schedule version** (8.2) | template + config only | reverts the recurring timetable **without** touching attendance/marks |
| **Full backup** | template + config **and** every operational tier (JSON `/data/*` **and** `school.db`) | is a complete disaster-recovery restore point |

Conflating them is a footgun — restoring an old *timetable* must never wipe *attendance/marks*.

**Phases 1–7 (JSON only):** keep the single-file model; nest the dated collections under a
`data` key so one file is one complete restore point:

```jsonc
{
  "schedule": { /* existing buildSnapshot() output — unchanged */ },
  "data": { "calendar": {…}, "events": […], "overrides": {…}, "absences": […],
            "students": […] }
}
```

**Phase 9.3+ (SQLite added):** the high-volume tier no longer lives in JSON, so a full
backup becomes a **timestamped set**, not one file:
- `backups/<ts>/school.db` — atomic copy via `VACUUM INTO` (or the online-backup API),
- `backups/<ts>/config-bundle.json` — the `schedule` + low-volume JSON `data` above,
- keep the last N sets; copying a `.db` file is *simpler* than serialising 575k JSON rows.
- An **on-demand JSON export** of the whole DB stays available for portability / human
  inspection / git — you keep readability *when you want it*, without paying its cost on
  every write.

- **Restore:** apply `schedule` via the existing `applySnap()`, `PUT` the JSON `data` back,
  and (9.3+) swap in the `.db` file. A legacy backup with no `data`/`.db` loads fine.
- **Done-when:** Set Backup → modify calendar/absences/marks → Reset to Backup restores
  *all* of it; restoring an old schedule **version** (8.2) leaves attendance/marks intact;
  every box in §2 still passes.

---

## 4. Data model for later phases (students / exams / marks)

Introduced only when their phase arrives. These land in **SQLite** (§3.2) — they are the
operational/time-series tier — and carry an `academic_year` column once Phase 14 lands.
Shown as logical schemas; the same shapes port ≈1:1 to Postgres later.

```sql
students   (id, name, roll, section_id, parent_contact, academic_year)
exams      (id, name, class_id, subject, exam_type, date, max_marks, academic_year)
marks      (id, student_id→students, exam_id→exams, marks_obtained, grade, remarks, recorded_by)
attendance (id, student_id→students, date, period, status)   -- present|absent|late
           -- index on (student_id, date) and (section_id, date) for the common queries
```

---

## 5. How the plan is ordered

Top = **highest value ÷ effort, do first.** Bottom = harder, lower priority, or dependent on
earlier data. Each step lists **Goal · Files · Done-when** so it's pickable and verifiable in
isolation.

| Phase | Theme | Effort | Priority |
|---|---|---|---|
| 6 | Calendar foundation + dated weekly view | S–M | **High** — the headline |
| 7 | Teacher absences + substitutions on dates | M | **High** — top operational value |
| 8 | Safety rails: undo/redo + version compare | S–M | **High** — prerequisite for safe AI writes |
| 9 | Attendance (teacher report → student roster → roll-call) | M–L | Medium |
| 10 | **AI co-pilot** (proactive + conversational, write-capable) | M–L | **High wow, after rails exist** |
| 11 | Academic records (exams, marks, report cards) | M | Medium |
| 12 | Analytics & cross-analysis | M | Medium |
| 13 | Duty roster | M | Low–Med |
| 14 | Multi-academic-year | S–M | Low (do at first rollover) |
| 15 | Auto-scheduling enhancements | M | **Low** (current generator is frozen) |

---

## 6. Phase — Calendar foundation + dated weekly view  *(headline)*

### 6.1 Calendar data layer · S
- **Goal:** introduce dates without touching the solver.
- **Files:** `config/school-config.json` (+ `academicYear`, `terms`, `holidays`), new
  `js/calendar.js` (date helpers + `effectiveDay()`), `state.js` (+ the four dated
  collections), `persistence.js` (load/save via `/data/*`).
- **Done-when:** `weekdayOf('2026-06-15')==='Mon'`; `effectiveDay()` returns the template on
  a normal day and `HOLIDAY` on a holiday. §2 still green. No UI yet.

### 6.2 Holiday & term management · S
- **Goal:** admin declares holidays + term boundaries.
- **Files:** `views/admin-view.js` (new "Calendar" panel), `index.html`.
- **Done-when:** adding a holiday persists to `data/calendar.json` and affects `isHoliday()`.

### 6.3 Dated weekly view for the class timetable · S–M  *(directly requested)*
- **Goal:** the existing class grid, for a *real week* with real dates.
- **Files:** `views/class-view.js` — add a week picker + "◀ this week ▶" nav; headers show
  `Mon 15 … Sat 20`; holiday columns greyed with the holiday name; cells render via
  `effectiveDay()` so overrides/subs show through later.
- **Done-when:** picking a week shows dated headers; a holiday blanks that day; with no
  overrides the grid is byte-identical to today's template view.

### 6.4 Calendar month view as the new main tab · M  *(directly requested)*
- **Goal:** the default landing view becomes a month calendar for *planning*.
- **Files:** new `js/views/calendar-view.js`, `index.html` (new first tab + container),
  `app.js` (`switchTab` wiring; default tab).
- **Render:** month grid; each day shows holiday name, event chips, absence-count badge
  (wired in Phase 7). Click a day → day-detail panel (stub now). Prev/next nav.
- **Done-when:** app opens on the month calendar; existing tabs all still work (§2).

---

## 7. Phase — Teacher absences + substitutions  *(top operational value)*

### 7.1 Teacher absence model · S
- **Goal:** mark a teacher absent on a date/range (full / half / late).
- **Files:** `calendar-view.js` day-detail action, `persistence.js` (`data/absences.json`).
  Keeps the existing weekly `TEACHER_AVAILABILITY` (solver constraint) untouched; absences
  are a separate *dated* concept.
- **Done-when:** an absence persists and shows as a badge on that day in month view.

### 7.2 Day-detail "coverage gaps" panel · M
- **Goal:** clicking a day shows who's absent and which section/period slots lose their
  teacher that day.
- **Files:** `calendar-view.js`. For each absent teacher, scan the template for that weekday
  → list `{section, period, subject}` now uncovered.
- **Done-when:** the panel lists every uncovered slot for the selected date.

### 7.3 One-click substitution · M
- **Goal:** for each uncovered slot, suggest substitutes and apply with one click.
- **Files:** `calendar-view.js`, reusing the candidate logic already in
  `app.js:fillEmptySlots()` (teaches the subject, free that weekday/period, available).
  Rank by subject match → lowest weekly load → fewest disruptions. Apply writes
  `OVERRIDES[date][section][period] = { substituteId }` — **date-scoped; template untouched.**
- **Done-when:** the sub shows in the dated weekly view (6.3) for that date only; the
  template week is unchanged; the action is undoable (Phase 8).

### 7.4 Events · S
- **Goal:** school/class/section events (exam, sports day, assembly, PTM).
- **Files:** `calendar-view.js`, `data/events.json`.
- **Done-when:** events render as chips in month view and a banner row in the weekly view.

---

## 8. Phase — Safety rails  *(prerequisite for safe AI writes)*

### 8.1 Undo / redo · M
- **Goal:** `{ past[], present, future[] }` stack around all timetable/override mutations.
- **Files:** new `js/history.js`; wrap mutating entry points (cell save/clear, lock,
  regenerate, fill, substitution, and — later — AI edits). Cap 50; persist to
  `sessionStorage`; toolbar buttons.
- **Done-when:** edit → Undo restores → Redo re-applies; survives refresh; every mutation
  path (including substitutions) is reversible.

### 8.2 Schedule versioning + compare · S–M
- **Goal:** turn existing `saved_schedules/*.json` into a first-class version list.
- **Files:** extend the import modal in `app.js` into a "Versions" panel: rename, delete,
  restore, "Compare two versions" (cell-level diff highlight). Auto-save a version on every
  full Regenerate.
- **Done-when:** two versions diff with changed cells highlighted; restore works.

---

## 9. Phase — Attendance

### 9.1 Teacher attendance report · S  *(free — derived from 7.1)*
- **Goal:** monthly per-teacher calendar (present by default; absences from 7.1) + CSV.
- **Done-when:** monthly grid colour-codes each teacher's days; CSV downloads.

### 9.2 Student roster · M  *(new data — gate for 9.4 & 11)*
- **Goal:** student lists per section.
- **Files:** `data/students.json` initially; admin import (paste/CSV) + edit UI in
  `admin-view.js`. (Migrates into SQLite in 9.3 alongside attendance.)
- **Done-when:** each section has an editable, persisted student list.

### 9.3 Introduce SQLite (§3.2) · M  *(storage upgrade — gate for high-volume data)*
- **Goal:** stand up `school.db` as the system of record for operational/time-series data
  **before** attendance writes its first row, so high-volume data never touches JSON.
- **Files:** `server.py` (stdlib `sqlite3`: connection, schema auto-create on first run,
  `/data/*` GET/PUT routed to tables for the operational tiers); migrate `students` (9.2)
  and any `absences`/`override` history into tables; backups switch to the §3.3 db-set form.
- **Scope guard:** frontend REST calls are unchanged; config + template stay JSON (§3.2).
- **Done-when:** a fresh DB self-creates its schema; students read/write via SQLite; a
  100k-row test query returns instantly; a `VACUUM INTO` backup + restore round-trips; §2
  still passes.

### 9.4 Student attendance · M
- **Goal:** daily (optionally per-period) roll-call → `attendance` table (SQLite, 9.3).
- **Files:** new roll-call modal; "all present" default + toggles; low-attendance flag
  (configurable threshold, default 75%); `GET /attendance?student_id=&date_from=&date_to=`.
- **Done-when:** marking a class persists; a student's term % computes from an indexed
  query; sub-threshold students are flagged.

---

## 10. Phase — AI co-pilot  *(headline differentiator)*

The AI is not a side panel of read-only Q&A — it is a **co-pilot that watches the schedule
and can act on it**. Two pillars: **(A) proactive assistance** that surfaces itself when
something is wrong, and **(B) a conversational agent** that understands natural language and
**applies** the requested changes.

Because the browser can't safely hold an API key, add a thin proxy to `server.py`:
`POST /ai/<action>` forwards to the Claude API with the server-held key. Everything else
stays client-side.

> **Every AI write goes through the same path as a human edit:** it produces a **preview
> diff**, the admin confirms with one click, then it commits via the normal mutation
> functions — so it lands in the **undo stack (8.1)** and writes to **`OVERRIDES`/template**
> like any other change. The AI never mutates silently and nothing it does is irreversible.

### 10.1 AI infrastructure · M
- **Goal:** the plumbing both pillars share.
- **Files:** `server.py` (`/ai/*` proxy + key in `.env`), new `js/ai/agent.js`.
- **Build:**
  - A **tool registry** — a small set of typed functions the model may call, split into
    **read tools** (get schedule, teacher load, conflicts, coverage gaps, attendance) and
    **write tools** (`moveCell`, `assignSubstitute`, `markAbsent`, `setSubjectFreq`,
    `addConstraint`, `regenerate`, …). Each write tool returns a **dry-run diff** instead of
    committing, so the UI can preview before the user confirms.
  - A short tool-use loop (question → tool calls → answer/preview), context = current state
    JSON + the registry schema.
- **Done-when:** a hard-coded "move 10-A Maths Mon P3 → Wed P4" round-trips: model picks the
  tool, returns a diff, UI previews it, confirm commits + lands in undo.

### 10.2 Proactive conflict & coverage assistant · M  *(pop-up recommendations)*
- **Goal:** when `checkConflicts()` finds double-bookings, **or** Phase 7 finds uncovered
  periods, an AI panel **auto-surfaces** with a plain-English cause and ranked, one-click
  fixes — no need for the admin to ask.
- **Behaviour:**
  - *Conflict example:* "Mr. Singh is double-booked Mon P3 (9-B and 10-A both need Maths,
    he's the only Maths teacher free). **Fix 1:** swap 10-A Maths to Wed P4 (no new
    conflicts). **Fix 2:** move 9-B Maths to Tue P2. **Fix 3:** assign a substitute."
  - *Coverage example (from 7.x):* "Mrs. Mehta absent Tue — 8-C Science P2 & P4 uncovered.
    Suggested sub: Mrs. Patel (same subject, free, lowest load)."
  - Each fix is a confirm-to-apply diff (per 10.1). Applying re-runs `checkConflicts()` and
    refreshes the panel.
- **Files:** hook into the existing conflict panel + the 7.2 day-detail panel; `agent.js`.
- **Done-when:** introducing a conflict makes the assistant appear unprompted with ≥1
  applicable fix; applying it clears the conflict and is undoable.

### 10.3 Conversational agent — understands & applies NL changes · M
- **Goal:** a chat panel where the admin types intent and the agent **does it** (not just
  describes it), spanning reads and writes.
- **Examples it must handle:**
  - "Mark Mr. Rao absent next Monday and find substitutes for all his periods."
  - "Move 10-A's Maths from Monday P3 to Wednesday P4."
  - "Computer Lab for 10-A only on Tue/Thu, never P1." → adds a constraint (10.4).
  - "Which teacher has the heaviest load this week?" (read-only answer.)
- **Flow:** NL → tool calls → if any write tool fires, show a **preview diff + Confirm /
  Cancel**; on confirm, commit through normal mutators (undoable). Multi-step intents
  ("absent + find subs") chain several tool calls into one preview.
- **Files:** `js/ai/chat.js` (floating panel), `agent.js`.
- **Done-when:** each example above produces the correct preview and, on confirm, the
  correct persisted change; reads answer without a diff; everything writes through undo.

### 10.4 Natural-language constraint input · M
- **Goal:** freetext scheduling rule → structured constraint JSON → confirm → apply.
- **Note:** implemented as a write tool of the agent (10.1), also exposed as a dedicated
  Admin textarea for discoverability.
- **Done-when:** a plain-English rule validates against the config schema, previews as a
  human-readable summary, and persists on confirm.

### 10.5 Schedule-health digest · S  *(after Phase 12 analytics exist)*
- **Goal:** on-demand/daily plain-English summary — uncovered periods, workload outliers,
  upcoming pressure points — with one-click action items. Cached per day.
- **Done-when:** the digest card renders real numbers and its action items route into 10.2's
  apply flow.

**Guardrails (kept, with write capability added):**
- The agent **can apply changes**, but **only via preview-and-confirm** — never silently.
- Every AI write goes through the standard mutators → lands in **undo/redo (8.1)**.
- Writes target `OVERRIDES` (dated) or the template explicitly; the solver's core passes are
  never edited by AI.
- Stateless per request; hosted LLM API only (no fine-tuning); no student-facing AI in v2.

---

## 11. Phase — Academic records

### 11.1 Exams + marks entry · M
- **Goal:** admin creates exams; teacher enters marks spreadsheet-style.
- **Files:** `exams` + `marks` tables (SQLite, §3.2); marks-entry view (students × marks
  grid); validation (`marks ≤ max`); grade auto-compute from configurable boundaries.
- **Done-when:** a full class's marks save in one transaction.

### 11.2 Report cards · M
- **Goal:** per-student PDF (marks + attendance % + grade + remarks). Extend `pdf-export.js`.
- **Done-when:** a report-card PDF generates for any student.

---

## 12. Phase — Analytics & cross-analysis

- **12.1 Coverage heatmap** — teacher × subject % covered vs scheduled; "at-risk subjects"
  where the primary teacher missed > N% (data from `absences` + `overrides`). M.
- **12.2 Attendance ↔ performance** — scatter (attendance % vs marks %), correlation,
  "needs intervention" list (<75% attendance AND <40% marks). M. Needs 9.4 + 11.1.
- **12.3 Section comparison** — avg marks per subject across sections. S.
- **12.4 Dashboard rollup** — today's absent teachers, uncovered periods, low-attendance
  count on the main dashboard. S.
- Charts: add Chart.js via CDN (still no bundler).
- **Storage payoff:** all four are SQL aggregate queries over the SQLite tables (§3.2) — the
  server returns small pre-computed result sets, not raw rows, so the browser never loads
  the full attendance/marks history.

---

## 13. Phase — Duty roster · M  *(low–medium)*
- **Goal:** formalise existing `DUTY_ASSIGNMENTS` into a weekly roster + fair auto-rotation
  + PDF export. Files: `views/teacher-view.js`, new `js/duty-roster.js`, `pdf-export.js`.
- **Done-when:** "Generate roster" distributes duties evenly; export produces a PDF.

---

## 14. Phase — Multi-academic-year · S–M  *(low; do at first rollover)*
- Tag dated collections with `academicYear`; rollover action carries teachers + class config
  forward and resets timetable/attendance/marks; historical years stay queryable.

---

## 15. Phase — Auto-scheduling enhancements · M  *(LOW priority)*
- The current generator is **frozen and must keep working** (§2). Only when everything above
  ships, consider: smarter conflict avoidance, soft-constraint weighting, or AI-driven
  regeneration ("regenerate honouring all NL constraints"). Not before.

---

## 16. Suggested first sprint (1–2 days each, all testable, §2 green throughout)

1. **§3.1** — `/data/*` store in `server.py` + the four empty collections in state.
2. **6.1 + 6.2** — calendar data layer + holiday/term admin panel.
3. **6.3** — dated weekly class view (smallest, most-requested visible win).
4. **6.4** — month calendar as the main tab.
5. **7.1 + 7.2** — mark teacher absent + coverage-gap day panel.
6. **7.3** — one-click substitution.

Then **8.1 (undo)** before starting Phase 10, so every AI write is reversible from day one.

---

## 17. Migration trigger (when to revisit a backend rewrite)

Stay on this stack (JSON + SQLite via `server.py`) until **one** of these becomes a real,
present need — then migrate the backend to FastAPI + Postgres (frontend last):

1. Teachers/parents must **log in from their own devices** (→ auth + shared networked DB).
2. Multiple people must **edit concurrently** from different machines (SQLite is single-writer;
   fine for 1–2 admins sharing one machine, not for many networked writers).
3. The app must be **hosted/accessed remotely** rather than run on one local machine.

Note the deliberate stepping stone: SQLite (§3.2) is **not** throwaway — its schema and queries
port ≈1:1 to Postgres, so adopting it now both solves today's volume/query needs *and*
de-risks the eventual rewrite. Combined with the template-vs-instance split, the port becomes
a mechanical lift, not a redesign — `scheduler.js` and the data shapes move across unchanged.
