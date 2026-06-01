// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT VIEW — grid, week (Outlook), and month (Notion) modes
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import { allSectionIds, getSubjects, isActivePeriod } from '../helpers.js';
import { getSelectorValue } from '../selects.js';
import { weekdayOf } from '../calendar.js';
import {
  today, schoolWeekDates, isHoliday,
  viewModeToggleHtml, weekNavHtml, monthNavHtml,
  buildWeekTable, buildMonthGrid,
  shiftWeek, shiftMonth,
} from './cal-shared.js';

// ── Per-view UI state ─────────────────────────────────────────────────────────
let _mode      = 'grid';
let _weekDate  = null;
let _monthYear = null;
let _monthMon  = null;

function ensureDates() {
  if (!_weekDate) _weekDate = today();
  if (_monthYear === null) { const t = new Date(); _monthYear = t.getFullYear(); _monthMon = t.getMonth(); }
}

// ── Navigation ────────────────────────────────────────────────────────────────
export function setSubjectViewMode(mode) { _mode = mode; renderSubjectView(); }
export function navigateSubjectWeek(delta) { ensureDates(); _weekDate = shiftWeek(_weekDate, delta); renderSubjectView(); }
export function navigateSubjectMonth(delta) { ensureDates(); ({ year: _monthYear, month: _monthMon } = shiftMonth({ year: _monthYear, month: _monthMon }, delta)); renderSubjectView(); }
export function navigateSubjectToday() { _weekDate = today(); const t = new Date(); _monthYear = t.getFullYear(); _monthMon = t.getMonth(); renderSubjectView(); }
export function navigateSubjectToDate(iso) { _weekDate = iso; _mode = 'week'; renderSubjectView(); }

// ── Main render ───────────────────────────────────────────────────────────────
export function renderSubjectView() {
  const subject = getSelectorValue('subject-select');
  if (!subject) return;
  ensureDates();

  const secs = allSectionIds().filter(secId => getSubjects(secId).includes(subject));
  const bg   = SUBJECT_COLORS[subject] || '#f0f0f0';
  const tc   = SUBJECT_TEXT[subject]   || '#333';

  // Inject toggle
  const toggleEl = document.getElementById('subject-view-toggle');
  if (toggleEl) toggleEl.innerHTML = viewModeToggleHtml('subject', _mode);

  // Nav bar
  const navEl = document.getElementById('subject-cal-nav');
  if (navEl) {
    navEl.style.display = _mode === 'grid' ? 'none' : '';
    if (_mode === 'week')  navEl.innerHTML = weekNavHtml('subject', _weekDate);
    if (_mode === 'month') navEl.innerHTML = monthNavHtml('subject', _monthYear, _monthMon);
  }

  const wrap = document.getElementById('subject-timetable-wrap');

  if (_mode === 'week')  { renderSubjectWeek(subject, secs, bg, tc, wrap); return; }
  if (_mode === 'month') { renderSubjectMonth(subject, secs, bg, tc, wrap); return; }

  // ── GRID mode ─────────────────────────────────────────────────────────────
  let totalPeriods = 0;
  const teacherSet = new Set();
  const classTeachers = {};

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
          if (cell.teacherId) {
            teacherSet.add(cell.teacherId);
            if (!classTeachers[secId]) classTeachers[secId] = {};
            if (!classTeachers[secId][cell.teacherId]) {
              const t = state.TEACHERS.find(t => t.id === cell.teacherId);
              classTeachers[secId][cell.teacherId] = { name: t ? t.name : cell.teacherId, count: 0 };
            }
            classTeachers[secId][cell.teacherId].count++;
          }
        }
      });

      if (hits.length) {
        const inner = hits.map(h => {
          const tName    = h.teacher ? h.teacher.name : '⚠️';
          const lockIcon = h.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';
          return (
            `<div class="cell${h.locked ? ' cell-locked' : ''}" style="background:${bg};color:${tc};margin-bottom:3px"` +
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
    tbody = `<tr><td colspan="${DAYS.length + 1}" class="empty-state">No sections have this subject assigned</td></tr>`;
  }

  wrap.innerHTML = `<table id="subject-table" class="timetable-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;

  renderSubjectMeta(subject, secs, totalPeriods, teacherSet, classTeachers, bg, tc);
}

// ── WEEK mode ─────────────────────────────────────────────────────────────────
function renderSubjectWeek(subject, secs, bg, tc, wrap) {
  const table = buildWeekTable({
    viewType: 'subject',
    weekDate: _weekDate,
    PERIODS,
    isUpperFn:        () => false,
    isActivePeriodFn: () => true,
    renderCell(iso, per) {
      const weekday = weekdayOf(iso);
      const hits = [];
      secs.forEach(secId => {
        const cell = (state.timetable[secId] || {})[weekday]?.[per.id];
        if (cell?.subject === subject) {
          const teacher = state.TEACHERS.find(t => t.id === cell.teacherId);
          hits.push({ secId, teacher, locked: cell.locked });
        }
      });

      if (!hits.length) return `<div class="cal-cell-inner cal-cell-empty" style="cursor:default">—</div>`;

      return (
        `<div class="cal-cell-inner" style="display:flex;flex-direction:column;gap:3px;padding:3px">` +
        hits.map(h => {
          const lockIcon = h.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';
          const tName    = h.teacher ? h.teacher.name : '⚠️';
          return (
            `<div class="cal-cell-block" style="background:${bg};color:${tc}"` +
            ` onclick="openEdit('${h.secId}','${weekday}','${per.id}')"` +
            ` oncontextmenu="toggleCellLock('${h.secId}','${weekday}','${per.id}',event)">` +
            (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
            `<span class="cell-subj">${h.secId}</span>` +
            `<span class="cell-teacher">${tName}</span>` +
            `</div>`
          );
        }).join('') +
        `</div>`
      );
    },
  });
  wrap.innerHTML = table;
}

// ── MONTH mode ────────────────────────────────────────────────────────────────
function renderSubjectMonth(subject, secs, bg, tc, wrap) {
  const grid = buildMonthGrid({
    viewType: 'subject',
    year:  _monthYear,
    month: _monthMon,
    renderDayChips(iso) {
      const weekday = weekdayOf(iso);
      if (!weekday) return '';
      const chips = [];
      PERIODS.forEach(per => {
        if (per.isBreak) return;
        secs.forEach(secId => {
          const cell = (state.timetable[secId] || {})[weekday]?.[per.id];
          if (cell?.subject === subject) {
            chips.push(secId);
          }
        });
      });
      if (!chips.length) return `<div class="cal-month-empty-day">Not scheduled</div>`;
      const unique  = [...new Set(chips)];
      const visible = unique.slice(0, 4);
      const more    = unique.length - visible.length;
      return (
        `<div class="cal-month-chips">` +
        visible.map(s => `<div class="cal-month-chip" style="background:${bg};color:${tc}">${s}</div>`).join('') +
        (more > 0 ? `<div class="cal-month-more">+${more} more</div>` : '') +
        `</div>`
      );
    },
  });
  wrap.innerHTML = grid;
}

// ── Stats / legend (shared across modes) ─────────────────────────────────────
function renderSubjectMeta(subject, secs, totalPeriods, teacherSet, classTeachers, bg, tc) {
  document.getElementById('subject-stats-badge').textContent = `${totalPeriods} periods/week`;
  document.getElementById('subject-stats').innerHTML =
    `<div class="stat"><div class="stat-val">${totalPeriods}</div><div class="stat-lbl">Periods / week</div></div>` +
    `<div class="stat"><div class="stat-val">${secs.length}</div><div class="stat-lbl">Sections</div></div>` +
    `<div class="stat"><div class="stat-val">${teacherSet.size}</div><div class="stat-lbl">Teachers</div></div>` +
    `<div class="stat"><div class="stat-val">${secs.length ? (totalPeriods / secs.length).toFixed(1) : 0}</div><div class="stat-lbl">Avg / section</div></div>`;

  document.getElementById('subject-legend').innerHTML =
    Object.entries(classTeachers)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sec, teachers]) => {
        const total = Object.values(teachers).reduce((s, t) => s + t.count, 0);
        const teacherItems = Object.values(teachers).sort((a, b) => b.count - a.count)
          .map(t =>
            `<span class="legend-item">` +
            `<span class="legend-dot" style="background:${bg};border:1px solid ${tc}60"></span>${t.name}` +
            ` <span class="legend-count">${t.count}</span></span>`
          ).join('');
        return (
          `<span class="legend-class-block">` +
          `<span class="legend-item">` +
          `<span class="legend-dot" style="background:#e5e7eb;border:1px solid #9ca3af60"></span><strong>${sec}</strong>` +
          ` <span class="legend-count">${total}</span></span>` +
          teacherItems +
          `</span>`
        );
      }).join('');
}
