// ─────────────────────────────────────────────────────────────────────────────
// APP ENTRY POINT
// Wires all modules together, handles init, tab switching, and orchestrates
// cross-cutting actions (regenerate, fillEmptySlots, import, etc.).
// Exposes the window.* surface needed by inline HTML onclick= handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { DEFAULT_TEACHERS, DEFAULT_CLASS_CONFIG, DEFAULT_SUBJECT_FREQ, DEFAULT_SUBJECT_MIN_FREQ, DEFAULT_SUBJECT_MUST_APPEAR_DAILY, STORAGE_KEY } from '../config/school-config.js';
import { allSectionIds, parseSection, getSubjects, isSatHalf, isTeacherAvailable, shuffle } from './helpers.js';
import { showToast } from './toast.js';
import { refreshSelects } from './selects.js';
import { saveState, loadSavedSnap, applySnap, exportJSON, fetchLatest, fetchSavedList, saveConfig } from './persistence.js';
import { generateTimetable, checkConflicts } from './scheduler.js';
import { renderClassView } from './views/class-view.js';
import { renderTeacherView } from './views/teacher-view.js';
import { renderSubjectView } from './views/subject-view.js';
import { renderDashboard } from './views/dashboard.js';
import {
  renderAdminView,
  renderTeachersList,
  renderClassConfigGrid,
  renderFreqGrid,
  renderAttendanceTable,
  renderConstraintsPanel,
  renderPeriodUnavailabilityPanel,
  setSectionCount,
  setSectionTeacher,
  addSubject,
  removeSubject,
  deleteClass,
  openAddClass,
  toggleTeacherDayBlock,
  toggleTeacherPeriodBlock,
  setConstraint,
  setSubjectFreq,
  setSubjectMinFreq,
  setSubjectMustAppearDaily,
} from './views/admin-view.js';
import {
  openEdit,
  fillTeacherDropdown,
  closeModal,
  saveCell,
  clearCell,
} from './modals/cell-modal.js';
import {
  renderChips,
  addChip,
  removeChip,
  openAddTeacher,
  openEditTeacher,
  saveTeacher,
  deleteTeacher,
  closeTeacherModal,
  populateClassSelectModal,
} from './modals/teacher-modal.js';

// ─────────────────────────────────────────────────────────────────────────────
// DARK MODE
// ─────────────────────────────────────────────────────────────────────────────

export function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  document.getElementById('theme-icon').className = next === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────────────────────────────────────

export function switchTab(tab) {
  state.currentTab = tab;
  ['class', 'teacher', 'subject', 'dashboard', 'admin'].forEach((t, i) =>
    document.querySelectorAll('.tab')[i].classList.toggle('active', t === tab)
  );
  document.getElementById('class-view').style.display     = tab === 'class'     ? '' : 'none';
  document.getElementById('teacher-view').style.display   = tab === 'teacher'   ? '' : 'none';
  document.getElementById('subject-view').style.display   = tab === 'subject'   ? '' : 'none';
  document.getElementById('dashboard-view').style.display = tab === 'dashboard' ? '' : 'none';
  document.getElementById('admin-view').style.display     = tab === 'admin'     ? '' : 'none';
  document.getElementById('regen-btn').style.display      = tab === 'admin'     ? 'none' : '';
  document.getElementById('conflict-panel').style.display =
    (tab === 'admin' || tab === 'dashboard') ? 'none' : 'block';

  if (tab === 'teacher')   renderTeacherView();
  if (tab === 'subject')   renderSubjectView();
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'admin')     renderAdminView();
}

// Navigate to a specific cell from the dashboard issues list
export function jumpToSlot(secId, day, period) {
  document.getElementById('class-select').value = secId;
  switchTab('class');
  setTimeout(() => openEdit(secId, day, period), 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// CELL LOCKING  (needs both class and teacher views → lives in app.js)
// ─────────────────────────────────────────────────────────────────────────────

export function toggleCellLock(secId, day, period, e) {
  e.preventDefault();
  e.stopPropagation();
  const cell = (state.timetable[secId] || {})[day]?.[period];
  if (!cell?.subject) return;
  cell.locked = !cell.locked;
  if      (state.currentTab === 'class')    renderClassView();
  else if (state.currentTab === 'teacher')  renderTeacherView();
  else if (state.currentTab === 'subject')  renderSubjectView();
  saveState();
  showToast(cell.locked ? '🔒 Period locked' : '🔓 Period unlocked');
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function regenerate() {
  state.timetable = generateTimetable(true);
  checkConflicts();
  if      (state.currentTab === 'class')     renderClassView();
  else if (state.currentTab === 'teacher')   renderTeacherView();
  else if (state.currentTab === 'subject')   renderSubjectView();
  else if (state.currentTab === 'dashboard') renderDashboard();
  saveState();
  showToast('🔄 Regenerated (locked cells preserved)');
}

export function runAndSwitch() {
  state.timetable = generateTimetable(false);
  checkConflicts();
  switchTab('class');
  saveState();
  const el = document.getElementById('run-status');
  el.textContent = '✅ Generated at ' + new Date().toLocaleTimeString();
  setTimeout(() => { el.textContent = ''; }, 4000);
}

export function fillEmptySlots() {
  // Rebuild occupancy from the current timetable
  const occ = {};
  const dc  = {};
  state.TEACHERS.forEach(t => {
    occ[t.id] = {};
    dc[t.id]  = {};
    ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => { occ[t.id][d] = {}; dc[t.id][d] = 0; });
  });
  allSectionIds().forEach(secId => {
    ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d =>
      ['P1','P2','P3','P4','P5','P6','P7','P8'].forEach(p => {
        const cell = (state.timetable[secId] || {})[d]?.[p];
        if (cell?.teacherId && occ[cell.teacherId]) {
          occ[cell.teacherId][d][p] = secId;
          dc[cell.teacherId][d]++;
        }
      })
    );
  });

  let count = 0;
  allSectionIds().forEach(secId => {
    const { base }  = parseSection(secId);
    const subjects  = getSubjects(secId);
    ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d =>
      ['P1','P2','P3','P4','P5','P6','P7','P8'].forEach(p => {
        if (!state.timetable[secId]?.[d]) return;
        const cell = state.timetable[secId][d][p];

        // Case 1: completely empty slot
        if (cell === null || cell === undefined) {
          for (const subj of shuffle(subjects)) {
            const cands = shuffle(state.TEACHERS.filter(t =>
              t.subjects.includes(subj) &&
              (t.classes.includes(base) || t.classes.includes(secId)) &&
              !occ[t.id][d][p] &&
              isTeacherAvailable(t.id, d)
            ));
            if (cands.length) {
              state.timetable[secId][d][p] = { subject: subj, teacherId: cands[0].id };
              occ[cands[0].id][d][p] = secId;
              dc[cands[0].id][d]++;
              count++;
              break;
            }
          }
        }
        // Case 2: subject assigned but no teacher
        else if (cell?.subject && !cell.teacherId && !cell.locked) {
          const cands = shuffle(state.TEACHERS.filter(t =>
            t.subjects.includes(cell.subject) &&
            (t.classes.includes(base) || t.classes.includes(secId)) &&
            !occ[t.id][d][p] &&
            isTeacherAvailable(t.id, d)
          ));
          if (cands.length) {
            cell.teacherId = cands[0].id;
            occ[cands[0].id][d][p] = secId;
            dc[cands[0].id][d]++;
            count++;
          }
        }
      })
    );
  });

  checkConflicts();
  saveState();
  renderDashboard();
  if      (state.currentTab === 'class')   renderClassView();
  else if (state.currentTab === 'teacher') renderTeacherView();
  showToast(`✅ Filled ${count} slot${count !== 1 ? 's' : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE UI (banner + import/export)
// ─────────────────────────────────────────────────────────────────────────────

export function applySavedState() {
  const snap = loadSavedSnap();
  if (!snap) { showToast('No saved data found', 'error'); return; }
  applySnap(snap);
  dismissBanner();
  refreshSelects();
  checkConflicts();
  renderClassView();
  showToast('✅ Saved schedule loaded');
}

export function dismissBanner() {
  document.getElementById('load-banner').style.display = 'none';
}

export function dismissBannerFresh() {
  dismissBanner();
  localStorage.removeItem(STORAGE_KEY);
  state.timetable = generateTimetable(false);
  refreshSelects();
  checkConflicts();
  renderClassView();
  saveState();
}

export async function triggerImport() {
  const modal = document.getElementById('import-modal');
  const list  = document.getElementById('import-saved-list');
  list.innerHTML = '<div class="import-empty">Loading…</div>';
  modal.classList.add('open');

  const files = await fetchSavedList();
  if (!files || files.length === 0) {
    list.innerHTML = '<div class="import-empty">No saved schedules found.</div>';
    return;
  }

  list.innerHTML = files.map(f => {
    const dt = new Date(f.mtime * 1000).toLocaleString();
    return `<div class="import-file-row">
      <span class="import-file-name" title="${f.filename}">${f.filename}</span>
      <span class="import-file-time">${dt}</span>
      <button class="btn btn-sm btn-primary" onclick="loadSavedFile('${f.filename}')">Load</button>
    </div>`;
  }).join('');
}

export function closeImportModal() {
  document.getElementById('import-modal').classList.remove('open');
}

export function triggerFilePicker() {
  closeImportModal();
  document.getElementById('import-file').click();
}

export async function loadSavedFile(filename) {
  try {
    const res = await fetch(`/saved_schedules/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error();
    const snap = await res.json();
    applySnap(snap);
    saveState();
    refreshSelects();
    checkConflicts();
    renderClassView();
    if (state.currentTab === 'admin')     renderAdminView();
    if (state.currentTab === 'dashboard') renderDashboard();
    closeImportModal();
    showToast(`✅ Loaded ${filename}`);
  } catch (_) {
    showToast('❌ Could not load file', 'error');
  }
}

export function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      applySnap(JSON.parse(ev.target.result));
      saveState();
      refreshSelects();
      checkConflicts();
      renderClassView();
      if (state.currentTab === 'admin')     renderAdminView();
      if (state.currentTab === 'dashboard') renderDashboard();
      showToast('✅ Imported');
    } catch (err) {
      showToast('❌ Invalid JSON', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

export function resetToDefaults() {
  if (!confirm('Reset everything to factory defaults? All changes will be lost.')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-icon').className = savedTheme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';

  const snap = loadSavedSnap();
  if (snap) {
    applySnap(snap);
    const ts = new Date(snap.savedAt);
    document.getElementById('load-banner-time').textContent =
      `Saved ${ts.toLocaleDateString()} at ${ts.toLocaleTimeString()}`;
    document.getElementById('load-banner').style.display = '';
  } else {
    const latest = await fetchLatest();
    if (latest) {
      applySnap(latest.data);
      saveState();
      const ts = new Date(latest.data.savedAt);
      document.getElementById('load-banner-time').textContent =
        `${latest.filename} — ${ts.toLocaleDateString()} at ${ts.toLocaleTimeString()}`;
      document.getElementById('load-banner').style.display = '';
    } else {
      state.timetable = generateTimetable(false);
      saveState();
    }
  }
  refreshSelects();
  checkConflicts();
  renderClassView();
}

init();

// ─────────────────────────────────────────────────────────────────────────────
// WINDOW SURFACE — expose to inline HTML onclick= handlers
// ES modules are scoped, so functions called from HTML attributes must be
// on window. This is the minimal global surface; all logic stays in modules.
// ─────────────────────────────────────────────────────────────────────────────

// App-level
window.toggleDarkMode   = toggleDarkMode;
window.switchTab        = switchTab;
window.jumpToSlot       = jumpToSlot;
window.toggleCellLock   = toggleCellLock;
window.regenerate       = regenerate;
window.runAndSwitch     = runAndSwitch;
window.fillEmptySlots   = fillEmptySlots;

// Persistence
window.exportJSON       = () => exportJSON().then(({ saved }) => showToast(`💾 Saved: ${saved}`));
window.triggerImport    = triggerImport;
window.closeImportModal = closeImportModal;
window.triggerFilePicker = triggerFilePicker;
window.loadSavedFile    = loadSavedFile;
window.handleImport     = handleImport;
window.applySavedState  = applySavedState;
window.dismissBanner    = dismissBanner;
window.dismissBannerFresh = dismissBannerFresh;
window.resetToDefaults  = resetToDefaults;

// Cell modal
window.openEdit         = openEdit;
window.closeModal       = closeModal;
window.saveCell         = saveCell;
window.clearCell        = clearCell;

// Teacher modal
window.openAddTeacher   = openAddTeacher;
window.openEditTeacher  = openEditTeacher;
window.saveTeacher      = saveTeacher;
window.deleteTeacher    = deleteTeacher;
window.closeTeacherModal = closeTeacherModal;
window.addChip          = addChip;
window.removeChip       = removeChip;

// Admin view
window.setSectionCount  = setSectionCount;
window.setSectionTeacher = setSectionTeacher;
window.addSubject       = addSubject;
window.removeSubject    = removeSubject;
window.deleteClass      = deleteClass;
window.openAddClass     = openAddClass;
window.toggleTeacherDayBlock    = toggleTeacherDayBlock;
window.toggleTeacherPeriodBlock = toggleTeacherPeriodBlock;
window.renderPeriodUnavailabilityPanel = renderPeriodUnavailabilityPanel;
window.setConstraint        = setConstraint;
window.setSubjectFreq             = setSubjectFreq;
window.setSubjectMinFreq          = setSubjectMinFreq;
window.setSubjectMustAppearDaily  = setSubjectMustAppearDaily;

// View renders called by select onchange handlers
window.renderClassView   = renderClassView;
window.renderTeacherView = renderTeacherView;
window.renderSubjectView = renderSubjectView;

// Expose state + saveState for any remaining inline handlers
window.state            = state;
window.saveState        = saveState;
window.saveConfig       = saveConfig;
