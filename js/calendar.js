// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR HELPERS
//
// This module is the bridge between the weekly template (state.timetable) and
// real calendar dates.  It is intentionally read-only — it never mutates state.
//
// Key concepts:
//   weekdayOf(isoDate)      → 'Mon' | 'Tue' | … | 'Sat'
//   isHoliday(isoDate)      → bool
//   effectiveDay(sectionId, isoDate)
//     → HOLIDAY sentinel, or the template periods with any OVERRIDES patched in
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { DAYS } from '../config/school-config.js';

// Sentinel returned by effectiveDay() for holidays.
export const HOLIDAY = Object.freeze({ holiday: true });

// JS Date.getDay() returns 0=Sun … 6=Sat.
// Map to the day strings used by the template ('Mon'…'Sat').
const JS_DAY_TO_TEMPLATE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Returns the weekday name ('Mon'–'Sat') for a given ISO date string.
 * If the weekday isn't in DAYS (e.g. Sunday) returns null.
 *
 * @param {string} isoDate  e.g. '2026-06-15'
 * @returns {string|null}
 */
export function weekdayOf(isoDate) {
  // Parse as local date to avoid UTC-offset surprises.
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const name = JS_DAY_TO_TEMPLATE[date.getDay()];
  return DAYS.includes(name) ? name : null;
}

/**
 * Returns true if the given ISO date is a declared holiday.
 *
 * @param {string} isoDate  e.g. '2026-06-15'
 * @returns {boolean}
 */
export function isHoliday(isoDate) {
  return state.HOLIDAYS.some(h => {
    if (h.endDate) {
      return isoDate >= h.date && isoDate <= h.endDate;
    }
    return h.date === isoDate;
  });
}

/**
 * Returns the holiday record(s) that cover a given date, or [].
 *
 * @param {string} isoDate
 * @returns {Array}
 */
export function holidaysOn(isoDate) {
  return state.HOLIDAYS.filter(h =>
    h.endDate ? (isoDate >= h.date && isoDate <= h.endDate) : h.date === isoDate
  );
}

/**
 * Returns the events (from state.EVENTS) that fall on a given date.
 *
 * @param {string} isoDate
 * @returns {Array}
 */
export function eventsOn(isoDate) {
  return state.EVENTS.filter(ev =>
    ev.endDate ? (isoDate >= ev.date && isoDate <= ev.endDate) : ev.date === isoDate
  );
}

/**
 * The core projection function.
 *
 * For a given section and real calendar date:
 *  1. If the date is a holiday → returns HOLIDAY sentinel.
 *  2. If the weekday isn't in the template (e.g. Sunday) → returns null.
 *  3. Otherwise returns the template day with any per-date OVERRIDES patched in.
 *
 * The return value for a normal day is an object keyed by period ID:
 *   { P1: { subject, teacherId, locked?, substituteId?, cancelled?, note? }, … }
 *
 * Callers must never mutate the returned object (it shares references with state).
 *
 * @param {string} sectionId   e.g. '10-A'
 * @param {string} isoDate     e.g. '2026-06-15'
 * @returns {typeof HOLIDAY | Object | null}
 */
export function effectiveDay(sectionId, isoDate) {
  if (isHoliday(isoDate)) return HOLIDAY;

  const weekday = weekdayOf(isoDate);
  if (!weekday) return null; // Sunday or other non-school day

  // Base: the weekly template for this section + weekday
  const base = (state.timetable[sectionId] || {})[weekday] || {};

  // Overrides: date-scoped mutations (substitutions, cancellations, etc.)
  const overridesForDate    = state.OVERRIDES[isoDate]    || {};
  const overridesForSection = overridesForDate[sectionId] || {};

  if (Object.keys(overridesForSection).length === 0) {
    // Fast path: no overrides — return base directly (read-only is fine)
    return base;
  }

  // Merge: start with a shallow copy of the base, then patch each override
  const result = { ...base };
  for (const [period, patch] of Object.entries(overridesForSection)) {
    result[period] = { ...(base[period] || {}), ...patch };
  }
  return result;
}

/**
 * Returns the ISO date string for the Monday of the week that contains isoDate.
 *
 * @param {string} isoDate
 * @returns {string}
 */
export function weekStart(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day  = date.getDay(); // 0=Sun
  // Shift to Monday: if Sunday (0) go back 6 days, else go back (day-1) days
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toIso(date);
}

/**
 * Returns an array of ISO date strings for the 6-day school week (Mon–Sat)
 * that contains isoDate.
 *
 * @param {string} isoDate
 * @returns {string[]}  length 6
 */
export function schoolWeekDates(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  const day = mon.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  mon.setDate(mon.getDate() + diff);
  return Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    return toIso(dt);
  });
}

/**
 * Format a JS Date as 'YYYY-MM-DD'.
 * @param {Date} date
 * @returns {string}
 */
export function toIso(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Today's date as an ISO string.
 * @returns {string}
 */
export function today() {
  return toIso(new Date());
}
