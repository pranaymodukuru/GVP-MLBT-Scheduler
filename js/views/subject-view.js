// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT VIEW — renders a cross-section grid for one subject
// Rows = periods (like Class/Teacher View), Columns = days
// Each cell shows all sections that have this subject at that slot + teacher
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import { allSectionIds, getSubjects } from '../helpers.js';

export function renderSubjectView() {
  const subject = document.getElementById('subject-select').value;
  if (!subject) return;

  const secs = allSectionIds().filter(secId => getSubjects(secId).includes(subject));
  const bg   = SUBJECT_COLORS[subject] || '#f0f0f0';
  const tc   = SUBJECT_TEXT[subject]   || '#333';

  let totalPeriods = 0;
  const teacherSet = new Set();

  const thead = `<tr><th>Period / Day</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr>`;
  let tbody = '';

  PERIODS.forEach(per => {
    if (per.isBreak) {
      tbody +=
        `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>` +
        DAYS.map(() => `<td><div class="cell-break">${per.label}</div></td>`).join('') +
        `</tr>`;
      return;
    }

    tbody += `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>`;

    DAYS.forEach(day => {
      const hits = [];
      secs.forEach(secId => {
        const cell = (state.timetable[secId] || {})[day]?.[per.id];
        if (cell?.subject === subject) {
          const teacher = state.TEACHERS.find(t => t.id === cell.teacherId);
          hits.push({ secId, teacher, locked: cell.locked });
          totalPeriods++;
          if (cell.teacherId) teacherSet.add(cell.teacherId);
        }
      });

      if (hits.length) {
        const inner = hits.map(h => {
          const tName   = h.teacher ? h.teacher.name : '⚠️';
          const lockIcon = h.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';
          return (
            `<div class="cell${h.locked ? ' cell-locked' : ''}"` +
            ` style="background:${bg};color:${tc};margin-bottom:3px"` +
            ` onclick="openEdit('${h.secId}','${day}','${per.id}')"` +
            ` oncontextmenu="toggleCellLock('${h.secId}','${day}','${per.id}',event)">` +
            (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
            `<span class="cell-subj">${h.secId}</span>` +
            `<span class="cell-teacher">${tName}</span>` +
            `</div>`
          );
        }).join('');
        tbody += `<td>${inner}</td>`;
      } else {
        tbody += `<td><div class="cell cell-empty" style="cursor:default">—</div></td>`;
      }
    });

    tbody += '</tr>';
  });

  if (!secs.length) {
    tbody =
      `<tr><td colspan="${DAYS.length + 1}" class="empty-state">` +
      `No sections have this subject assigned</td></tr>`;
  }

  document.getElementById('subject-table').innerHTML =
    `<thead>${thead}</thead><tbody>${tbody}</tbody>`;

  document.getElementById('subject-stats-badge').textContent = `${totalPeriods} periods/week`;
  document.getElementById('subject-stats').innerHTML =
    `<div class="stat"><div class="stat-val">${totalPeriods}</div><div class="stat-lbl">Periods / week</div></div>` +
    `<div class="stat"><div class="stat-val">${secs.length}</div><div class="stat-lbl">Sections</div></div>` +
    `<div class="stat"><div class="stat-val">${teacherSet.size}</div><div class="stat-lbl">Teachers</div></div>` +
    `<div class="stat"><div class="stat-val">${secs.length ? (totalPeriods / secs.length).toFixed(1) : 0}</div><div class="stat-lbl">Avg / section</div></div>`;
}
