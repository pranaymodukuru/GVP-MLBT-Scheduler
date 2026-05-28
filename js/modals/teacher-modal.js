// ─────────────────────────────────────────────────────────────────────────────
// TEACHER EDIT MODAL — add/edit teachers in the Admin view
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { saveState } from '../persistence.js';
import { showToast } from '../toast.js';
import { refreshSelects } from '../selects.js';
import { renderTeachersList } from '../views/admin-view.js';

// ── Attach listeners on module load ──────────────────────────────────────────
document.getElementById('teacher-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('teacher-modal')) closeTeacherModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement.id === 'tm-subj-input') {
    e.preventDefault();
    addChip('subjects');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHIP EDITOR
// ─────────────────────────────────────────────────────────────────────────────

export function renderChips(type) {
  const arr = type === 'subjects' ? state.tmSubjects : state.tmClasses;
  const cls = type === 'subjects' ? 'chip-subj' : 'chip-class';
  document.getElementById(`tm-${type}-chips`).innerHTML = arr.map((v, i) =>
    `<span class="chip ${cls}">${v}<button onclick="removeChip('${type}',${i})">×</button></span>`
  ).join('');
}

export function removeChip(type, i) {
  (type === 'subjects' ? state.tmSubjects : state.tmClasses).splice(i, 1);
  renderChips(type);
}

export function addChip(type) {
  if (type === 'subjects') {
    const inp = document.getElementById('tm-subj-input');
    const v   = inp.value.trim();
    if (v && !state.tmSubjects.includes(v)) {
      state.tmSubjects.push(v);
      renderChips('subjects');
    }
    inp.value = '';
    inp.focus();
  } else {
    const sel = document.getElementById('tm-class-input');
    const v   = sel.value;
    if (v && !state.tmClasses.includes(v)) {
      state.tmClasses.push(v);
      renderChips('classes');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

export function populateClassSelectModal() {
  document.getElementById('tm-class-input').innerHTML =
    Object.keys(state.CLASS_CONFIG).map(c => `<option value="${c}">${c}</option>`).join('');
}

export function openAddTeacher() {
  state.teacherModalState = { mode: 'add' };
  state.tmSubjects = [];
  state.tmClasses  = [];
  document.getElementById('teacher-modal-title').textContent = 'Add Teacher';
  document.getElementById('tm-name').value  = '';
  document.getElementById('tm-id').value    = 'T' + String(state.TEACHERS.length + 1).padStart(2, '0');
  document.getElementById('tm-delete-btn').style.display = 'none';
  renderChips('subjects');
  renderChips('classes');
  populateClassSelectModal();
  document.getElementById('teacher-modal').classList.add('open');
}

export function openEditTeacher(id) {
  const t = state.TEACHERS.find(x => x.id === id);
  if (!t) return;
  state.teacherModalState = { mode: 'edit', id };
  state.tmSubjects = [...t.subjects];
  state.tmClasses  = [...t.classes];
  document.getElementById('teacher-modal-title').textContent = 'Edit Teacher';
  document.getElementById('tm-name').value = t.name;
  document.getElementById('tm-id').value   = t.id;
  document.getElementById('tm-delete-btn').style.display = 'inline-flex';
  renderChips('subjects');
  renderChips('classes');
  populateClassSelectModal();
  document.getElementById('teacher-modal').classList.add('open');
}

export function saveTeacher() {
  const name = document.getElementById('tm-name').value.trim();
  const id   = document.getElementById('tm-id').value.trim();
  if (!name || !id) { alert('Name and ID required.'); return; }

  if (state.teacherModalState.mode === 'add') {
    if (state.TEACHERS.find(t => t.id === id)) { alert('ID already exists.'); return; }
    state.TEACHERS.push({ id, name, subjects: [...state.tmSubjects], classes: [...state.tmClasses] });
  } else {
    const idx = state.TEACHERS.findIndex(t => t.id === state.teacherModalState.id);
    if (idx > -1) state.TEACHERS[idx] = { ...state.TEACHERS[idx], id, name, subjects: [...state.tmSubjects], classes: [...state.tmClasses] };
  }

  closeTeacherModal();
  renderTeachersList();
  refreshSelects();
  saveState();
}

export function deleteTeacher() {
  if (!confirm('Delete this teacher?')) return;
  state.TEACHERS = state.TEACHERS.filter(t => t.id !== state.teacherModalState.id);
  delete state.TEACHER_AVAILABILITY[state.teacherModalState.id];
  closeTeacherModal();
  renderTeachersList();
  refreshSelects();
  saveState();
}

export function closeTeacherModal() {
  document.getElementById('teacher-modal').classList.remove('open');
}
