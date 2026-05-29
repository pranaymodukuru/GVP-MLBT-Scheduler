# Architecture & Tech Stack

## Tech Stack

| Layer | Technology |
|---|---|
| **Language** | Vanilla JavaScript — ES2020, native ES6 modules |
| **Markup** | HTML5 |
| **Styling** | CSS3 with custom properties (variables) for theming |
| **Icons** | [Tabler Icons](https://tabler.io/icons) webfont via CDN |
| **Dev server** | Python 3 — `http.server` extended with a thin custom handler |
| **PDF export** | Browser `window.print()` (no library) |
| **Persistence** | `localStorage` (session) + server-side JSON files |
| **Build / bundler** | None |
| **Framework** | None |
| **Dependencies** | Zero npm packages |

There is no compilation step. The browser loads `js/app.js` directly as `<script type="module">`.

---

## Module Map

```
index.html                      ← Shell: layout, modals, <script type="module">
│
├── config/
│   ├── school-config.json      ← Source of truth for all school data
│   └── school-config.js        ← Loads JSON, re-exports named constants
│
├── styles/
│   └── main.css                ← All CSS; light/dark via data-theme attribute
│
├── js/
│   ├── app.js                  ← Entry point: wires modules, init(), window.* surface
│   ├── state.js                ← Singleton mutable state object
│   ├── scheduler.js            ← Core scheduling algorithm + conflict detection
│   ├── persistence.js          ← localStorage + server JSON save/load/export
│   ├── helpers.js              ← Pure utility functions
│   ├── selects.js              ← Dropdown/selector population
│   ├── toast.js                ← Toast notification helper
│   ├── pdf-export.js           ← Print-window PDF generation
│   │
│   ├── views/
│   │   ├── class-view.js       ← Class timetable grid (renders to #class-table)
│   │   ├── teacher-view.js     ← Teacher timetable grid + duty assignments
│   │   ├── subject-view.js     ← Subject coverage grid
│   │   ├── dashboard.js        ← Workload charts, issues, coverage stats
│   │   └── admin-view.js       ← Admin panels + all mutation handlers
│   │
│   └── modals/
│       ├── cell-modal.js       ← Cell edit dialog
│       └── teacher-modal.js    ← Teacher add/edit dialog
│
└── server.py                   ← Python dev server (static files + REST endpoints)
```

---

## Architectural Patterns

### Single-page app with tab routing
The app is a single HTML page. Navigation is handled entirely in JS by showing/hiding `<div>` panels and toggling `.active` on tab buttons. No URL routing.

### Singleton state
All mutable runtime data lives in one exported object from `state.js`. Every module imports `{ state }` and reads/writes it directly. There is no pub/sub, no reactive system, no proxies — just a plain object.

### Imperative DOM rendering
Views are plain functions (`renderClassView()`, `renderTeacherView()`, …) that build HTML strings and set `innerHTML`, or create DOM nodes directly. They are called explicitly after every state mutation. There is no virtual DOM or diffing.

### window.* bridge for HTML `onclick=`
ES6 modules are scoped — functions are not automatically global. `app.js` imports every handler and re-exports them onto `window.*` so that inline `onclick=` attributes in `index.html` can reach them. This is the only global surface; all logic stays inside modules.

### Data flow

```
school-config.json          (static defaults on disk)
       │
       ▼
   state.js                 (runtime singleton, hydrated from localStorage on load)
       │
       ├──► generateTimetable()   ──► state.timetable
       │       scheduler.js
       │
       ├──► checkConflicts()      ──► state.conflictRecords / DOM conflict panel
       │       scheduler.js
       │
       └──► render*()             ──► DOM
               views/*.js
```

---

## Persistence Model

There are three layers of persistence, each with a different lifetime:

| Layer | Where | Lifetime | Written by |
|---|---|---|---|
| **Session state** | `localStorage` | Until browser clear or Reset | Auto-saved on every change |
| **Named snapshots** | `saved_schedules/*.json` on disk | Permanent | User clicks Save |
| **Backup** | `saved_schedules/backup.json` on disk | Until overwritten | User clicks Set Backup |

On load the app checks for session state → backup → latest snapshot → generates fresh.

---

## Dev Server (`server.py`)

A thin wrapper around Python's `http.server.SimpleHTTPRequestHandler`. Needed because browsers block ES6 `import` on `file://`.

Custom endpoints on top of normal static file serving:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/latest-schedule` | Returns newest file in `saved_schedules/` |
| `GET` | `/backup-schedule` | Returns `saved_schedules/backup.json` |
| `GET` | `/saved-schedules` | Lists all saved JSON files with mtimes |
| `POST` | `/save` | Writes a timestamped snapshot to `saved_schedules/` |
| `POST` | `/save-backup` | Writes/overwrites `saved_schedules/backup.json` |
| `POST` | `/save-config` | Writes back to `config/school-config.json` |

If the server is not running, Save falls back to a browser download.

---

## PDF Export

`pdf-export.js` opens a new `window` with a self-contained HTML document (inline CSS, no external resources). Each timetable page is sized to A4 landscape using `@page` CSS rules. The browser's native print dialog handles the actual PDF rendering — no library is involved.

---

## Theming

Light/dark mode is toggled by setting a `data-theme` attribute on `<html>`. CSS custom properties (defined in `main.css`) switch values based on that attribute. The preference is persisted in `localStorage`. A small inline `<script>` in `<head>` reads this key before the page renders to avoid a flash of the wrong theme.
