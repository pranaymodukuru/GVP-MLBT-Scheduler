// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULING ALGORITHM & CONFLICT DETECTION
// generateTimetable — pure function, returns a new timetable object
// checkConflicts    — updates state and the #conflict-panel DOM element
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { DAYS, WORK_PERIODS, MAX_PD, SUBJECTS_CONFIG, NO_P1_LOCK_CLASSES, COMBINED_SECTIONS, COMBINABLE_GROUPS, AFTER_LUNCH_PERIODS } from '../config/school-config.js';
import {
  allSectionIds,
  parseSection,
  getSubjects,
  getClassTeacherId,
  isSatHalf,
  isTeacherAvailable,
  isActivePeriod,
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
          if (!isActivePeriod(secId, p)) return;
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
      if (!isActivePeriod(secId, p)) return;
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
      if (!isActivePeriod(secId, p)) return;
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
      if (!isActivePeriod(secId, p)) return;
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
          if (!isActivePeriod(secId, p)) return;
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
        if (!isActivePeriod(secId, p)) return;
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
          if (!isActivePeriod(secId, p)) return false;
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

  // ── Step 8: Sync combined-after-lunch sections ────────────────────────────
  // For groups like PP1+PP2, every post-lunch slot should share the same
  // subject and teacher so they can be taught as a single combined class.
  if (COMBINABLE_GROUPS.length && AFTER_LUNCH_PERIODS.length) {
    COMBINABLE_GROUPS.forEach(baseGroup => {
      const groupSecs = allSectionIds().filter(s => baseGroup.includes(parseSection(s).base));
      if (groupSecs.length < 2) return;

      DAYS.forEach(d => {
        AFTER_LUNCH_PERIODS.forEach(p => {
          if (groupSecs.some(s => !isActivePeriod(s, p))) return;
          const entries = groupSecs.map(s => ({ s, cell: tt[s]?.[d]?.[p] }));
          if (entries.every(e => e.cell?.locked)) return;

          // Use the first non-locked cell that has both subject and teacher as the reference
          const primary = entries.find(e => !e.cell?.locked && e.cell?.subject && e.cell?.teacherId);
          if (!primary) return;

          const { subject, teacherId } = primary.cell;

          entries.forEach(({ s, cell }) => {
            if (s === primary.s) return;
            if (cell?.locked) return;
            if (cell?.subject === subject && cell?.teacherId === teacherId) return;

            const { base } = parseSection(s);
            const teacher = state.TEACHERS.find(t => t.id === teacherId);
            if (!teacher || !getEffectiveSubjects(teacher, base).includes(subject)) return;

            // Release the old teacher's occupancy slot
            const oldTid = cell?.teacherId;
            if (oldTid && oldTid !== teacherId && occ[oldTid]?.[d]) {
              delete occ[oldTid][d][p];
              dc[oldTid][d] = Math.max(0, (dc[oldTid][d] || 0) - 1);
            }

            if (!tt[s]) tt[s] = {};
            if (!tt[s][d]) tt[s][d] = {};
            tt[s][d][p] = { subject, teacherId };
            // occ already reflects the primary section's slot; no additional entry needed
          });
        });
      });
    });
  }

  return tt;
}

/** True when two sections are intentionally combined at the given period (room-based check) */
function isSectionsCombined(period, sec1, sec2) {
  if (COMBINED_SECTIONS.some(cs =>
    cs.period === period &&
    cs.sections.includes(sec1) &&
    cs.sections.includes(sec2)
  )) return true;

  if (AFTER_LUNCH_PERIODS.includes(period)) {
    const base1 = parseSection(sec1).base;
    const base2 = parseSection(sec2).base;
    return COMBINABLE_GROUPS.some(g => g.includes(base1) && g.includes(base2));
  }

  return false;
}

/** True when teacher appears in two sections that are intentionally combined at that period */
function isCombinedGroup(teacherId, period, sec1, sec2, subject1, subject2) {
  if (COMBINED_SECTIONS.some(cs =>
    cs.teacherId === teacherId &&
    cs.period    === period    &&
    cs.sections.includes(sec1) &&
    cs.sections.includes(sec2)
  )) return true;

  // After-lunch combined groups: same teacher + same subject = intentional combined class
  if (AFTER_LUNCH_PERIODS.includes(period) && subject1 && subject1 === subject2) {
    const base1 = parseSection(sec1).base;
    const base2 = parseSection(sec2).base;
    return COMBINABLE_GROUPS.some(g => g.includes(base1) && g.includes(base2));
  }

  return false;
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
      if (!isActivePeriod(secId, p)) return;
      const cell = (state.timetable[secId] || {})[d]?.[p];
      if (cell?.teacherId) {
        const key = `${cell.teacherId}|${d}|${p}`;
        if (occ[key]) {
          const cell1 = (state.timetable[occ[key]] || {})[d]?.[p];
          const bothParallel = SUBJECTS_CONFIG[cell.subject]?.allowParallelGroups &&
                               SUBJECTS_CONFIG[cell1?.subject]?.allowParallelGroups;
          if (!bothParallel && !isCombinedGroup(cell.teacherId, p, occ[key], secId, cell1?.subject, cell.subject)) {
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

  // ── Room capacity conflicts ────────────────────────────────────────────────
  // Subjects flagged sharedRoom:true map to a single physical space; at most
  // one non-combined group may occupy that space per period.
  const sharedRoomSubjects = new Set(
    Object.entries(SUBJECTS_CONFIG)
      .filter(([, s]) => s.sharedRoom)
      .map(([name]) => name)
  );

  if (sharedRoomSubjects.size > 0) {
    DAYS.forEach(d => {
      WORK_PERIODS.forEach(p => {
        const roomOcc = {};
        allSectionIds().forEach(secId => {
          if (!isActivePeriod(secId, p)) return;
          const cell = (state.timetable[secId] || {})[d]?.[p];
          if (cell?.subject && sharedRoomSubjects.has(cell.subject)) {
            (roomOcc[cell.subject] ||= []).push(secId);
          }
        });

        Object.entries(roomOcc).forEach(([room, secs]) => {
          for (let i = 0; i < secs.length; i++) {
            for (let j = i + 1; j < secs.length; j++) {
              if (!isSectionsCombined(p, secs[i], secs[j])) {
                state.conflictRecords.push({ room, day: d, period: p, sec1: secs[i], sec2: secs[j] });
                state.conflictSet.add(`${secs[i]}|${d}|${p}`);
                state.conflictSet.add(`${secs[j]}|${d}|${p}`);
              }
            }
          }
        });
      });
    });
  }

  // ── Venue conflicts (allowParallelGroups subjects) ────────────────────────
  // Flag when two non-combinable sections with different teachers share the
  // same venue (both Indoor or both Outdoor) at the same slot.
  const parallelSubjects = new Set(
    Object.entries(SUBJECTS_CONFIG)
      .filter(([, s]) => s.allowParallelGroups)
      .map(([name]) => name)
  );

  if (parallelSubjects.size > 0) {
    DAYS.forEach(d => {
      WORK_PERIODS.forEach(p => {
        const bySubject = {};
        allSectionIds().forEach(secId => {
          if (!isActivePeriod(secId, p)) return;
          const cell = (state.timetable[secId] || {})[d]?.[p];
          if (cell?.subject && parallelSubjects.has(cell.subject)) {
            const tid = cell.teacherId || '__none__';
            ((bySubject[cell.subject] ||= {})[tid] ||= []).push(secId);
          }
        });

        Object.entries(bySubject).forEach(([subj, teacherGroups]) => {
          const sortedTeachers = Object.keys(teacherGroups).sort();
          if (sortedTeachers.length <= 1) return;

          // Assign venue to each teacher group (respects venueFlips)
          const flipped = !!state.venueFlips[`${subj}|${d}|${p}`];
          const venueOf = {}; // secId → 'Indoor'|'Outdoor'
          sortedTeachers.forEach((tid, idx) => {
            const venue = (idx === 0) !== flipped ? 'Indoor' : 'Outdoor';
            teacherGroups[tid].forEach(secId => { venueOf[secId] = venue; });
          });

          // For each venue, check all pairs with different teachers
          ['Indoor', 'Outdoor'].forEach(venue => {
            const secs = Object.keys(venueOf).filter(s => venueOf[s] === venue);
            for (let i = 0; i < secs.length; i++) {
              for (let j = i + 1; j < secs.length; j++) {
                const s1 = secs[i], s2 = secs[j];
                const t1 = (state.timetable[s1]?.[d]?.[p])?.teacherId;
                const t2 = (state.timetable[s2]?.[d]?.[p])?.teacherId;
                if (t1 === t2) continue;
                if (isSectionsCombined(p, s1, s2)) continue;
                state.conflictRecords.push({ venueSubject: subj, venue, day: d, period: p, sec1: s1, sec2: s2 });
                state.conflictSet.add(`${s1}|${d}|${p}`);
                state.conflictSet.add(`${s2}|${d}|${p}`);
              }
            }
          });
        });
      });
    });
  }

  const panel = document.getElementById('conflict-panel');
  if (state.conflictRecords.length) {
    panel.innerHTML =
      `<strong>⚠️ ${state.conflictRecords.length} conflict(s)</strong>` +
      `<ul style="margin:6px 0 0 18px">` +
      state.conflictRecords.map(c => c.venueSubject
        ? `<li style="margin-bottom:3px"><strong>${c.venueSubject}</strong> ` +
          `${c.venue} clash ${c.day} ${c.period}: <strong>${c.sec1}</strong> &amp; <strong>${c.sec2}</strong></li>`
        : c.room
        ? `<li style="margin-bottom:3px"><strong>${c.room}</strong> ` +
          `room clash ${c.day} ${c.period}: <strong>${c.sec1}</strong> &amp; <strong>${c.sec2}</strong></li>`
        : `<li style="margin-bottom:3px"><strong>${c.teacherName}</strong> ` +
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
