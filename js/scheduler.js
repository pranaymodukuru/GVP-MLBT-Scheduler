// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULING ALGORITHM & CONFLICT DETECTION
// generateTimetable — pure function, returns a new timetable object
// checkConflicts    — updates state and the #conflict-panel DOM element
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { DAYS, WORK_PERIODS, MAX_PD, SUBJECTS_CONFIG, NO_P1_LOCK_CLASSES, COMBINED_SECTIONS } from '../config/school-config.js';
import {
  allSectionIds,
  parseSection,
  getSubjects,
  getClassTeacherId,
  isSatHalf,
  isTeacherAvailable,
  getEffectiveSubjects,
  shuffle,
} from './helpers.js';

/**
 * Build a full timetable from scratch (or re-generate while preserving
 * locked cells when preserveLocked is true).
 *
 * Algorithm:
 *   1. Seed locked cells from the existing timetable.
 *   2. Pin Period 1 every day to the class teacher's subject.
 *   3. Build a subject queue from SUBJECT_FREQ; pad it to cover every slot.
 *   4. Greedy 1st pass: assign teachers respecting the MAX_PD soft cap.
 *   5. Relaxed 2nd pass: fill remaining unassigned cells ignoring the cap.
 *
 * @param  {boolean} preserveLocked  Keep locked cells from state.timetable
 * @returns {object}  New timetable object (does NOT mutate state)
 */
export function generateTimetable(preserveLocked = false) {
  const tt  = {};   // new timetable being built
  const occ = {};   // occ[tid][day][period] = secId (teacher occupancy)
  const dc  = {};   // dc[tid][day] = count of periods assigned today

  state.TEACHERS.forEach(t => {
    occ[t.id] = {};
    dc[t.id]  = {};
    DAYS.forEach(d => { occ[t.id][d] = {}; dc[t.id][d] = 0; });
  });

  // ── Step 1: Seed locked cells ──────────────────────────────────────────────
  if (preserveLocked && Object.keys(state.timetable).length) {
    allSectionIds().forEach(secId => {
      tt[secId] = {};
      DAYS.forEach(d => {
        tt[secId][d] = {};
        WORK_PERIODS.forEach(p => {
          const ex = (state.timetable[secId] || {})[d]?.[p];
          if (ex?.locked) {
            tt[secId][d][p] = { ...ex };
            if (ex.teacherId && occ[ex.teacherId]) {
              occ[ex.teacherId][d][p] = secId;
              dc[ex.teacherId][d]++;
            }
          }
        });
      });
    });
  }

  // ── Step 1b: Pin combined-section periods (shared classes) ────────────────
  // These slots are locked before the per-section loop so the regular P1-pin
  // step skips them and the subject queue deducts them correctly.
  COMBINED_SECTIONS.forEach(({ sections: combinedSecs, period, teacherId, subject }) => {
    DAYS.forEach(d => {
      if (!isTeacherAvailable(teacherId, d, period)) return;
      combinedSecs.forEach(secId => {
        if (!tt[secId]) tt[secId] = {};
        if (!tt[secId][d]) tt[secId][d] = {};
        tt[secId][d][period] = { subject, teacherId, locked: true };
      });
      if (occ[teacherId]?.[d]) {
        occ[teacherId][d][period] = combinedSecs[0];
        dc[teacherId][d]++;
      }
    });
  });

  // ── Step 2 & 3 & 4: Greedy 1st pass ───────────────────────────────────────
  allSectionIds().forEach(secId => {
    if (!tt[secId]) tt[secId] = {};

    const subjects  = getSubjects(secId);
    const half      = isSatHalf(secId);
    const ctId      = getClassTeacherId(secId);
    const ct        = state.TEACHERS.find(t => t.id === ctId);
    const ctSubject = ct ? ct.subjects.find(s => subjects.includes(s)) || null : null;

    // Pin P1 to the class teacher's subject on every day (unless opted out)
    const { base } = parseSection(secId);
    if (!NO_P1_LOCK_CLASSES.includes(base)) {
      DAYS.forEach(d => {
        if (!tt[secId][d]) tt[secId][d] = {};
        if (tt[secId][d]['P1']?.locked) return;
        if (ct && ctSubject && !occ[ct.id][d]['P1'] && isTeacherAvailable(ct.id, d, 'P1')) {
          tt[secId][d]['P1'] = { subject: ctSubject, teacherId: ct.id, locked: true };
          occ[ct.id][d]['P1'] = secId;
          dc[ct.id][d]++;
        }
      });
    }

    // Collect the remaining unfilled, unlocked slots
    const skipP1Lock = NO_P1_LOCK_CLASSES.includes(base);
    const slots = [];
    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      if (p === 'P1' && !skipP1Lock) return;
      if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
      if (tt[secId][d]?.[p]?.locked) return;
      slots.push({ d, p });
    }));

    // Build subject queue from SUBJECT_FREQ, subtracting P1-pinned occurrences.
    // For sections with a combined-section P1 override, deduct that subject instead.
    const combinedP1 = COMBINED_SECTIONS.find(cs => cs.period === 'P1' && cs.sections.includes(secId));
    const p1Subject  = combinedP1 ? combinedP1.subject : ctSubject;
    const p1n        = combinedP1 ? DAYS.length : ((!skipP1Lock && ct && ctSubject) ? DAYS.length : 0);
    const queue = [];
    subjects.forEach(s => {
      const n = Math.max(0, (state.SUBJECT_FREQ[s] || 2) - (s === p1Subject ? p1n : 0));
      for (let i = 0; i < n; i++) queue.push(s);
    });

    // Pad queue so every slot gets a subject (cycle through teachable subjects)
    const teachable = shuffle(subjects.filter(s => {
      const meta = SUBJECTS_CONFIG[s] || {};
      if (meta.anyClassTeacher || meta.anyFreeTeacher) return true;
      return state.TEACHERS.some(t =>
        getEffectiveSubjects(t, base).includes(s) &&
        (t.classes.includes(base) || t.classes.includes(secId))
      );
    }));
    if (teachable.length) {
      let fi = 0;
      while (queue.length < slots.length) { queue.push(teachable[fi % teachable.length]); fi++; }
    }

    const sq = shuffle(queue);
    const ss = shuffle([...slots]);

    // Track how many times each subject is already assigned per day (locked/P1 cells)
    const subjDay = {};
    DAYS.forEach(d => { subjDay[d] = {}; });
    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      const c = tt[secId]?.[d]?.[p];
      if (c?.subject) subjDay[d][c.subject] = (subjDay[d][c.subject] || 0) + 1;
    }));

    const maxSPD   = state.CONSTRAINTS?.maxSubjectPeriodsPerDay ?? 2;
    const peLimit  = (state.CONSTRAINTS?.peOncePerDay ?? true) ? 1 : Infinity;

    // Consume subjects in order; skip any subject that has hit its daily cap
    const remaining = [...sq];
    ss.forEach(({ d, p }) => {
      if (!tt[secId][d]) tt[secId][d] = {};

      const subjIdx = remaining.findIndex(s => {
        const limit = s === 'Physical Education' ? Math.min(maxSPD, peLimit) : maxSPD;
        return (subjDay[d][s] || 0) < limit;
      });
      if (subjIdx === -1) { tt[secId][d][p] = null; return; }

      const subj = remaining.splice(subjIdx, 1)[0];
      subjDay[d][subj] = (subjDay[d][subj] || 0) + 1;

      const subMeta = SUBJECTS_CONFIG[subj] || {};
      const cands = shuffle(
        subMeta.anyFreeTeacher
          ? state.TEACHERS
          : subMeta.anyClassTeacher
            ? state.TEACHERS.filter(t => t.classes.includes(base) || t.classes.includes(secId))
            : state.TEACHERS.filter(t =>
                getEffectiveSubjects(t, base).includes(subj) &&
                (t.classes.includes(base) || t.classes.includes(secId))
              )
      ).sort((a, b) => (dc[a.id][d] || 0) - (dc[b.id][d] || 0));

      let assigned = null;
      const maxTPD = state.CONSTRAINTS?.maxTeacherPeriodsPerDay ?? MAX_PD;
      for (const t of cands) {
        if (!occ[t.id][d][p] && isTeacherAvailable(t.id, d, p) && (dc[t.id][d] || 0) < maxTPD) {
          assigned = t;
          occ[t.id][d][p] = secId;
          dc[t.id][d]++;
          break;
        }
      }
      tt[secId][d][p] = assigned
        ? { subject: subj, teacherId: assigned.id }
        : { subject: subj, teacherId: null };
    });
  });

  // ── Step 5: Relaxed 2nd pass (no day-cap) ─────────────────────────────────
  allSectionIds().forEach(secId => {
    const { base } = parseSection(secId);
    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      const cell = tt[secId]?.[d]?.[p];
      if (!cell?.subject || cell.teacherId || cell.locked) return;
      const subMeta = SUBJECTS_CONFIG[cell.subject] || {};
      const pool = subMeta.anyFreeTeacher
        ? state.TEACHERS
        : subMeta.anyClassTeacher
          ? state.TEACHERS.filter(t => t.classes.includes(base) || t.classes.includes(secId))
          : state.TEACHERS.filter(t =>
              getEffectiveSubjects(t, base).includes(cell.subject) &&
              (t.classes.includes(base) || t.classes.includes(secId))
            );
      const cands = shuffle(pool.filter(t =>
        !occ[t.id]?.[d]?.[p] && isTeacherAvailable(t.id, d, p)
      ));
      if (cands.length) {
        cell.teacherId = cands[0].id;
        occ[cands[0].id][d][p] = secId;
        dc[cands[0].id][d]++;
      }
    }));
  });

  // ── Step 6: Enforce minimum periods per week ──────────────────────────────
  // For each section, count actual subject assignments. For any subject below
  // its minimum, swap out a cell whose subject is above its own minimum, but
  // only when a teacher is available for the deficit subject in that slot.
  allSectionIds().forEach(secId => {
    const { base } = parseSection(secId);
    const subjects = getSubjects(secId);
    const half     = isSatHalf(secId);

    const count = {};
    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
      const cell = tt[secId]?.[d]?.[p];
      if (cell?.subject) count[cell.subject] = (count[cell.subject] || 0) + 1;
    }));

    subjects.forEach(subj => {
      const min    = state.SUBJECT_MIN_FREQ?.[subj] ?? 0;
      let   deficit = min - (count[subj] || 0);
      if (deficit <= 0) return;

      DAYS.forEach(d => {
        if (deficit <= 0) return;
        WORK_PERIODS.forEach(p => {
          if (deficit <= 0) return;
          const cell = tt[secId]?.[d]?.[p];
          if (!cell?.subject || cell.locked || cell.subject === subj) return;

          const swapMin   = state.SUBJECT_MIN_FREQ?.[cell.subject] ?? 0;
          const swapCount = count[cell.subject] || 0;
          if (swapCount <= swapMin) return;

          const subMeta = SUBJECTS_CONFIG[subj] || {};
          const pool = subMeta.anyFreeTeacher
            ? state.TEACHERS
            : subMeta.anyClassTeacher
              ? state.TEACHERS.filter(t => t.classes.includes(base) || t.classes.includes(secId))
              : state.TEACHERS.filter(t =>
                  getEffectiveSubjects(t, base).includes(subj) &&
                  (t.classes.includes(base) || t.classes.includes(secId))
                );
          const cands = shuffle(pool.filter(t =>
            !occ[t.id]?.[d]?.[p] && isTeacherAvailable(t.id, d, p)
          ));
          if (!cands.length) return;

          const oldTid = cell.teacherId;
          if (oldTid && occ[oldTid]?.[d]) {
            delete occ[oldTid][d][p];
            dc[oldTid][d] = Math.max(0, (dc[oldTid][d] || 0) - 1);
          }

          count[cell.subject] = swapCount - 1;
          count[subj]         = (count[subj] || 0) + 1;

          cell.subject    = subj;
          cell.teacherId  = cands[0].id;
          occ[cands[0].id][d][p] = secId;
          dc[cands[0].id][d]     = (dc[cands[0].id][d] || 0) + 1;
          deficit--;
        });
      });
    });
  });

  // ── Step 7: Enforce mustAppearDaily subjects ──────────────────────────────
  // For subjects flagged mustAppearDaily, ensure they appear at least once on
  // every day. For missing days, swap out a cell whose current subject is above
  // its weekly minimum and a teacher is available for the required subject.
  allSectionIds().forEach(secId => {
    const { base } = parseSection(secId);
    const subjects = getSubjects(secId);
    const half     = isSatHalf(secId);

    const dayCount  = {};  // dayCount[day][subj] = count
    const weekCount = {};  // weekCount[subj] = total count
    DAYS.forEach(d => {
      dayCount[d] = {};
      WORK_PERIODS.forEach(p => {
        if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
        const cell = tt[secId]?.[d]?.[p];
        if (cell?.subject) {
          dayCount[d][cell.subject]  = (dayCount[d][cell.subject]  || 0) + 1;
          weekCount[cell.subject]    = (weekCount[cell.subject]    || 0) + 1;
        }
      });
    });

    subjects.forEach(subj => {
      if (!state.SUBJECT_MUST_APPEAR_DAILY?.[subj]) return;

      DAYS.forEach(d => {
        if ((dayCount[d][subj] || 0) > 0) return;

        WORK_PERIODS.some(p => {
          if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return false;
          const cell = tt[secId]?.[d]?.[p];
          if (!cell?.subject || cell.locked || cell.subject === subj) return false;

          const swapSubj     = cell.subject;
          const swapWeekMin  = state.SUBJECT_MIN_FREQ?.[swapSubj] ?? 0;
          if ((weekCount[swapSubj] || 0) <= swapWeekMin) return false;

          const subMeta = SUBJECTS_CONFIG[subj] || {};
          const pool = subMeta.anyFreeTeacher
            ? state.TEACHERS
            : subMeta.anyClassTeacher
              ? state.TEACHERS.filter(t => t.classes.includes(base) || t.classes.includes(secId))
              : state.TEACHERS.filter(t =>
                  getEffectiveSubjects(t, base).includes(subj) &&
                  (t.classes.includes(base) || t.classes.includes(secId))
                );
          const cands = shuffle(pool.filter(t =>
            !occ[t.id]?.[d]?.[p] && isTeacherAvailable(t.id, d, p)
          ));
          if (!cands.length) return false;

          const oldTid = cell.teacherId;
          if (oldTid && occ[oldTid]?.[d]) {
            delete occ[oldTid][d][p];
            dc[oldTid][d] = Math.max(0, (dc[oldTid][d] || 0) - 1);
          }

          dayCount[d][swapSubj]  = (dayCount[d][swapSubj]  || 0) - 1;
          weekCount[swapSubj]    = (weekCount[swapSubj]     || 0) - 1;
          dayCount[d][subj]      = (dayCount[d][subj]       || 0) + 1;
          weekCount[subj]        = (weekCount[subj]         || 0) + 1;

          cell.subject   = subj;
          cell.teacherId = cands[0].id;
          occ[cands[0].id][d][p] = secId;
          dc[cands[0].id][d]     = (dc[cands[0].id][d] || 0) + 1;
          return true; // found a slot for this day, stop searching
        });
      });
    });
  });

  return tt;
}

/** True when teacher appears in two sections that are intentionally combined at that period */
function isCombinedGroup(teacherId, period, sec1, sec2) {
  return COMBINED_SECTIONS.some(cs =>
    cs.teacherId === teacherId &&
    cs.period    === period    &&
    cs.sections.includes(sec1) &&
    cs.sections.includes(sec2)
  );
}

/**
 * Scan state.timetable for teacher double-bookings.
 * Updates state.conflictRecords and state.conflictSet.
 * Also renders the #conflict-panel DOM element.
 */
export function checkConflicts() {
  const occ = {};
  state.conflictRecords = [];
  state.conflictSet     = new Set();

  allSectionIds().forEach(secId => {
    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      const cell = (state.timetable[secId] || {})[d]?.[p];
      if (cell?.teacherId) {
        const key = `${cell.teacherId}|${d}|${p}`;
        if (occ[key]) {
          if (!isCombinedGroup(cell.teacherId, p, occ[key], secId)) {
            const t = state.TEACHERS.find(x => x.id === cell.teacherId);
            state.conflictRecords.push({
              teacherName: t?.name || cell.teacherId,
              teacherId:   cell.teacherId,
              day:         d,
              period:      p,
              sec1:        occ[key],
              sec2:        secId,
            });
            state.conflictSet.add(`${secId}|${d}|${p}`);
            state.conflictSet.add(`${occ[key]}|${d}|${p}`);
          }
        } else {
          occ[key] = secId;
        }
      }
    }));
  });

  const panel = document.getElementById('conflict-panel');
  if (state.conflictRecords.length) {
    panel.innerHTML =
      `<strong>⚠️ ${state.conflictRecords.length} conflict(s)</strong>` +
      `<ul style="margin:6px 0 0 18px">` +
      state.conflictRecords.map(c =>
        `<li style="margin-bottom:3px"><strong>${c.teacherName}</strong> ` +
        `double-booked ${c.day} ${c.period}: <strong>${c.sec1}</strong> &amp; <strong>${c.sec2}</strong></li>`
      ).join('') +
      `</ul>`;
    panel.style.cssText =
      'background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;' +
      'border-radius:10px;padding:10px 16px;margin-bottom:1rem;font-size:12px;display:block';
  } else {
    panel.innerHTML = '<strong>✅ No conflicts — schedule is clean</strong>';
    panel.style.cssText =
      'background:#f0fdf4;border:1px solid #86efac;color:#166534;' +
      'border-radius:10px;padding:10px 16px;margin-bottom:1rem;font-size:12px;display:block';
  }
}
