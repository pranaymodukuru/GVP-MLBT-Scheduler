// ─────────────────────────────────────────────────────────────────────────────
// PDF EXPORT — opens a print-ready window for all class or teacher schedules
// Each schedule occupies one A4 landscape page; browser print dialog handles
// the save-as-PDF step (Ctrl+P → Save as PDF / Destination).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../config/school-config.js';
import { allSectionIds, isSatHalf, isUpper, isActivePeriod, shortSec } from './helpers.js';
import { getSelectorValue } from './selects.js';

// ─── Print CSS ────────────────────────────────────────────────────────────────

const PRINT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #1a1a2e; }

@media print {
  @page { size: A4 landscape; margin: 8mm 10mm; }
}

.page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  page-break-after: always;
  break-after: page;
}
.page:last-child { page-break-after: avoid; break-after: avoid; }

.page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 2px solid #1a1a2e;
  flex-shrink: 0;
}
.page-header .school { font-size: 11px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
.page-header .title  { font-size: 20px; font-weight: 700; color: #1a1a2e; }
.page-header .meta   { font-size: 11px; color: #9ca3af; margin-left: auto; }

table { flex: 1; min-height: 0; width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
th {
  padding: 6px 8px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  color: #6b7280;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
th:first-child { text-align: left; width: 80px; }
td {
  padding: 3px 4px;
  border: 1px solid #e5e7eb;
  vertical-align: top;
}
td:first-child {
  font-size: 10px;
  font-weight: 600;
  color: #6b7280;
  background: #f9fafb;
  padding: 6px 8px;
  white-space: nowrap;
  vertical-align: middle;
  width: 80px;
}
.per-time { font-size: 8px; color: #9ca3af; font-weight: 400; margin-top: 2px; }

.subj-cell {
  border-radius: 4px;
  padding: 5px 7px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.s-name { font-weight: 700; font-size: 11px; line-height: 1.3; }
.t-name { font-size: 9.5px; opacity: 0.78; line-height: 1.3; }

.break-cell {
  background: #f3f4f6;
  color: #9ca3af;
  font-size: 9px;
  text-align: center;
  border-radius: 3px;
  padding: 4px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.empty-cell {
  height: 100%;
  color: #d1d5db;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exportDateStamp() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Class page builder ───────────────────────────────────────────────────────

function buildClassPage(secId) {
  const half       = isSatHalf(secId);
  const upper      = isUpper(secId);
  const activeDays = half ? [...DAYS.slice(0, 5), 'Sat (½)'] : DAYS;
  const tt         = state.timetable[secId] || {};

  const thead = `<tr>
    <th>Period</th>
    ${activeDays.map(d => `<th>${d}</th>`).join('')}
  </tr>`;

  let tbody = '';
  PERIODS.forEach(per => {
    if (per.isBreak) {
      if (per.id === 'WRK' && !upper) return;
      tbody += `<tr>
        <td><span style="font-size:8px">${per.label}</span><div class="per-time">${per.time}</div></td>
        ${activeDays.map(() => `<td><div class="break-cell">${per.label}</div></td>`).join('')}
      </tr>`;
      return;
    }
    if (!isActivePeriod(secId, per.id)) return;

    tbody += `<tr><td>${per.label}<div class="per-time">${per.time}</div></td>`;
    activeDays.forEach((d, di) => {
      const realDay = DAYS[di] !== undefined ? DAYS[di] : DAYS[5];
      if (d.includes('½') && (per.id === 'P7' || per.id === 'P8')) {
        tbody += `<td><div class="empty-cell">—</div></td>`;
        return;
      }
      const cell = tt[realDay]?.[per.id];
      if (cell?.subject) {
        const teacher = state.TEACHERS.find(x => x.id === cell.teacherId);
        const bg = SUBJECT_COLORS[cell.subject] || '#f5f5f5';
        const tc = SUBJECT_TEXT[cell.subject]   || '#333';
        tbody += `<td><div class="subj-cell" style="background:${bg};color:${tc}">` +
          `<span class="s-name">${cell.subject}</span>` +
          `<span class="t-name">${teacher ? teacher.name : '—'}</span>` +
          `</div></td>`;
      } else {
        tbody += `<td><div class="empty-cell">—</div></td>`;
      }
    });
    tbody += '</tr>';
  });

  return `<div class="page">
    <div class="page-header">
      <span class="school">Class Timetable</span>
      <span class="title">${secId}</span>
      <span class="meta">Exported: ${exportDateStamp()}</span>
    </div>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
  </div>`;
}

// ─── Teacher page builder ─────────────────────────────────────────────────────

function buildTeacherPage(teacher) {
  const secs = allSectionIds();
  let filled = 0;

  const thead = `<tr>
    <th>Period</th>
    ${DAYS.map(d => `<th>${d}</th>`).join('')}
  </tr>`;

  let tbody = '';
  PERIODS.forEach(per => {
    if (per.isBreak) {
      tbody += `<tr>
        <td><span style="font-size:8px">${per.label}</span><div class="per-time">${per.time}</div></td>
        ${DAYS.map(() => `<td><div class="break-cell">${per.label}</div></td>`).join('')}
      </tr>`;
      return;
    }

    tbody += `<tr><td>${per.label}<div class="per-time">${per.time}</div></td>`;
    DAYS.forEach(day => {
      const matches = [];
      secs.forEach(s => {
        if (!isActivePeriod(s, per.id)) return;
        const c = (state.timetable[s] || {})[day]?.[per.id];
        if (c?.teacherId === teacher.id) matches.push({ cls: s, subject: c.subject });
      });

      if (matches.length > 0) {
        filled++;
        const primarySubject = matches[0].subject;
        const grouped = matches.filter(m => m.subject === primarySubject);
        const bg = SUBJECT_COLORS[primarySubject] || '#f5f5f5';
        const tc = SUBJECT_TEXT[primarySubject]   || '#333';
        const clsLabel = grouped.map(m => shortSec(m.cls)).join(' + ');
        tbody += `<td><div class="subj-cell" style="background:${bg};color:${tc}">` +
          `<span class="s-name">${primarySubject}</span>` +
          `<span class="t-name">${clsLabel}</span>` +
          `</div></td>`;
      } else {
        const duty = state.DUTY_ASSIGNMENTS.find(
          a => a.teacherId === teacher.id && a.day === day && a.period === per.id
        );
        if (duty) {
          tbody += `<td><div class="subj-cell" style="background:#fef9c3;color:#713f12">` +
            `<span class="s-name">${duty.type}</span>` +
            `<span class="t-name">Duty</span>` +
            `</div></td>`;
        } else {
          tbody += `<td><div class="empty-cell"></div></td>`;
        }
      }
    });
    tbody += '</tr>';
  });

  return `<div class="page">
    <div class="page-header">
      <span class="school">Teacher Timetable</span>
      <span class="title">${teacher.name}</span>
      <span class="meta">${filled} periods / week · Exported: ${exportDateStamp()}</span>
    </div>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
  </div>`;
}

// ─── Public export functions ──────────────────────────────────────────────────

function openPrintWindow(title, pages) {
  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this page.'); return; }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>${pages}</body>
</html>`);
  win.document.close();
  // Give the browser a tick to render before showing the print dialog
  setTimeout(() => { win.focus(); win.print(); }, 300);
}

export function exportClassPDFs() {
  const pages = allSectionIds().map(buildClassPage).join('');
  openPrintWindow(`Class Timetables — ${exportDateStamp()}`, pages);
}

export function exportTeacherPDFs() {
  const pages = state.TEACHERS.map(buildTeacherPage).join('');
  openPrintWindow(`Teacher Timetables — ${exportDateStamp()}`, pages);
}

export function exportCurrentClassPDF() {
  const secId = getSelectorValue('class-select');
  if (!secId) return;
  openPrintWindow(`Timetable — ${secId} — ${exportDateStamp()}`, buildClassPage(secId));
}

export function exportCurrentTeacherPDF() {
  const tid     = getSelectorValue('teacher-select');
  const teacher = state.TEACHERS.find(t => t.id === tid);
  if (!teacher) return;
  openPrintWindow(`Timetable — ${teacher.name} — ${exportDateStamp()}`, buildTeacherPage(teacher));
}
