# Timetable Scheduling Constraints

This document describes every rule the auto-scheduler follows when generating the timetable.
Rules are grouped from most rigid (hard constraints that can never be violated) to softest
(preferences that may be relaxed when no other option exists).

---

## 1. Period 1 Lock

**For all classes except Class 10:**
Period 1 every day is always reserved for the class teacher's own subject. These cells are
locked and survive regeneration. They cannot be overridden by the greedy fill algorithm.

**For Class 10 (both sections A and B):**
Period 1 every day is taught by **V. S. R. Murthy** (Telugu), and both sections attend this
class together at the same time. This is a combined class — Murthy appearing in both 10-A and
10-B at Period 1 is intentional and is not flagged as a conflict.
V. S. R. Murthy is only ever scheduled for Period 1; he is not assigned to any other period.

---

## 2. Saturday Half-Day

The following classes have a half-day on Saturdays — Period 7 and Period 8 are skipped:

- PP2, PP1
- Class 1, Class 2, Class 3, Class 4, Class 5, Class 6, Class 7

Classes 8, 9, and 10 have a full Saturday.

---

## 3. Pre-Primary Period Limit

PP1 and PP2 have no Period 8 — their school day ends after Period 7.

---

## 4. Upper Class Work Review

Classes 8, 9, and 10 have a **Work Review** slot at the end of every day (4:30–5:00 PM).
This slot is shown in the timetable but is not a schedulable teaching period.

---

## 5. No Teacher Double-Booking

A teacher cannot be assigned to two different classes at the same time. The conflict panel
shows any violations in red.

**Exception:** V. S. R. Murthy teaching both Class 10-A and 10-B together at Period 1 is
explicitly allowed and does not show as a conflict (see constraint 1).

---

## 6. Teacher Workload Cap

Each teacher is assigned a maximum of **6 teaching periods per day** (soft cap). If some
periods remain unassigned after the first pass, a relaxed second pass runs without the cap
to try to fill them.

---

## 7. Physical Education — One Period Per Day Per Class

A class cannot have more than one Physical Education period on the same day. The scheduler
tracks PE assignments per day and skips any additional PE slots for that class on that day.

---

## 8. Teacher Absent Days

Any teacher can be marked as absent for specific days of the week in the Attendance panel.
The scheduler will not assign an absent teacher to any period on their blocked day(s).
Cells showing an absent teacher are highlighted with a red border.

---

## 9. Period-Level Availability

Some teachers are only available for specific periods. The scheduler respects this when
assigning them:

- **V. S. R. Murthy (T20)** — available for Period 1 only.

---

## 10. Class-Specific Subject Restrictions

Some teachers teach different subjects depending on the class. The scheduler uses
class-specific subject lists for these teachers rather than their general subject list:

| Teacher | Class | Restricted to |
|---|---|---|
| U. Mayuri (T02) | Class 1, Class 2 | Hindi only |
| N.G. Bhavani (T05) | Class 6, Class 7 | Hindi only |
| V. Aruna Kumari (T08) | Class 6, Class 7 | Gen. Science only |
| B. Ramanamma (T10) | Class 5 | EVS - Social only |
| L. Kiranmayi (T13) | Class 8, Class 10 | Biology only |
| M. Vani Usha Sri (T14) | Class 9 | Social only |

---

## 11. Special Subjects — Free Teacher Assignment

Some subjects do not require a specialist and are assigned to any available teacher:

| Subject | Rule |
|---|---|
| Library | Assigned to whichever teacher is free that period |
| Computer/AI | Assigned to whichever teacher is free that period |
| Newspaper Reading | Assigned to whichever teacher is free that period |
| Audio Video | Assigned to any teacher who teaches that class |

---

## 12. Subject Frequency — Target and Minimum

Each subject has two configurable period counts, both editable in **Admin → Subject Frequencies**:

| Field | JSON key | Meaning |
|---|---|---|
| Target | `periodsPerWeek` | Ideal count the scheduler fills the queue toward |
| Minimum | `minPeriodsPerWeek` | Floor the scheduler actively tries to guarantee |

After the greedy passes, a **Step 6 enforcement pass** runs: for each section where a subject is below its minimum, the pass scans non-locked cells whose current subject is above *its* minimum, and swaps in the deficit subject (provided a teacher is available for that slot). This never reduces any other subject below its own minimum. If the pass cannot fully resolve a shortfall (no available teacher), remaining violations are shown as **🟠 Below Minimum** in the Dashboard.

Default values:

| Subject | Min / week | Target / week |
|---|---|---|
| English, Maths, Hindi, Telugu | 4 | 6 |
| EVS, Gen. Science, Physical Science, Biology, Social | 3 | 5 |
| EVS - Science, EVS - Social | 2 | 3 |
| GK, Drawing, Computers, AI, Moral Science, Value Education, Physical Education, Games, Natural Talk, Health Talk, Story Telling, Audio Video, Computer/AI, Newspaper Reading, Sports & Games | 1 | 2 |
| Library | 1 | 1 |

---

## 13. Must Appear Daily

Subjects with `mustAppearDaily: true` must be scheduled at least once on every school day for each section. After the minimum-enforcement pass, a **Step 7 pass** runs: for any day where such a subject is absent, the pass finds a swappable cell on that day (non-locked, whose subject is above its weekly minimum) and swaps in the required subject if a teacher is available. Remaining violations are shown as **🔴 Missing Daily** in the Dashboard.

By default, `mustAppearDaily` is enabled for:

- English, Maths, Hindi, Telugu

These are the only subjects with 6 periods/week (matching the 6-day school week), making daily appearance feasible. The flag can be toggled per subject in **Admin → Subject Frequencies**.

---

## 14. Locked Cells

Any cell can be manually locked (right-click → lock). Locked cells:
- Are preserved when the timetable is regenerated.
- Are shown with a 🔒 icon (📌 for Period 1 locks).
- Cannot be overwritten by the scheduler.

Period 1 cells assigned by rules 1 and the combined-section rule are locked automatically.
