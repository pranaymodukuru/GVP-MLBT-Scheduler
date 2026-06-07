// ─────────────────────────────────────────────────────────────────────────────
// CLASS VIEW — grid, week (Outlook), and month (Notion) modes
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import {
  parseSection, getSubjects, isSatHalf, isUpper, isTeacherAvailable,
  isActivePeriod, getCombinedSections, getCombinableDiffTeacher, shortSec, getGamesVenue,
} from '../helpers.js';
import { getSelectorValue } from '../selects.js';
import { effectiveDay, weekdayOf } from '../calendar.js';
import {
  today, toIso, schoolWeekDates, isHoliday,
  viewModeToggleHtml, weekNavHtml, monthNavHtml,
  buildWeekTable, buildMonthGrid,
  initWeekDate, initMonthFromDate, shiftWeek, shiftMonth,
  SHORT_MONTHS,
} from './cal-shared.js';

// ── Per-view UI state ─────────────────────────────────────────────────────────
let _mode      = 'grid';          // 'grid' | 'week' | 'month'
let _weekDate  = null;            // ISO date anchor for week view
let _monthYear = null;            // year  for month view
let _monthMon  = null;            // month for month view (0-indexed)

function ensureDates() {
  if (!_weekDate) _weekDate = today();
  if (_monthYear === null) {
    const t = new Date();
    _monthYear = t.getFullYear();
    _monthMon  = t.getMonth();
  }
}

// ── Navigation (exposed on window.* via app.js) ───────────────────────────────
export function setClassViewMode(mode) { _mode = mode; renderClassView(); }
export function navigateClassWeek(delta) { ensureDates(); _weekDate = shiftWeek(_weekDate, delta); renderClassView(); }
export function navigateClassMonth(delta) { ensureDates(); ({ year: _monthYear, month: _monthMon } = shiftMonth({ year: _monthYear, month: _monthMon }, delta)); renderClassView(); }
export function navigateClassToday() { _weekDate = today(); const t = new Date(); _monthYear = t.getFullYear(); _monthMon = t.getMonth(); renderClassView(); }
export function navigateClassToDate(iso) { _weekDate = iso; _mode = 'week'; renderClassView(); }

// ── Main render ───────────────────────────────────────────────────────────────
export function renderClassView() {
  const secId = getSelectorValue('class-select');
  if (!secId) return;
  ensureDates();

  const subjects = getSubjects(secId);

  // Subject counts (for legend — always from template)
  const subjectCounts = {};
  const ttSection = state.timetable[secId] || {};
  Object.values(ttSection).forEach(dayObj =>
    Object.values(dayObj).forEach(cell => {
      if (cell?.subject) subjectCounts[cell.subject] = (subjectCounts[cell.subject] || 0) + 1;
    })
  );

  // Legend
  document.getElementById('class-legend').innerHTML =
    [...new Set(subjects)].map(s =>
      `<span class="legend-item">` +
      `<span class="legend-dot" style="background:${SUBJECT_COLORS[s] || '#eee'};border:1px solid ${SUBJECT_TEXT[s] || '#999'}60"></span>${s}` +
      (subjectCounts[s] ? ` <span class="legend-count">${subjectCounts[s]}</span>` : '') +
      `</span>`
    ).join('');

  // View mode toggle (injected into controls via id)
  const toggleEl = document.getElementById('class-view-toggle');
  if (toggleEl) toggleEl.innerHTML = viewModeToggleHtml('class', _mode);

  // Nav bar (week / month only)
  const navEl = document.getElementById('class-cal-nav');
  if (navEl) {
    navEl.style.display = _mode === 'grid' ? 'none' : '';
    if (_mode === 'week')  navEl.innerHTML = weekNavHtml('class', _weekDate);
    if (_mode === 'month') navEl.innerHTML = monthNavHtml('class', _monthYear, _monthMon);
  }

  const wrap = document.getElementById('class-timetable-wrap');
  if (_mode === 'grid')  renderGrid(secId, wrap, subjects, subjectCounts);
  if (_mode === 'week')  renderWeek(secId, wrap);
  if (_mode === 'month') renderMonth(secId, wrap);
}

// ── GRID mode (existing table, unchanged logic) ───────────────────────────────
function renderGrid(secId, wrap, subjects, subjectCounts) {
  const half       = isSatHalf(secId);
  const upper      = isUpper(secId);
  const activeDays = half ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat (½)'] : DAYS;
  let total = 0, filled = 0;

  const thead = `<tr><th>Period / Day</th>${activeDays.map(d => `<th>${d}</th>`).join('')}</tr>`;
  let tbody = '';

  PERIODS.forEach(per => {
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
      if (d.includes('½') && ['P7', 'P8'].includes(per.id)) {
        tbody += `<td><div style="background:#f9fafb;border-radius:7px;min-height:46px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#d1d5db">–</div></td>`;
        return;
      }
      total++;
      const cell = (state.timetable[secId] || {})[realDay]?.[per.id];
      if (cell?.subject) {
        filled++;
        tbody += `<td>${classCell(secId, realDay, per.id, cell)}</td>`;
      } else {
        tbody += `<td><div class="cell cell-empty" onclick="openEdit('${secId}','${realDay}','${per.id}')">+</div></td>`;
      }
    });
    tbody += '</tr>';
  });

  wrap.innerHTML = `<table id="class-table" class="timetable-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;

  const badge = document.getElementById('class-stats-badge');
  badge.textContent = `${filled} / ${total} periods filled`;
  badge.className   = filled === total ? 'badge badge-ok' : 'badge badge-warn';
}

// ── WEEK mode ─────────────────────────────────────────────────────────────────
function renderWeek(secId, wrap) {
  const upper = isUpper(secId);
  const half  = isSatHalf(secId);
  let total = 0, filled = 0;

  const table = buildWeekTable({
    viewType: 'class',
    weekDate: _weekDate,
    PERIODS,
    isUpperFn: () => upper,
    isActivePeriodFn: pid => isActivePeriod(secId, pid),
    renderCell(iso, per) {
      const weekday = weekdayOf(iso);
      // Saturday half-day — grey out P7/P8
      if (half && weekday === 'Sat' && ['P7', 'P8'].includes(per.id)) {
        return `<div class="cal-cell-inner cal-cell-sat-off">–</div>`;
      }
      total++;
      const dayData = effectiveDay(secId, iso) || {};
      const cell    = dayData[per.id];
      if (cell?.subject) {
        filled++;
        return `<div class="cal-cell-inner">${classCellInner(secId, weekday, per.id, cell, iso)}</div>`;
      }
      return `<div class="cal-cell-inner cal-cell-empty" onclick="openEdit('${secId}','${weekday}','${per.id}','${iso}')"><span class="cal-empty-plus">+</span></div>`;
    },
  });

  wrap.innerHTML = table;

  const badge = document.getElementById('class-stats-badge');
  badge.textContent = `${filled} / ${total} periods filled`;
  badge.className   = filled === total ? 'badge badge-ok' : 'badge badge-warn';
}

// ── MONTH mode ────────────────────────────────────────────────────────────────
function renderMonth(secId, wrap) {
  const grid = buildMonthGrid({
    viewType: 'class',
    year:  _monthYear,
    month: _monthMon,
    renderDayChips(iso) {
      const weekday = weekdayOf(iso);
      if (!weekday) return '';
      const dayData = effectiveDay(secId, iso) || {};
      const chips   = [];
      PERIODS.forEach(per => {
        if (per.isBreak || !isActivePeriod(secId, per.id)) return;
        const cell = dayData[per.id];
        if (cell?.subject) {
          const bg = SUBJECT_COLORS[cell.subject] || '#e5e7eb';
          const tc = SUBJECT_TEXT[cell.subject]   || '#374151';
          chips.push(`<div class="cal-month-chip" style="background:${bg};color:${tc}">${cell.subject}</div>`);
        }
      });
      if (!chips.length) return `<div class="cal-month-empty-day">No classes</div>`;
      // De-duplicate: show unique subjects only
      const unique = [...new Set(chips)];
      const visible = unique.slice(0, 4);
      const more    = unique.length - visible.length;
      return (
        `<div class="cal-month-chips">` +
        visible.join('') +
        (more > 0 ? `<div class="cal-month-more">+${more} more</div>` : '') +
        `</div>`
      );
    },
  });

  wrap.innerHTML = grid;
  document.getElementById('class-stats-badge').textContent = '';
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

/** Full <div class="cell …"> wrapper — used by grid mode */
function classCell(secId, day, pid, cell) {
  const t          = state.TEACHERS.find(x => x.id === cell.teacherId);
  const bg         = SUBJECT_COLORS[cell.subject] || '#f5f5f5';
  const tc         = SUBJECT_TEXT[cell.subject]   || '#333';
  const isConflict = state.conflictSet.has(`${secId}|${day}|${pid}`);
  const isAbsent   = cell.teacherId && !isTeacherAvailable(cell.teacherId, day, pid);
  const lockIcon   = cell.locked ? (pid === 'P1' ? '📌' : '🔒') : '';
  const combined      = getCombinedSections(secId, day, pid);
  const combinedDiff  = getCombinableDiffTeacher(secId, day, pid);
  const venue         = getGamesVenue(secId, day, pid);
  const cls = ['cell', cell.locked ? 'cell-locked' : '', isConflict ? 'cell-conflict' : '', isAbsent ? 'cell-absent' : ''].filter(Boolean).join(' ');

  return (
    `<div class="${cls}" style="background:${bg};color:${tc}"` +
    ` onclick="openEdit('${secId}','${day}','${pid}')"` +
    ` oncontextmenu="toggleCellLock('${secId}','${day}','${pid}',event)"` +
    ` title="${cell.locked ? 'Locked — right-click to unlock' : 'Right-click to lock'}">` +
    (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
    (isAbsent ? `<span class="absent-badge">&#9888;</span>` : '') +
    `<span class="cell-subj">${cell.subject}</span>` +
    `<span class="cell-teacher">${t ? t.name : '⚠️ Unassigned'}</span>` +
    (combined.length ? `<span class="cell-combined">+ ${combined.map(shortSec).join(', ')}</span>` : '') +
    (combinedDiff.length ? combinedDiff.map(({ secId: s, teacherName }) =>
      `<span class="cell-combined cell-combined-diff">+ ${shortSec(s)}, ${teacherName}</span>`).join('') : '') +
    (venue ? `<span class="venue-badge venue-${venue.toLowerCase()}">${venue}</span>` : '') +
    `</div>`
  );
}

/** Inner content only (no outer <div>) — used by week mode inside cal-cell-inner */
function classCellInner(secId, day, pid, cell, iso = null) {
  const t           = state.TEACHERS.find(x => x.id === cell.teacherId);
  const bg          = SUBJECT_COLORS[cell.subject] || '#f5f5f5';
  const tc          = SUBJECT_TEXT[cell.subject]   || '#333';
  const isConflict  = state.conflictSet.has(`${secId}|${day}|${pid}`);
  const isAbsent    = cell.teacherId && !isTeacherAvailable(cell.teacherId, day, pid);
  const lockIcon    = cell.locked ? (pid === 'P1' ? '📌' : '🔒') : '';
  const venue       = getGamesVenue(secId, day, pid);
  const hasOverride = iso && !!state.OVERRIDES?.[iso]?.[secId]?.[pid];
  const cls = ['cal-cell-block', cell.locked ? 'cell-locked' : '', isConflict ? 'cell-conflict' : '', isAbsent ? 'cell-absent' : ''].filter(Boolean).join(' ');

  return (
    `<div class="${cls}" style="background:${bg};color:${tc}"` +
    ` onclick="openEdit('${secId}','${day}','${pid}','${iso || ''}')"` +
    ` oncontextmenu="toggleCellLock('${secId}','${day}','${pid}',event)">` +
    (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
    (isAbsent ? `<span class="absent-badge">&#9888;</span>` : '') +
    (hasOverride ? `<span class="override-badge" title="One-time change for this date">1×</span>` : '') +
    `<span class="cell-subj">${cell.subject}</span>` +
    `<span class="cell-teacher">${t ? t.name : '⚠️ Unassigned'}</span>` +
    (venue ? `<span class="venue-badge venue-${venue.toLowerCase()}">${venue}</span>` : '') +
    `</div>`
  );
}
