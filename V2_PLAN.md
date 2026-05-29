# v2 Upgrade Plan

## 1. Current Architecture Assessment

### What's working well (keep in v2)
- **Scheduling algorithm** (`scheduler.js`) — the multi-pass greedy logic with lock/min-freq enforcement is solid. Worth preserving as-is, just move it server-side.
- **Config-driven design** — `school-config.json` as the single source of truth is a good pattern; v2 should promote this to a database-editable config.
- **Tab-based layout** — the Class / Teacher / Dashboard / Admin mental model maps well to what v2 needs.
- **Conflict detection** — `checkConflicts()` produces structured records; easy to extend into a proper issues API.

### Hard limits of the current stack

| Limitation | Impact |
|---|---|
| No auth layer | Anyone with the URL is an admin; can't have teacher/student/parent logins |
| `localStorage` singleton | Data is per-browser, per-device; no multi-user, no shared state |
| Flat JSON files (`saved_schedules/`) | No queryable history, no per-user access control, grows unbounded |
| Python `http.server` | Not production-ready; no auth middleware, no connection pooling |
| No student data model | Marks, attendance, performance can't be built on this foundation |
| No undo/redo | State is mutated in-place; no history stack |
| Vanilla JS + imperative DOM | Manageable now but will break down as the UI grows into 10+ views |

---

## 2. Proposed v2 Tech Stack

### Backend — FastAPI + PostgreSQL
Python is already in use, so FastAPI is the natural upgrade path. It gives a proper REST API, JWT auth middleware, async handlers, and auto-generated OpenAPI docs with zero friction.

| Component | Choice | Reason |
|---|---|---|
| API framework | **FastAPI** | Native Python, async, auto-docs, great DX |
| Database | **PostgreSQL** | Relational queries needed for attendance/marks analytics |
| ORM | **SQLAlchemy 2.x** | First-class async support, integrates with FastAPI |
| Migrations | **Alembic** | Schema versioning alongside code versioning |
| Auth | **JWT (python-jose)** + bcrypt | Stateless, works well with SPA frontend |
| Server | **Uvicorn + Gunicorn** | Production-grade ASGI server |

### Frontend — React + Vite
The v2 feature set (auth flows, dashboards, drill-downs, modals, role-specific views) makes a component model essential. Vanilla JS + `innerHTML` will not scale to 15+ views.

| Component | Choice | Reason |
|---|---|---|
| UI framework | **React 18** | Widely known, rich ecosystem, easy to hire for |
| Bundler | **Vite** | Fast HMR, zero-config, native ESM |
| Styling | **CSS custom properties** (keep current approach) + Tailwind utility classes | Preserves the existing theme system |
| Charts | **Recharts** or **Chart.js** | Attendance / performance analytics |
| State | **React Context + useReducer** | Simple enough; no need for Redux |
| HTTP client | **fetch API** (or Axios) | No extra weight needed |

### Infrastructure
```
docker-compose.yml
  ├── nginx          — reverse proxy, serves built React SPA
  ├── api            — FastAPI (uvicorn)
  └── db             — PostgreSQL
```

---

## 3. Data Model

```
┌─────────────────────────────────────────────────────────────┐
│ users                                                        │
│   id, email, password_hash, name, role, is_active           │
│   role: admin | teacher | student | parent                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼──────────────────┐
          ▼            ▼                  ▼
   teachers         students           parents
   user_id (1:1)    user_id (1:1)      user_id (1:1)
   teacher_code     roll_number        children → students[]
   subjects[]       class_id
   classes[]        section
                    parent_id → parents

┌─────────────────────────────────────────────────────────────┐
│ classes                                                      │
│   id, name, section, academic_year                          │
│   class_teacher_id → teachers                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ schedule_versions                                            │
│   id, label, created_at, created_by → users                 │
│   snapshot (JSONB), is_active, academic_year                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ teacher_attendance                                           │
│   id, teacher_id → teachers, date                           │
│   status: present | absent | late | half_day                │
│   reason, recorded_by → users                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ student_attendance                                           │
│   id, student_id → students, date, period, subject          │
│   status: present | absent | late                           │
│   marked_by → teachers                                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ exams                                                        │
│   id, name, class_id, subject                               │
│   exam_type: unit_test | midterm | final | assignment        │
│   date, max_marks, academic_year                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ marks                                                        │
│   id, student_id → students, exam_id → exams                │
│   marks_obtained, remarks, recorded_by → teachers           │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Feature Roadmap

### Phase 0 — Foundation *(prerequisite for everything)*

**Backend setup**
- [ ] Scaffold FastAPI project with folder structure (`api/`, `models/`, `routers/`, `schemas/`, `db/`)
- [ ] Set up PostgreSQL connection via SQLAlchemy async engine
- [ ] Set up Alembic for schema migrations
- [ ] Port `server.py` REST endpoints (`/save`, `/backup`, `/saved-schedules`) to FastAPI routers
- [ ] Implement JWT auth (`/auth/login`, `/auth/refresh`, `/auth/logout`)
- [ ] Implement RBAC middleware (Admin / Teacher / Student / Parent role guards)
- [ ] User management endpoints (create, list, update, deactivate)
- [ ] Seed script: import existing `school-config.json` into the DB

**Frontend setup**
- [ ] Scaffold React + Vite project
- [ ] Port current CSS (`main.css`) and theme system to the new project
- [ ] Port Tabler Icons integration
- [ ] Implement auth context (login page, token storage, route guards)
- [ ] Recreate tab navigation as React components
- [ ] Role-aware navigation (teachers see different tabs than admins)

**Docker**
- [ ] Write `docker-compose.yml` with nginx + api + db services
- [ ] Write `Dockerfile` for the FastAPI service
- [ ] Set up `.env` for secrets (DB URL, JWT secret, etc.)

---

### Phase 1 — Scheduling (existing features, enhanced)

**Undo / Redo**
- [ ] Implement a client-side command stack in React state: `{ past: [], present, future: [] }`
- [ ] Every schedule mutation (cell edit, lock, clear) pushes the previous state to `past[]`
- [ ] Undo pops from `past[]`, Redo pops from `future[]`
- [ ] Cap stack depth at 50 operations; render Undo/Redo buttons disabled when stack is empty
- [ ] Persist undo stack to `sessionStorage` so browser refresh does not lose it

**Schedule versioning / history**
- [ ] Store each generated/imported schedule as a `schedule_versions` row (JSONB snapshot)
- [ ] Version list UI: show label, date, who created it; allow rename, delete, restore
- [ ] "Compare schedules" view: diff two versions side-by-side, highlight changed cells
- [ ] Active version flag: the version in use is marked `is_active = true`
- [ ] Auto-save a version on every full Regenerate (labelled by timestamp + user)

**Scheduling algorithm migration**
- [ ] Port `scheduler.js` → `api/scheduler.py` as a pure function
- [ ] Expose `POST /schedules/generate` and `POST /schedules/regenerate` endpoints
- [ ] Keep the JS version as a client-side fallback for offline use

---

### Phase 2 — Attendance

**Teacher Attendance**
- [ ] Daily attendance marking UI (admin marks each teacher: present / absent / half-day / late + optional reason)
- [ ] `GET /attendance/teachers?date=&month=` endpoint with date-range support
- [ ] `POST /attendance/teachers` — bulk mark endpoint (entire day at once)
- [ ] Monthly calendar view per teacher (colour-coded cells)
- [ ] When a teacher is marked absent for a day → surface a **substitution prompt** (see Additional Ideas)
- [ ] Export teacher attendance report as CSV / PDF

**Student Attendance**
- [ ] Per-period attendance marking by the assigned teacher (opens a class roll-call UI)
- [ ] `POST /attendance/students` — mark attendance for a period (class + day + period → list of statuses)
- [ ] Bulk "all present" default with individual overrides
- [ ] `GET /attendance/students?student_id=&date_from=&date_to=` for reports
- [ ] Low-attendance alert: flag any student below configurable threshold (default 75%)
- [ ] Monthly attendance summary per student (calendar + percentage)
- [ ] Parent view: parents can see their child's attendance

**Holiday Calendar**
- [ ] Admin-managed holiday list (national + school-specific)
- [ ] Scheduler and attendance modules respect holidays (no attendance marking on holidays)
- [ ] Holiday dates shown in all calendar views

---

### Phase 3 — Academic Records

**Marks Entry**
- [ ] Admin creates exams: name, class, subject, type, date, max marks
- [ ] Teacher marks-entry UI: spreadsheet-style table (students as rows, marks as cells)
- [ ] `POST /marks/bulk` — submit entire class's marks in one request
- [ ] Validation: marks ≤ max_marks, required fields present
- [ ] Marks edit history (who changed what, when)
- [ ] Grade auto-computation based on configurable grade boundaries (A+/A/B… or percentage)

**Student Performance**
- [ ] Per-student report: all exams, marks, percentage, grade, trend line
- [ ] Per-class subject performance: class average per exam, best/lowest scorer
- [ ] Per-subject performance across classes: compare average marks across sections
- [ ] Term-wise performance: aggregate unit tests + midterm + final into a term score
- [ ] Report card generation: PDF with all marks, attendance %, grade, remarks

---

### Phase 4 — Analytics & Cross-Analysis

This phase delivers the "v2 intelligence" — connecting the three data streams.

**Teacher Attendance ↔ Subject Coverage**
- [ ] For each teacher absence, identify which periods/subjects had no substitute → show uncovered subjects
- [ ] Heatmap: teacher × subject → % of periods covered vs total scheduled
- [ ] "At-risk subjects" alert: subjects where the primary teacher has missed >N% of periods

**Student Attendance ↔ Performance**
- [ ] Scatter chart: student attendance % vs marks % (per subject and overall)
- [ ] Correlation coefficient displayed on chart
- [ ] Cluster: students with <75% attendance AND <40% marks → "needs intervention" list
- [ ] Subject-level drill-down: which specific periods/subjects a low-performer misses most

**Subject Performance Across Sections**
- [ ] Bar chart: section A vs B vs C average marks per subject
- [ ] Identify outlier sections for a subject (investigate teacher or coverage issues)

**Configurable thresholds and alerts**
- [ ] Admin sets: min attendance %, pass marks %, intervention threshold
- [ ] Daily digest email (optional): absent teachers, low-attendance students

---

## 5. Additional Features to Propose

### Substitution Management
When a teacher is marked absent, the system automatically:
1. Identifies which periods in that day have no coverage
2. Finds available teachers (not already scheduled in that slot) who teach the same subject
3. Presents a ranked substitute list → admin confirms with one click
4. Updates the timetable for that day only (temporary override, not a permanent change)

### Parent Portal
- Read-only login for parents
- Child's timetable, today's attendance, marks per exam, low-attendance alerts
- No edit access; separate from the admin/teacher flows

### Exam Scheduling Module
- Separate timetable generator for exam periods (different rules: no teacher double-booking, room assignments)
- Seat plan generation from student lists
- Invigilator assignment (draw from teacher availability for that day)

### Communication Module (lightweight)
- Teacher posts a "Notice" to a class (text + optional attachment)
- Students/parents see it on their dashboard
- No email required — in-app notification centre

### Duty Roster (extends existing duty types)
- Formalise the existing `DUTY_ASSIGNMENTS` data into a weekly roster
- Auto-generate a fair rotation: distribute morning duty, gate duty, etc. evenly across teachers
- Track which teacher covered which duty, exportable as PDF

### Multi-Academic-Year Support
- Tag all data (schedules, attendance, marks) with an `academic_year` field
- Year rollover: carry teachers and class config forward, reset timetable and attendance
- Historical reports remain queryable by year

### Notifications & Alerts
- In-app notification bell (new exam added, attendance below threshold, schedule changed)
- Optional email digest (absent teachers, uncovered periods)

---

## 6. Migration Strategy

The v1 app and v2 app can run concurrently during the transition.

```
Week 1-2  │ Phase 0 complete — backend running, auth working, React shell up
Week 3-4  │ Phase 1 — scheduling migrated, undo/redo live, v2 usable as a drop-in
Week 5-6  │ Phase 2 — attendance live, v1 retired
Week 7-8  │ Phase 3 — marks live
Week 9+   │ Phase 4 — analytics live
```

**Data migration steps:**
1. Export all `saved_schedules/*.json` files.
2. Run seed script: reads `school-config.json`, inserts teachers, classes, subjects into DB.
3. Import the most recent active schedule as a `schedule_versions` row with `is_active = true`.
4. All localStorage data is abandoned (it was per-browser anyway).

---

## 7. What to Build First

If bandwidth is limited, the highest-leverage sequence is:

1. **Auth + roles** — unlocks everything else; without it nothing is multi-user
2. **Scheduling on FastAPI + React shell** — proves the new stack works for the core use case
3. **Undo/redo** — low effort, high user satisfaction (purely client-side)
4. **Teacher attendance** — already partially modelled; quick win
5. **Student attendance** — biggest new data model, but unlocks Phase 4
6. **Marks** — straightforward CRUD, high perceived value
7. **Analytics** — the most impressive but depends on 4–6 being populated with real data

---

## 8. Master TODO Checklist

### Infrastructure
- [ ] Initialise FastAPI project (`api/`)
- [ ] Set up PostgreSQL locally and in Docker
- [ ] Write all SQLAlchemy models and run initial Alembic migration
- [ ] Scaffold React + Vite project (`frontend/`)
- [ ] Configure Vite proxy to FastAPI during development
- [ ] Write `docker-compose.yml` (nginx + api + db)
- [ ] Set up GitHub Actions CI (lint + type check + migration check)

### Auth
- [ ] `POST /auth/login` — returns access + refresh JWT
- [ ] `POST /auth/refresh` — rotate access token
- [ ] `POST /auth/logout` — invalidate refresh token
- [ ] JWT middleware applied to all protected routes
- [ ] Role guards: `require_role(admin)`, `require_role(teacher)`, etc.
- [ ] Login page in React (email + password)
- [ ] Auth context + `useAuth()` hook
- [ ] Route guards per role

### Scheduling
- [ ] Port `scheduler.py` from `scheduler.js`
- [ ] Port `helpers.py` from `helpers.js`
- [ ] `POST /schedules/generate`
- [ ] `POST /schedules/regenerate`
- [ ] `GET /schedules` — list versions
- [ ] `GET /schedules/{id}` — fetch a version
- [ ] `POST /schedules/{id}/activate`
- [ ] `DELETE /schedules/{id}`
- [ ] `PATCH /schedules/{id}/cells/{sec}/{day}/{period}` — single cell edit
- [ ] Client-side undo/redo stack (React reducer)
- [ ] Schedule history list UI
- [ ] Compare two versions UI

### Teacher Attendance
- [ ] DB model + Alembic migration
- [ ] `POST /attendance/teachers` (bulk mark)
- [ ] `GET /attendance/teachers?teacher_id=&date_from=&date_to=`
- [ ] Daily marking UI (admin)
- [ ] Monthly calendar view per teacher
- [ ] CSV export
- [ ] Substitution suggestion endpoint + UI

### Student Attendance
- [ ] DB model + Alembic migration
- [ ] `POST /attendance/students` (per-period bulk mark)
- [ ] `GET /attendance/students?student_id=&class_id=&date_from=&date_to=`
- [ ] Roll-call UI for teachers
- [ ] Low-attendance alert threshold config
- [ ] Parent view of child attendance
- [ ] Monthly summary per student

### Academic Records
- [ ] Exam DB model + Alembic migration
- [ ] Marks DB model + Alembic migration
- [ ] `POST /exams` + `GET /exams?class_id=&academic_year=`
- [ ] `POST /marks/bulk`
- [ ] `GET /marks?student_id=`
- [ ] Marks-entry spreadsheet UI
- [ ] Per-student performance report UI
- [ ] Report card PDF generation

### Analytics
- [ ] `GET /analytics/coverage` — teacher attendance vs subject coverage
- [ ] `GET /analytics/student-performance` — attendance vs marks correlation
- [ ] `GET /analytics/subject-comparison` — section-wise marks comparison
- [ ] Coverage heatmap UI
- [ ] Scatter chart (attendance vs performance)
- [ ] At-risk student list UI
- [ ] Dashboard aggregation: today's absent teachers, low-attendance count, uncovered periods

### Additional
- [ ] Holiday calendar CRUD + integration with attendance
- [ ] Parent portal (read-only routes + UI)
- [ ] Substitution management (auto-suggest + apply)
- [ ] Duty roster auto-generation
- [ ] Multi-academic-year support (year tag on all entities + rollover script)
- [ ] In-app notification centre
- [ ] Communication notices (teacher → class)
