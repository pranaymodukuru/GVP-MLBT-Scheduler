// ─────────────────────────────────────────────────────────────────────────────
// CELL EDIT MODAL — left-click on any timetable cell
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { getSubjects, isTeacherAvailable, getCombinedSections, shortSec, getGamesVenue } from '../helpers.js';
import { SUBJECTS_CONFIG } from '../../config/school-config.js';
import { saveState } from '../persistence.js';
import { checkConflicts } from '../scheduler.js';
import { showToast } from '../toast.js';
import { renderClassView } from '../views/class-view.js';
import { renderTeacherView } from '../views/teacher-view.js';
import { renderDashboard } from '../views/dashboard.js';

// ── Attach backdrop-click listener on module load ─────────────────────────────
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

// ─────────────────────────────────────────────────────────────────────────────

export function openEdit(secId, day, period) {
  state.modalState = { secId, day, period };
  const cell = (state.timetable[secId] || {})[day]?.[period];

  document.getElementById('modal-title').textContent = `Edit: ${secId} · ${day} · ${period}`;

  const combined = getCombinedSections(secId, day, period);
  const noteEl   = document.getElementById('modal-combined-note');
  if (noteEl) {
    noteEl.textContent = combined.length
      ? `Combined class: ${[secId, ...combined].map(shortSec).join(' + ')}`
      : '';
    noteEl.style.display = combined.length ? '' : 'none';
  }

  const subjects = getSubjects(secId);
  const subjSel  = document.getElementById('modal-subject');
  subjSel.innerHTML = subjects.map(s =>
    `<option value="${s}" ${cell?.subject === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  fillTeacherDropdown(cell?.subject || subjects[0], cell?.teacherId);
  subjSel.onchange = () => fillTeacherDropdown(subjSel.value, null);

  document.getElementById('modal-lock').checked = !!cell?.locked;

  const subject = cell?.subject || getSubjects(secId)[0];
  const venueRow = document.getElementById('modal-venue-row');
  if (SUBJECTS_CONFIG[subject]?.allowParallelGroups && getGamesVenue(secId, day, period)) {
    venueRow.style.display = '';
    setModalVenue(getGamesVenue(secId, day, period));
  } else {
    venueRow.style.display = 'none';
  }

  document.getElementById('modal').classList.add('open');
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
    // Teachers busy in another section this slot
    const busyIds = new Set();
    Object.entries(state.timetable).forEach(([sid, days]) => {
      if (sid === secId) return;
      const c = days[day]?.[period];
      if (c?.teacherId) busyIds.add(c.teacherId);
    });

    // Teachers with a duty assignment this slot
    const dutyIds = new Set(
      (state.DUTY_ASSIGNMENTS || [])
        .filter(a => a.day === day && a.period === period && a.teacherId)
        .map(a => a.teacherId)
    );

    const grpAvailable     = [];
    const grpTeachingOther = [];
    const grpOnDuty        = [];
    const grpUnavailable   = [];

    teachers.forEach(t => {
      if (!isTeacherAvailable(t.id, day, period)) grpUnavailable.push(t);
      else if (dutyIds.has(t.id))                 grpOnDuty.push(t);
      else if (busyIds.has(t.id))                 grpTeachingOther.push(t);
      else                                         grpAvailable.push(t);
    });

    const opt = (t, prefix = '') =>
      `<option value="${t.id}" ${t.id === selTid ? 'selected' : ''}>${prefix}${t.name}</option>`;

    html += grpAvailable.map(t => opt(t)).join('');

    if (grpTeachingOther.length)
      html += `<optgroup label="── Teaching other class ──">${grpTeachingOther.map(t => opt(t, '↔ ')).join('')}</optgroup>`;

    if (grpOnDuty.length)
      html += `<optgroup label="── On duty ──">${grpOnDuty.map(t => opt(t, '⊕ ')).join('')}</optgroup>`;

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
  const { secId, day, period } = state.modalState;
  const subj   = document.getElementById('modal-subject').value;
  const tid    = document.getElementById('modal-teacher').value;
  const locked = document.getElementById('modal-lock').checked;

  if (!state.timetable[secId])       state.timetable[secId]       = {};
  if (!state.timetable[secId][day])  state.timetable[secId][day]  = {};
  state.timetable[secId][day][period] = { subject: subj, teacherId: tid || null, locked };

  // Persist venue selection if the venue row was visible
  if (document.getElementById('modal-venue-row').style.display !== 'none') {
    const chosen   = document.getElementById('modal-venue-indoor').classList.contains('active') ? 'Indoor' : 'Outdoor';
    const key      = `${subj}|${day}|${period}`;
    // Determine what the un-flipped default would be for this section
    const flipped  = !!state.venueFlips[key];
    const defaultV = getGamesVenue(secId, day, period); // current (may already be flipped)
    if (chosen !== defaultV) state.venueFlips[key] = !flipped;
    else                     state.venueFlips[key] = flipped;
  }

  closeModal();
  checkConflicts();
  _renderCurrentView();
  saveState();
}

export function clearCell() {
  const { secId, day, period } = state.modalState;
  if (state.timetable[secId]?.[day]) state.timetable[secId][day][period] = null;

  closeModal();
  checkConflicts();
  _renderCurrentView();
  saveState();
}

function _renderCurrentView() {
  if      (state.currentTab === 'class')     renderClassView();
  else if (state.currentTab === 'teacher')   renderTeacherView();
  else if (state.currentTab === 'dashboard') renderDashboard();
}
