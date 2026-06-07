// ─────────────────────────────────────────────────────────────────────────────
// CELL EDIT MODAL — left-click on any timetable cell
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { getSubjects, isTeacherAvailable, getCombinedSections, shortSec, getGamesVenue } from '../helpers.js';
import { SUBJECTS_CONFIG } from '../../config/school-config.js';
import { saveState, saveData } from '../persistence.js';
import { checkConflicts } from '../scheduler.js';
import { showToast } from '../toast.js';
import { effectiveDay } from '../calendar.js';
import { renderClassView } from '../views/class-view.js';
import { renderTeacherView } from '../views/teacher-view.js';
import { renderDashboard } from '../views/dashboard.js';

// ── Attach backdrop-click listener on module load ─────────────────────────────
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open the cell edit modal.
 * @param {string} secId
 * @param {string} day    weekday name e.g. 'Mon'
 * @param {string} period period id e.g. 'P3'
 * @param {string|null} isoDate  specific calendar date ('2026-06-02') or null for grid/template edit
 */
export function openEdit(secId, day, period, isoDate = null) {
  // Default scope: when editing from a specific date, default to 'once'
  const scope = isoDate ? 'once' : 'all';
  state.modalState = { secId, day, period, isoDate, scope };

  // Resolve the cell to display: use override if one exists, else template
  const cell = _resolveCell(secId, day, period, isoDate, scope);

  document.getElementById('modal-title').textContent = isoDate
    ? `Edit: ${secId} · ${day} · ${period} · ${_fmtDate(isoDate)}`
    : `Edit: ${secId} · ${day} · ${period}`;

  const combined = getCombinedSections(secId, day, period);
  const noteEl   = document.getElementById('modal-combined-note');
  if (noteEl) {
    noteEl.textContent = combined.length
      ? `Combined class: ${[secId, ...combined].map(shortSec).join(' + ')}`
      : '';
    noteEl.style.display = combined.length ? '' : 'none';
  }

  // Scope toggle — shown only when a specific date is provided
  const scopeRow = document.getElementById('modal-scope-row');
  if (scopeRow) scopeRow.style.display = isoDate ? '' : 'none';
  _applyScopeButtons(scope);

  // Lock row — only meaningful for template (recurring) edits
  const lockRow = document.getElementById('modal-lock-row');
  if (lockRow) lockRow.style.display = (isoDate && scope === 'once') ? 'none' : '';

  _populateFields(secId, day, period, cell);

  document.getElementById('modal').classList.add('open');
}

export function setModalScope(scope) {
  state.modalState.scope = scope;
  _applyScopeButtons(scope);

  // Lock row only relevant for recurring edits
  const lockRow = document.getElementById('modal-lock-row');
  if (lockRow) lockRow.style.display = scope === 'once' ? 'none' : '';

  // Re-populate from the appropriate source so user sees what they're editing
  const { secId, day, period, isoDate } = state.modalState;
  const cell = _resolveCell(secId, day, period, isoDate, scope);
  _populateFields(secId, day, period, cell);
}

export function setModalVenue(venue) {
  document.getElementById('modal-venue-indoor') .classList.toggle('active', venue === 'Indoor');
  document.getElementById('modal-venue-outdoor').classList.toggle('active', venue === 'Outdoor');
}

export function fillTeacherDropdown(subject, selTid) {
  const { secId, day, period } = state.modalState;
  const teachers = state.TEACHERS.filter(t => t.subjects.includes(subject));

  let html = `<option value="">-- Unassigned --</option>`;

  if (day && period) {
    // Teachers busy in another section this slot → tid → { cls, subject }
    const busyMap = new Map();
    Object.entries(state.timetable).forEach(([sid, days]) => {
      if (sid === secId) return;
      const c = days[day]?.[period];
      if (c?.teacherId) busyMap.set(c.teacherId, { cls: sid, subject: c.subject });
    });

    // Teachers with a duty assignment this slot → tid → duty type string
    const dutyMap = new Map(
      (state.DUTY_ASSIGNMENTS || [])
        .filter(a => a.day === day && a.period === period && a.teacherId)
        .map(a => [a.teacherId, a.type])
    );

    const grpAvailable     = [];
    const grpTeachingOther = [];
    const grpOnDuty        = [];
    const grpUnavailable   = [];

    teachers.forEach(t => {
      if (!isTeacherAvailable(t.id, day, period)) grpUnavailable.push(t);
      else if (dutyMap.has(t.id))                 grpOnDuty.push(t);
      else if (busyMap.has(t.id))                 grpTeachingOther.push(t);
      else                                         grpAvailable.push(t);
    });

    const opt = (t, prefix = '', detail = '') =>
      `<option value="${t.id}" ${t.id === selTid ? 'selected' : ''}>${prefix}${t.name}${detail ? ` (${detail})` : ''}</option>`;

    if (grpAvailable.length)
      html += `<optgroup label="── Available ──">${grpAvailable.map(t => opt(t)).join('')}</optgroup>`;

    if (grpTeachingOther.length)
      html += `<optgroup label="── Teaching other class ──">${grpTeachingOther.map(t => {
        const info = busyMap.get(t.id);
        return opt(t, '↔ ', info ? `${shortSec(info.cls)} · ${info.subject}` : '');
      }).join('')}</optgroup>`;

    if (grpOnDuty.length)
      html += `<optgroup label="── On duty ──">${grpOnDuty.map(t =>
        opt(t, '⊕ ', dutyMap.get(t.id) || '')
      ).join('')}</optgroup>`;

    if (grpUnavailable.length)
      html += `<optgroup label="── Unavailable this slot ──">${grpUnavailable.map(t => opt(t, '⚠ ')).join('')}</optgroup>`;
  } else {
    html += teachers.map(t =>
      `<option value="${t.id}" ${t.id === selTid ? 'selected' : ''}>${t.name}</option>`
    ).join('');
  }

  const sel = document.getElementById('modal-teacher');
  sel.innerHTML = html;

  const selectedText = sel.options[sel.selectedIndex]?.text || '';
  sel.style.color = selectedText.startsWith('⚠') ? '#dc2626'
                  : selectedText.startsWith('↔') || selectedText.startsWith('⊕') ? '#d97706'
                  : '';
}

export function closeModal() {
  document.getElementById('modal').classList.remove('open');
  state.modalState = {};
}

export function saveCell() {
  const { secId, day, period, isoDate, scope } = state.modalState;
  const subj   = document.getElementById('modal-subject').value;
  const tid    = document.getElementById('modal-teacher').value;
  const locked = document.getElementById('modal-lock').checked;

  if (isoDate && scope === 'once') {
    // Write a date-specific override — does NOT affect any other week
    if (!state.OVERRIDES[isoDate])        state.OVERRIDES[isoDate]        = {};
    if (!state.OVERRIDES[isoDate][secId]) state.OVERRIDES[isoDate][secId] = {};
    state.OVERRIDES[isoDate][secId][period] = { subject: subj, teacherId: tid || null };
    saveData('overrides', state.OVERRIDES);
    showToast(`📅 Saved for ${_fmtDate(isoDate)} only`);
  } else {
    // Write to the weekly template — affects all weeks
    if (!state.timetable[secId])       state.timetable[secId]       = {};
    if (!state.timetable[secId][day])  state.timetable[secId][day]  = {};
    state.timetable[secId][day][period] = { subject: subj, teacherId: tid || null, locked };

    // Persist venue selection if the venue row was visible
    if (document.getElementById('modal-venue-row').style.display !== 'none') {
      const chosen   = document.getElementById('modal-venue-indoor').classList.contains('active') ? 'Indoor' : 'Outdoor';
      const key      = `${subj}|${day}|${period}`;
      const flipped  = !!state.venueFlips[key];
      const defaultV = getGamesVenue(secId, day, period);
      if (chosen !== defaultV) state.venueFlips[key] = !flipped;
      else                     state.venueFlips[key] = flipped;
    }

    checkConflicts();
    saveState();
  }

  closeModal();
  _renderCurrentView();
}

export function clearCell() {
  const { secId, day, period, isoDate, scope } = state.modalState;

  if (isoDate && scope === 'once') {
    // Remove the override, restoring the template value for this date
    if (state.OVERRIDES[isoDate]?.[secId]) {
      delete state.OVERRIDES[isoDate][secId][period];
      if (Object.keys(state.OVERRIDES[isoDate][secId]).length === 0) delete state.OVERRIDES[isoDate][secId];
      if (Object.keys(state.OVERRIDES[isoDate]).length === 0)        delete state.OVERRIDES[isoDate];
    }
    saveData('overrides', state.OVERRIDES);
    showToast(`🗑️ Override removed — template restored for ${_fmtDate(isoDate)}`);
  } else {
    if (state.timetable[secId]?.[day]) state.timetable[secId][day][period] = null;
    checkConflicts();
    saveState();
  }

  closeModal();
  _renderCurrentView();
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _resolveCell(secId, day, period, isoDate, scope) {
  if (isoDate && scope === 'once') {
    // Prefer existing override; fall back to effective (template) value
    const override = state.OVERRIDES?.[isoDate]?.[secId]?.[period];
    if (override) return override;
    const dayData = effectiveDay(secId, isoDate) || {};
    return dayData[period] || null;
  }
  return (state.timetable[secId] || {})[day]?.[period] || null;
}

function _populateFields(secId, day, period, cell) {
  const subjects = getSubjects(secId);
  const subjSel  = document.getElementById('modal-subject');
  subjSel.innerHTML = subjects.map(s =>
    `<option value="${s}" ${cell?.subject === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  fillTeacherDropdown(cell?.subject || subjects[0], cell?.teacherId);
  subjSel.onchange = () => fillTeacherDropdown(subjSel.value, null);

  document.getElementById('modal-lock').checked = !!cell?.locked;

  const subject  = cell?.subject || getSubjects(secId)[0];
  const venueRow = document.getElementById('modal-venue-row');
  if (SUBJECTS_CONFIG[subject]?.allowParallelGroups && getGamesVenue(secId, day, period)) {
    venueRow.style.display = '';
    setModalVenue(getGamesVenue(secId, day, period));
  } else {
    venueRow.style.display = 'none';
  }
}

function _applyScopeButtons(scope) {
  document.getElementById('modal-scope-once')?.classList.toggle('active', scope === 'once');
  document.getElementById('modal-scope-all') ?.classList.toggle('active', scope === 'all');
}

function _fmtDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function _renderCurrentView() {
  if      (state.currentTab === 'class')     renderClassView();
  else if (state.currentTab === 'teacher')   renderTeacherView();
  else if (state.currentTab === 'dashboard') renderDashboard();
}
