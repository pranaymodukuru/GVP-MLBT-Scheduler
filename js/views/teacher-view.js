// ─────────────────────────────────────────────────────────────────────────────
// TEACHER VIEW — renders the per-teacher timetable grid
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import { allSectionIds, isTeacherAvailable, isActivePeriod, shortSec } from '../helpers.js';
import { getSelectorValue } from '../selects.js';

export function renderTeacherView() {
  const tid = getSelectorValue('teacher-select');
  if (!tid) return;

  const secs = allSectionIds();
  let filled = 0;
  const cc  = {}; // classes count
  const sc  = {}; // subjects count
  const csc = {}; // per-class subject counts: { sec: { subject: count } }

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
      // Collect all sections where this teacher is assigned this slot.
      // When multiple sections match, only treat them as combined (not conflict)
      // if they share the same subject — conflicts are flagged via conflictSet.
      const allMatches = [];
      secs.forEach(s => {
        if (!isActivePeriod(s, per.id)) return;
        const c = (state.timetable[s] || {})[day]?.[per.id];
        if (c?.teacherId === tid) allMatches.push({ cls: s, subject: c.subject, locked: c.locked });
      });
      // For display, group by subject so combined classes (same subject) stay together;
      // if there's a conflict (different subjects), show only the primary occurrence.
      const primarySubject = allMatches[0]?.subject;
      const matches = allMatches.length > 1
        ? allMatches.filter(f => f.subject === primarySubject)
        : allMatches;

      if (matches.length > 0) {
        filled++;
        matches.forEach(f => {
          cc[f.cls]     = (cc[f.cls]     || 0) + 1;
          sc[f.subject] = (sc[f.subject] || 0) + 1;
          if (!csc[f.cls]) csc[f.cls] = {};
          csc[f.cls][f.subject] = (csc[f.cls][f.subject] || 0) + 1;
        });

        const primary    = matches[0];
        const bg         = SUBJECT_COLORS[primary.subject] || '#f5f5f5';
        const tc         = SUBJECT_TEXT[primary.subject]   || '#333';
        const isConflict = matches.some(f => state.conflictSet.has(`${f.cls}|${day}|${per.id}`));
        const lockIcon   = primary.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';
        const clsLabel   = matches.map(f => shortSec(f.cls)).join(' + ');

        tbody +=
          `<td><div class="cell${primary.locked ? ' cell-locked' : ''}${isConflict ? ' cell-conflict' : ''}"` +
          ` style="background:${bg};color:${tc}"` +
          ` onclick="openEdit('${primary.cls}','${day}','${per.id}')"` +
          ` oncontextmenu="toggleCellLock('${primary.cls}','${day}','${per.id}',event)">` +
          (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
          `<span class="cell-subj">${primary.subject}</span>` +
          `<span class="cell-teacher">${clsLabel}</span>` +
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

  document.getElementById('teacher-legend').innerHTML =
    Object.entries(cc)
      .sort((a, b) => b[1] - a[1])
      .map(([sec, count]) => {
        const subjItems = Object.entries(csc[sec] || {})
          .sort((a, b) => b[1] - a[1])
          .map(([subj, cnt]) =>
            `<span class="legend-item">` +
            `<span class="legend-dot" style="background:${SUBJECT_COLORS[subj] || '#eee'};border:1px solid ${SUBJECT_TEXT[subj] || '#999'}60"></span>${subj}` +
            ` <span class="legend-count">${cnt}</span></span>`
          ).join('');
        return (
          `<span class="legend-class-block">` +
          `<span class="legend-item">` +
          `<span class="legend-dot" style="background:#e5e7eb;border:1px solid #9ca3af60"></span><strong>${sec}</strong>` +
          ` <span class="legend-count">${count}</span></span>` +
          subjItems +
          `</span>`
        );
      }).join('');
}
