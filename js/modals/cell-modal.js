// ─────────────────────────────────────────────────────────────────────────────
// CELL EDIT MODAL — left-click on any timetable cell
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { getSubjects, isTeacherAvailable } from '../helpers.js';
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

  const subjects = getSubjects(secId);
  const subjSel  = document.getElementById('modal-subject');
  subjSel.innerHTML = subjects.map(s =>
    `<option value="${s}" ${cell?.subject === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  fillTeacherDropdown(cell?.subject || subjects[0], cell?.teacherId);
  subjSel.onchange = () => fillTeacherDropdown(subjSel.value, null);

  document.getElementById('modal-lock').checked = !!cell?.locked;
  document.getElementById('modal').classList.add('open');
}

export function fillTeacherDropdown(subject, selTid) {
  const { day, period } = state.modalState;
  const teachers = state.TEACHERS.filter(t => t.subjects.includes(subject));

  let html = `<option value="">-- Unassigned --</option>`;

  if (day && period) {
    const available   = teachers.filter(t =>  isTeacherAvailable(t.id, day, period));
    const unavailable = teachers.filter(t => !isTeacherAvailable(t.id, day, period));
    html += available.map(t =>
      `<option value="${t.id}" ${t.id === selTid ? 'selected' : ''}>${t.name}</option>`
    ).join('');
    if (unavailable.length) {
      html +=
        `<optgroup label="─── Unavailable this slot ───">` +
        unavailable.map(t =>
          `<option value="${t.id}" ${t.id === selTid ? 'selected' : ''}>⚠ ${t.name}</option>`
        ).join('') +
        `</optgroup>`;
    }
  } else {
    html += teachers.map(t =>
      `<option value="${t.id}" ${t.id === selTid ? 'selected' : ''}>${t.name}</option>`
    ).join('');
  }

  const sel = document.getElementById('modal-teacher');
  sel.innerHTML = html;
  // Tint the select red when the selected teacher is in the unavailable group
  const selectedText = sel.options[sel.selectedIndex]?.text || '';
  sel.style.color = selectedText.startsWith('⚠') ? '#dc2626' : '';
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
