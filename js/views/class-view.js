// ─────────────────────────────────────────────────────────────────────────────
// CLASS VIEW — renders the per-class timetable grid
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import { parseSection, getSubjects, isSatHalf, isUpper, isTeacherAvailable, isActivePeriod, getCombinedSections, getCombinableDiffTeacher, shortSec } from '../helpers.js';
import { getSelectorValue } from '../selects.js';

export function renderClassView() {
  const secId = getSelectorValue('class-select');
  if (!secId) return;

  const subjects   = getSubjects(secId);
  const half       = isSatHalf(secId);
  const upper      = isUpper(secId);
  const activeDays = half ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat (½)'] : DAYS;
  let total = 0, filled = 0;

  // Count subject occurrences in the timetable for this section
  const subjectCounts = {};
  const ttSection = state.timetable[secId] || {};
  Object.values(ttSection).forEach(dayObj => {
    Object.values(dayObj).forEach(cell => {
      if (cell?.subject) subjectCounts[cell.subject] = (subjectCounts[cell.subject] || 0) + 1;
    });
  });

  // Legend
  document.getElementById('class-legend').innerHTML =
    [...new Set(subjects)].map(s =>
      `<span class="legend-item">` +
      `<span class="legend-dot" style="background:${SUBJECT_COLORS[s] || '#eee'};` +
      `border:1px solid ${SUBJECT_TEXT[s] || '#999'}60"></span>${s}` +
      (subjectCounts[s] ? ` <span class="legend-count">${subjectCounts[s]}</span>` : '') +
      `</span>`
    ).join('');

  const thead = `<tr><th>Period / Day</th>${activeDays.map(d => `<th>${d}</th>`).join('')}</tr>`;
  let tbody = '';

  PERIODS.forEach(per => {
    // ── Break rows ──
    if (per.isBreak) {
      if (per.id === 'WRK' && !upper) return;
      tbody +=
        `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>` +
        activeDays.map(() => `<td><div class="cell-break">${per.label}</div></td>`).join('') +
        `</tr>`;
      return;
    }

    if (!isActivePeriod(secId, per.id)) return;

    tbody += `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>`;

    activeDays.forEach((d, di) => {
      const realDay = DAYS[di] || d;

      // Saturday half-day — grey out P7/P8
      if (d.includes('½') && ['P7', 'P8'].includes(per.id)) {
        tbody +=
          `<td><div style="background:#f9fafb;border-radius:7px;min-height:46px;` +
          `display:flex;align-items:center;justify-content:center;font-size:10px;color:#d1d5db">–</div></td>`;
        return;
      }

      total++;
      const cell = (state.timetable[secId] || {})[realDay]?.[per.id];

      if (cell?.subject) {
        filled++;
        const t          = state.TEACHERS.find(x => x.id === cell.teacherId);
        const bg         = SUBJECT_COLORS[cell.subject] || '#f5f5f5';
        const tc         = SUBJECT_TEXT[cell.subject]   || '#333';
        const isConflict = state.conflictSet.has(`${secId}|${realDay}|${per.id}`);
        const isAbsent   = cell.teacherId && !isTeacherAvailable(cell.teacherId, realDay);
        const lockIcon   = cell.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';
        const combined      = getCombinedSections(secId, realDay, per.id);
        const combinedDiff  = getCombinableDiffTeacher(secId, realDay, per.id);
        const classes    = [
          'cell',
          cell.locked  ? 'cell-locked'   : '',
          isConflict   ? 'cell-conflict'  : '',
          isAbsent     ? 'cell-absent'    : '',
        ].filter(Boolean).join(' ');

        tbody +=
          `<td><div class="${classes}" style="background:${bg};color:${tc}"` +
          ` onclick="openEdit('${secId}','${realDay}','${per.id}')"` +
          ` oncontextmenu="toggleCellLock('${secId}','${realDay}','${per.id}',event)"` +
          ` title="${cell.locked ? 'Locked — right-click to unlock' : 'Right-click to lock'}">` +
          (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
          `<span class="cell-subj">${cell.subject}</span>` +
          `<span class="cell-teacher">${t ? t.name : '⚠️ Unassigned'}</span>` +
          (combined.length ? `<span class="cell-combined">+ ${combined.map(shortSec).join(', ')}</span>` : '') +
          (combinedDiff.length ? combinedDiff.map(({secId: s, teacherName}) =>
            `<span class="cell-combined cell-combined-diff">+ ${shortSec(s)}, ${teacherName}</span>`
          ).join('') : '') +
          `</div></td>`;
      } else {
        tbody +=
          `<td><div class="cell cell-empty"` +
          ` onclick="openEdit('${secId}','${realDay}','${per.id}')">+</div></td>`;
      }
    });

    tbody += '</tr>';
  });

  document.getElementById('class-table').innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;

  const badge = document.getElementById('class-stats-badge');
  badge.textContent = `${filled} / ${total} periods filled`;
  badge.className   = filled === total ? 'badge badge-ok' : 'badge badge-warn';
}
