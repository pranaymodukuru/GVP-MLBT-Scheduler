// ─────────────────────────────────────────────────────────────────────────────
// TEACHER VIEW — renders the per-teacher timetable grid
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import { allSectionIds, isTeacherAvailable } from '../helpers.js';

export function renderTeacherView() {
  const tid = document.getElementById('teacher-select').value;
  if (!tid) return;

  const secs = allSectionIds();
  let filled = 0;
  const cc = {}; // classes count
  const sc = {}; // subjects count

  const thead = `<tr><th>Period / Day</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr>`;
  let tbody = '';

  PERIODS.forEach(per => {
    // ── Break rows ──
    if (per.isBreak) {
      tbody +=
        `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>` +
        DAYS.map(() => `<td><div class="cell-break">${per.label}</div></td>`).join('') +
        `</tr>`;
      return;
    }

    tbody += `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>`;

    DAYS.forEach(day => {
      let found = null;
      secs.forEach(s => {
        const c = (state.timetable[s] || {})[day]?.[per.id];
        if (c?.teacherId === tid) found = { cls: s, subject: c.subject, locked: c.locked };
      });

      if (found) {
        filled++;
        cc[found.cls]     = (cc[found.cls]     || 0) + 1;
        sc[found.subject] = (sc[found.subject] || 0) + 1;

        const bg         = SUBJECT_COLORS[found.subject] || '#f5f5f5';
        const tc         = SUBJECT_TEXT[found.subject]   || '#333';
        const isConflict = state.conflictSet.has(`${found.cls}|${day}|${per.id}`);
        const lockIcon   = found.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';

        tbody +=
          `<td><div class="cell${found.locked ? ' cell-locked' : ''}${isConflict ? ' cell-conflict' : ''}"` +
          ` style="background:${bg};color:${tc}"` +
          ` onclick="openEdit('${found.cls}','${day}','${per.id}')"` +
          ` oncontextmenu="toggleCellLock('${found.cls}','${day}','${per.id}',event)">` +
          (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
          `<span class="cell-subj">${found.subject}</span>` +
          `<span class="cell-teacher">${found.cls}</span>` +
          `</div></td>`;
      } else {
        const absent = !isTeacherAvailable(tid, day);
        tbody +=
          `<td><div class="cell cell-empty"` +
          ` style="cursor:default${absent ? ';background:#fef2f2;border-color:#fca5a5;color:#fca5a5' : ''}">` +
          `${absent ? '🚫' : '—'}</div></td>`;
      }
    });

    tbody += '</tr>';
  });

  document.getElementById('teacher-table').innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  document.getElementById('teacher-stats-badge').textContent = `${filled} periods/week`;
  document.getElementById('teacher-stats').innerHTML =
    `<div class="stat"><div class="stat-val">${filled}</div><div class="stat-lbl">Periods / week</div></div>` +
    `<div class="stat"><div class="stat-val">${Object.keys(cc).length}</div><div class="stat-lbl">Sections</div></div>` +
    `<div class="stat"><div class="stat-val">${Object.keys(sc).length}</div><div class="stat-lbl">Subjects taught</div></div>` +
    `<div class="stat"><div class="stat-val">${Math.round(filled / 6)}</div><div class="stat-lbl">Avg / day</div></div>`;
}
