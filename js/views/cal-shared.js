// ─────────────────────────────────────────────────────────────────────────────
// CAL-SHARED — reusable calendar UI building blocks
// Used by class-view, teacher-view, and subject-view.
// ─────────────────────────────────────────────────────────────────────────────

import { schoolWeekDates, toIso, today, isHoliday, holidaysOn, eventsOn } from '../calendar.js';

export { today, toIso, schoolWeekDates, isHoliday, holidaysOn };

// ── Constants ─────────────────────────────────────────────────────────────────

export const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                              'Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MONTHS  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
const SHORT_DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat'];

// ── View-mode toggle ──────────────────────────────────────────────────────────

/**
 * Returns HTML for the Grid / Week / Month segmented toggle.
 * @param {'class'|'teacher'|'subject'} viewType
 * @param {'grid'|'week'|'month'} currentMode
 */
export function viewModeToggleHtml(viewType, currentMode) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const modes = [
    { id: 'grid',  icon: 'ti-layout-list',   label: 'Grid'  },
    { id: 'week',  icon: 'ti-calendar-week',  label: 'Week'  },
    { id: 'month', icon: 'ti-calendar-month', label: 'Month' },
  ];
  return (
    `<div class="cal-mode-toggle">` +
    modes.map(m =>
      `<button class="cal-mode-btn${m.id === currentMode ? ' active' : ''}"` +
      ` onclick="set${cap(viewType)}ViewMode('${m.id}')" data-tooltip="${m.label} view" data-tooltip-below>` +
      `<i class="ti ${m.icon}"></i><span class="cal-mode-label"> ${m.label}</span></button>`
    ).join('') +
    `</div>`
  );
}

// ── Week navigation bar ───────────────────────────────────────────────────────

export function weekNavHtml(viewType, weekDate) {
  const cap   = s => s.charAt(0).toUpperCase() + s.slice(1);
  const dates = schoolWeekDates(weekDate);
  const label = fmtWeekLabel(dates[0], dates[5]);
  return (
    `<div class="cal-nav">` +
    `<div class="cal-nav-controls">` +
    `<button class="btn btn-sm" onclick="navigate${cap(viewType)}Week(-1)"><i class="ti ti-chevron-left"></i></button>` +
    `<button class="btn btn-sm" onclick="navigate${cap(viewType)}Today()">Today</button>` +
    `<button class="btn btn-sm" onclick="navigate${cap(viewType)}Week(1)"><i class="ti ti-chevron-right"></i></button>` +
    `</div>` +
    `<span class="cal-nav-label">${label}</span>` +
    `</div>`
  );
}

// ── Month navigation bar ──────────────────────────────────────────────────────

export function monthNavHtml(viewType, year, month) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    `<div class="cal-nav">` +
    `<div class="cal-nav-controls">` +
    `<button class="btn btn-sm" onclick="navigate${cap(viewType)}Month(-1)"><i class="ti ti-chevron-left"></i></button>` +
    `<button class="btn btn-sm" onclick="navigate${cap(viewType)}Today()">Today</button>` +
    `<button class="btn btn-sm" onclick="navigate${cap(viewType)}Month(1)"><i class="ti ti-chevron-right"></i></button>` +
    `</div>` +
    `<span class="cal-nav-label">${LONG_MONTHS[month]} ${year}</span>` +
    `</div>`
  );
}

// ── Week date helpers ─────────────────────────────────────────────────────────

/**
 * Returns today's date as ISO string, lazy-initialised.
 * Used as the default week/month anchor.
 */
export function initWeekDate(stored) {
  return stored || today();
}

export function initMonthFromDate(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  return { year: y, month: m - 1 };
}

/** Advance a week anchor by ±1 week. */
export function shiftWeek(isoDate, delta) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta * 7);
  return toIso(dt);
}

/** Advance a { year, month } by ±1 month. */
export function shiftMonth({ year, month }, delta) {
  let m = month + delta;
  let y = year;
  if (m < 0)  { y--; m = 11; }
  if (m > 11) { y++; m = 0;  }
  return { year: y, month: m };
}

// ── Month grid builder ────────────────────────────────────────────────────────

/**
 * Returns an array of weeks, each week = 6 day objects { iso, inMonth }.
 * Only Mon-Sat (school days). Sundays are skipped.
 */
export function monthWeeks(year, month) {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);

  // Find the Monday on/before the 1st
  const startDay = first.getDay(); // 0=Sun
  const offset   = startDay === 0 ? -6 : 1 - startDay;
  const mon = new Date(year, month, 1 + offset);

  const weeks = [];
  const cur   = new Date(mon);

  while (true) {
    const week = [];
    for (let i = 0; i < 6; i++) {         // Mon(0)…Sat(5)
      week.push({
        iso:     toIso(cur),
        inMonth: cur.getMonth() === month && cur.getFullYear() === year,
        dateNum: cur.getDate(),
      });
      cur.setDate(cur.getDate() + 1);
    }
    cur.setDate(cur.getDate() + 1);        // skip Sunday
    weeks.push(week);

    // Stop once we've covered the last day of the month
    if (cur > last) break;
    if (weeks.length >= 6) break;          // safety cap
  }
  return weeks;
}

// ── Day-header info ───────────────────────────────────────────────────────────

export function dayHeaderInfo(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    dayName: SHORT_DAYS[dt.getDay() - 1] || SHORT_DAYS[5], // Mon=1…Sat=6
    dateNum: d,
    monthStr: SHORT_MONTHS[m - 1],
    isToday: isoDate === today(),
  };
}

// ── Shared week-view table builder ────────────────────────────────────────────

/**
 * Builds the Outlook-style week table.
 *
 * @param {object} opts
 * @param {string}   opts.viewType      - 'class'|'teacher'|'subject'
 * @param {string}   opts.weekDate      - any ISO date in the week
 * @param {import('../state.js').state} opts.state
 * @param {Array}    opts.PERIODS
 * @param {Function} opts.renderCell    - (isoDate, period, isHoliday) → inner HTML string
 * @param {Function} opts.isActivePeriodFn - (periodId) → bool (false = skip row)
 * @param {Function} opts.isUpperFn     - () → bool  (show WRK row?)
 */
export function buildWeekTable({ viewType, weekDate, PERIODS, renderCell, isActivePeriodFn, isUpperFn }) {
  const weekDates = schoolWeekDates(weekDate);
  const todayIso  = today();

  // ── Header ────────────────────────────────────────────────────────────────
  let thead = `<tr><th class="cal-period-th"></th>`;
  weekDates.forEach(iso => {
    const { dayName, dateNum, monthStr, isToday } = dayHeaderInfo(iso);
    const holiday  = isHoliday(iso);
    const hols     = holidaysOn(iso);
    const cls      = ['cal-day-th', isToday ? 'cal-today-th' : '', holiday ? 'cal-holiday-th' : ''].filter(Boolean).join(' ');
    thead +=
      `<th class="${cls}">` +
      `<div class="cal-th-inner">` +
      `<span class="cal-day-name">${dayName}</span>` +
      `<span class="cal-date-num${isToday ? ' cal-today-num' : ''}">${dateNum}</span>` +
      `<span class="cal-month-str">${monthStr}</span>` +
      (holiday ? `<span class="cal-holiday-label">${hols.map(h => h.name).join(', ')}</span>` : '') +
      `</div></th>`;
  });
  thead += '</tr>';

  // ── Body ──────────────────────────────────────────────────────────────────
  let tbody = '';
  PERIODS.forEach(per => {
    if (per.isBreak) {
      if (per.id === 'WRK' && !isUpperFn()) return;
      tbody +=
        `<tr class="cal-break-row">` +
        `<td class="cal-break-label">${per.label}<div class="period-label">${per.time}</div></td>` +
        weekDates.map(() => `<td class="cal-break-cell"><div class="cell-break">${per.label}</div></td>`).join('') +
        `</tr>`;
      return;
    }

    if (!isActivePeriodFn(per.id)) return;

    tbody += `<tr class="cal-period-row"><td class="cal-period-label-td">${per.label}<div class="period-label">${per.time}</div></td>`;

    weekDates.forEach(iso => {
      const holiday = isHoliday(iso);
      if (holiday) {
        tbody += `<td class="cal-holiday-cell"><div class="cal-holiday-cell-inner">—</div></td>`;
        return;
      }
      tbody += `<td class="cal-cell-td">${renderCell(iso, per)}</td>`;
    });

    tbody += '</tr>';
  });

  return `<table class="cal-week-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

// ── Shared month-view grid builder ────────────────────────────────────────────

/**
 * Builds the Notion-style month grid.
 *
 * @param {object} opts
 * @param {string}   opts.viewType
 * @param {number}   opts.year
 * @param {number}   opts.month        - 0-indexed
 * @param {Function} opts.renderDayChips - (isoDate) → HTML string of chips
 */
export function buildMonthGrid({ viewType, year, month, renderDayChips }) {
  const cap     = s => s.charAt(0).toUpperCase() + s.slice(1);
  const todayIso = today();
  const weeks   = monthWeeks(year, month);

  // Day-name header row
  const headerRow =
    `<div class="cal-month-header-row">` +
    SHORT_DAYS.map(d => `<div class="cal-month-day-name">${d}</div>`).join('') +
    `</div>`;

  // Week rows
  const weekRows = weeks.map(week => {
    const cells = week.map(({ iso, inMonth, dateNum }) => {
      const hday    = isHoliday(iso);
      const hols    = hday ? holidaysOn(iso) : [];
      const isToday = iso === todayIso;
      const cls     = [
        'cal-month-cell',
        !inMonth    ? 'cal-month-cell-out'     : '',
        hday        ? 'cal-month-cell-holiday' : '',
        isToday     ? 'cal-month-cell-today'   : '',
      ].filter(Boolean).join(' ');

      return (
        `<div class="${cls}" onclick="navigate${cap(viewType)}ToDate('${iso}')">` +
        `<div class="cal-month-date-row">` +
        `<span class="cal-month-date-num${isToday ? ' cal-today-badge' : ''}">${dateNum}</span>` +
        (hday ? `<span class="cal-month-holiday-chip">${hols[0].name}</span>` : '') +
        `</div>` +
        (inMonth && !hday ? renderDayChips(iso) : '') +
        `</div>`
      );
    }).join('');
    return `<div class="cal-month-week-row">${cells}</div>`;
  }).join('');

  return `<div class="cal-month-grid">${headerRow}${weekRows}</div>`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtWeekLabel(startIso, endIso) {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [, em, ed]   = endIso.split('-').map(Number);
  if (sm === em) return `${sd}–${ed} ${SHORT_MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${SHORT_MONTHS[sm - 1]} – ${ed} ${SHORT_MONTHS[em - 1]} ${sy}`;
}
