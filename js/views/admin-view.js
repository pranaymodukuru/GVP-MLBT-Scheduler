// ─────────────────────────────────────────────────────────────────────────────
// ADMIN VIEW — teachers list, class config grid, frequency grid, attendance
// All mutations here call saveState() immediately and re-render the relevant
// admin sub-panel. refreshSelects() is imported from selects.js to avoid
// a circular dependency with app.js.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { DAYS, WORK_PERIODS, PERIODS, SECTION_LABELS, NO_P1_LOCK_CLASSES, SAT_HALF_BASES } from '../../config/school-config.js';
import { parseSection } from '../helpers.js';
import { refreshSelects } from '../selects.js';
import { saveState, saveConfig } from '../persistence.js';
import { showToast } from '../toast.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL RENDER
// ─────────────────────────────────────────────────────────────────────────────

export function renderAdminView() {
  renderTeachersList();
  renderClassConfigGrid();
  renderFreqGrid();
  renderAttendanceTable();
  const prevTid = document.getElementById('period-unavail-panel')
    ?.querySelector('.pu-teacher-select')?.value || '';
  renderPeriodUnavailabilityPanel(prevTid);
  renderConstraintsPanel();
  renderDutiesPanel();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEACHERS LIST
// ─────────────────────────────────────────────────────────────────────────────

export function renderTeachersList() {
  const el = document.getElementById('teachers-list');
  if (!state.TEACHERS.length) {
    el.innerHTML = '<div class="empty-state">No teachers yet.</div>';
    return;
  }
  el.innerHTML = state.TEACHERS.map(t => {
    const avail        = state.TEACHER_AVAILABILITY[t.id] || {};
    const absent       = avail.blockedDays || [];
    const periodBlocks = avail.blockedPeriods || {};
    const periodTags   = Object.entries(periodBlocks)
      .map(([day, periods]) => `<span class="tag tag-period">${day}: ${periods.join(', ')}</span>`)
      .join('');
    return (
      `<div class="admin-row">` +
      `<div class="admin-row-info">` +
        `<div class="admin-row-name">${t.name}</div>` +
        `<div class="admin-row-id">${t.id}</div>` +
        `<div class="admin-row-tags">${t.subjects.map(s => `<span class="tag tag-subj">${s}</span>`).join('')}</div>` +
        `<div class="admin-row-tags" style="margin-top:4px">` +
          (t.classes.length
            ? t.classes.map(c => `<span class="tag tag-class">${c}</span>`).join('')
            : `<span class="tag tag-warn">No classes</span>`) +
          (absent.length ? `<span class="tag tag-absent">Absent: ${absent.join(', ')}</span>` : '') +
        `</div>` +
        (periodTags ? `<div class="admin-row-tags" style="margin-top:4px">${periodTags}</div>` : '') +
      `</div>` +
      `<div class="admin-row-actions">` +
        `<button class="btn btn-sm" onclick="openEditTeacher('${t.id}')"><i class="ti ti-edit"></i></button>` +
      `</div>` +
      `</div>`
    );
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE TABLE
// ─────────────────────────────────────────────────────────────────────────────

export function renderAttendanceTable() {
  document.getElementById('att-table').innerHTML =
    `<thead><tr><th>Teacher</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr></thead>` +
    `<tbody>` +
    state.TEACHERS.map(t => {
      const blocked = state.TEACHER_AVAILABILITY[t.id]?.blockedDays || [];
      return (
        `<tr${blocked.length ? ' class="att-row-absent"' : ''}>` +
        `<td>${t.name} <span style="color:#9ca3af;font-size:10px">${t.id}</span></td>` +
        DAYS.map(d =>
          `<td><input type="checkbox" class="att-cb" ${blocked.includes(d) ? 'checked' : ''}` +
          ` onchange="toggleTeacherDayBlock('${t.id}','${d}',this.checked)"></td>`
        ).join('') +
        `</tr>`
      );
    }).join('') +
    `</tbody>`;
}

export function toggleTeacherDayBlock(tid, day, isBlocked) {
  if (!state.TEACHER_AVAILABILITY[tid]) state.TEACHER_AVAILABILITY[tid] = { blockedDays: [] };
  const arr = state.TEACHER_AVAILABILITY[tid].blockedDays;
  const idx = arr.indexOf(day);
  if (isBlocked && idx === -1) arr.push(day);
  else if (!isBlocked && idx > -1) arr.splice(idx, 1);
  saveState();
  saveConfig();
  renderTeachersList();
  // Refresh the period panel so disabled states update for the now-absent day
  const puTid = document.getElementById('period-unavail-panel')
    ?.querySelector('.pu-teacher-select')?.value || '';
  if (puTid === tid) renderPeriodUnavailabilityPanel(tid);
  showToast(
    isBlocked ? `🚫 ${tid} absent on ${day}` : `✅ ${tid} available on ${day}`,
    isBlocked ? 'error' : 'success'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD UNAVAILABILITY PANEL
// ─────────────────────────────────────────────────────────────────────────────

export function renderPeriodUnavailabilityPanel(tid = '') {
  const panel = document.getElementById('period-unavail-panel');
  if (!panel) return;

  const teacherSelect =
    `<select class="pu-teacher-select" onchange="renderPeriodUnavailabilityPanel(this.value)">` +
    `<option value="">— Select a teacher —</option>` +
    state.TEACHERS.map(t =>
      `<option value="${t.id}" ${t.id === tid ? 'selected' : ''}>${t.name} (${t.id})</option>`
    ).join('') +
    `</select>`;

  if (!tid) {
    panel.innerHTML =
      `<div class="pu-header">${teacherSelect}</div>` +
      `<div class="pu-empty">Select a teacher above to manage their period-level unavailability.</div>`;
    return;
  }

  const avail         = state.TEACHER_AVAILABILITY[tid] || {};
  const blockedDays   = avail.blockedDays   || [];
  const blockedPeriods = avail.blockedPeriods || {};

  const periodMeta = Object.fromEntries(PERIODS.map(p => [p.id, p]));

  const grid =
    `<div style="overflow-x:auto;margin-top:14px">` +
    `<table class="pu-table">` +
    `<thead><tr>` +
      `<th>Period</th>` +
      DAYS.map(d => {
        const fullBlocked = blockedDays.includes(d);
        return `<th class="${fullBlocked ? 'pu-col-blocked' : ''}">${d}${fullBlocked ? `<span class="pu-day-badge">absent</span>` : ''}</th>`;
      }).join('') +
    `</tr></thead>` +
    `<tbody>` +
    WORK_PERIODS.map(p => {
      const meta = periodMeta[p] || {};
      return `<tr>` +
      `<td class="pu-day-cell"><span>${meta.label || p}</span>${meta.time ? `<span class="pu-period-time">${meta.time}</span>` : ''}</td>` +
      DAYS.map(d => {
        const fullBlocked = blockedDays.includes(d);
        const isBlocked = fullBlocked || (blockedPeriods[d] || []).includes(p);
        return (
          `<td class="${fullBlocked ? 'pu-row-blocked' : ''}">` +
          `<input type="checkbox" class="att-cb" ` +
            `${isBlocked ? 'checked' : ''} ` +
            `${fullBlocked ? `disabled title="Teacher is fully absent on ${d}"` : ''} ` +
            `onchange="toggleTeacherPeriodBlock('${tid}','${d}','${p}',this.checked)">` +
          `</td>`
        );
      }).join('') +
      `</tr>`;
    }).join('') +
    `</tbody></table></div>`;

  panel.innerHTML = `<div class="pu-header">${teacherSelect}</div>` + grid;
}

export function toggleTeacherPeriodBlock(tid, day, period, isBlocked) {
  if (!state.TEACHER_AVAILABILITY[tid])              state.TEACHER_AVAILABILITY[tid]              = {};
  if (!state.TEACHER_AVAILABILITY[tid].blockedPeriods) state.TEACHER_AVAILABILITY[tid].blockedPeriods = {};
  const dayArr = state.TEACHER_AVAILABILITY[tid].blockedPeriods;
  if (!dayArr[day]) dayArr[day] = [];
  const arr = dayArr[day];
  const idx = arr.indexOf(period);
  if (isBlocked && idx === -1) arr.push(period);
  else if (!isBlocked && idx > -1) arr.splice(idx, 1);
  // Prune empty structures
  if (!arr.length) delete dayArr[day];
  if (!Object.keys(dayArr).length) delete state.TEACHER_AVAILABILITY[tid].blockedPeriods;
  saveState();
  saveConfig();
  renderTeachersList();
  showToast(
    isBlocked ? `🚫 ${tid} unavailable ${day} ${period}` : `✅ ${tid} available ${day} ${period}`,
    isBlocked ? 'error' : 'success'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS CONFIG GRID
// ─────────────────────────────────────────────────────────────────────────────

export function renderClassConfigGrid() {
  document.getElementById('class-config-grid').innerHTML =
    Object.entries(state.CLASS_CONFIG).map(([base, cfg]) => {
      const n         = cfg.sections || 1;
      const secLabels = SECTION_LABELS.slice(0, n);
      const st        = cfg.sectionTeachers || {};

      const sectionRows = secLabels.map(lbl => {
        const ctId = st[lbl] || '';
        const ct   = state.TEACHERS.find(t => t.id === ctId);
        const p1s  = ct ? ct.subjects.find(s => cfg.subjects.includes(s)) || '—' : '—';
        return (
          `<div class="section-row">` +
          `<span class="section-label">${n === 1 ? 'CT' : lbl}</span>` +
          `<select onchange="setSectionTeacher('${base}','${lbl}',this.value)">` +
            `<option value="">— None —</option>` +
            state.TEACHERS.map(t =>
              `<option value="${t.id}" ${t.id === ctId ? 'selected' : ''}>${t.name}</option>`
            ).join('') +
          `</select>` +
          `<span class="p1-hint" title="Subject pinned to P1">📌 ${p1s}</span>` +
          `</div>`
        );
      }).join('');

      const subjectTags = cfg.subjects.map(s =>
        `<span class="cs-tag">${s}<button onclick="removeSubject('${base}','${s}')">×</button></span>`
      ).join('');

      const safe = base.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

      return (
        `<div class="cc-card">` +
        `<div class="cc-card-header">` +
          `<span class="cc-card-title">${base}</span>` +
          `<button class="btn btn-sm" style="padding:2px 7px;font-size:11px;color:#dc2626;border-color:#fca5a5"` +
            ` onclick="deleteClass('${base}')"><i class="ti ti-trash"></i></button>` +
        `</div>` +
        `<div class="cc-card-body">` +
          `<div class="section-count-row">` +
            `<label>Sections:</label>` +
            `<input type="number" min="1" max="6" value="${n}"` +
              ` onchange="setSectionCount('${base}',this.value)">` +
            `<span style="font-size:11px;color:#9ca3af">${n === 1 ? '(single)' : SECTION_LABELS.slice(0, n).join(', ')}</span>` +
          `</div>` +
          sectionRows +
          `<div class="divider" style="margin:10px -12px 8px;padding:5px 12px;">Subjects</div>` +
          `<div class="cs-tags">${subjectTags}</div>` +
          `<div class="add-subj-row">` +
            `<input type="text" id="as-${safe}" placeholder="Add subject…"` +
              ` onkeydown="if(event.key==='Enter')addSubject('${base}')">` +
            `<button onclick="addSubject('${base}')">+ Add</button>` +
          `</div>` +
        `</div>` +
        `</div>`
      );
    }).join('');
}

export function setSectionCount(base, val) {
  const n = Math.max(1, Math.min(6, parseInt(val) || 1));
  state.CLASS_CONFIG[base].sections = n;
  const existing = state.CLASS_CONFIG[base].sectionTeachers || {};
  const newST    = {};
  SECTION_LABELS.slice(0, n).forEach(l => { newST[l] = existing[l] || ''; });
  state.CLASS_CONFIG[base].sectionTeachers = newST;
  renderClassConfigGrid();
  refreshSelects();
  saveState();
  saveConfig();
}

export function setSectionTeacher(base, label, tid) {
  if (!state.CLASS_CONFIG[base].sectionTeachers) state.CLASS_CONFIG[base].sectionTeachers = {};
  state.CLASS_CONFIG[base].sectionTeachers[label] = tid;
  renderClassConfigGrid();
  saveState();
  saveConfig();
}

export function addSubject(base) {
  const safe = base.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const inp  = document.getElementById('as-' + safe);
  const val  = inp.value.trim();
  if (!val) return;
  if (!state.CLASS_CONFIG[base].subjects.includes(val)) state.CLASS_CONFIG[base].subjects.push(val);
  inp.value = '';
  renderClassConfigGrid();
  renderFreqGrid();
  saveState();
  saveConfig();
}

export function removeSubject(base, subj) {
  state.CLASS_CONFIG[base].subjects = state.CLASS_CONFIG[base].subjects.filter(s => s !== subj);
  renderClassConfigGrid();
  renderFreqGrid();
  saveState();
  saveConfig();
}

export function deleteClass(base) {
  if (!confirm(`Delete "${base}"?`)) return;
  delete state.CLASS_CONFIG[base];
  renderClassConfigGrid();
  renderFreqGrid();
  refreshSelects();
  saveState();
  saveConfig();
}

export function openAddClass() {
  const name = prompt('New class name (e.g. Class 11):');
  if (!name?.trim()) return;
  const n = name.trim();
  if (state.CLASS_CONFIG[n]) { alert('Already exists.'); return; }
  state.CLASS_CONFIG[n] = { sections: 1, subjects: [], sectionTeachers: { A: '' } };
  renderClassConfigGrid();
  refreshSelects();
  saveState();
  saveConfig();
}

// ─────────────────────────────────────────────────────────────────────────────
// FREQUENCY GRID
// ─────────────────────────────────────────────────────────────────────────────

export function renderFreqGrid() {
  const all = [...new Set(Object.values(state.CLASS_CONFIG).flatMap(c => c.subjects))].sort();
  all.forEach(s => {
    if (!state.SUBJECT_FREQ[s])     state.SUBJECT_FREQ[s]     = 2;
    if (!state.SUBJECT_MIN_FREQ[s]) state.SUBJECT_MIN_FREQ[s] = 1;
  });

  all.forEach(s => {
    if (state.SUBJECT_MUST_APPEAR_DAILY[s] === undefined) state.SUBJECT_MUST_APPEAR_DAILY[s] = false;
  });

  document.getElementById('freq-grid').innerHTML =
    `<div class="freq-header-row">` +
      `<span>Subject</span>` +
      `<span title="Minimum periods/week — scheduler will try to guarantee this">Min/wk</span>` +
      `<span title="Target periods/week — scheduler aims for this count">Target/wk</span>` +
      `<span title="Must appear at least once every school day">Daily</span>` +
    `</div>` +
    all.map(s =>
      `<div class="freq-row">` +
      `<label>${s}</label>` +
      `<input type="number" min="0" max="12" value="${state.SUBJECT_MIN_FREQ[s] ?? 1}"` +
        ` title="Minimum periods/week"` +
        ` onchange="setSubjectMinFreq('${s}',parseInt(this.value)||0)">` +
      `<input type="number" min="1" max="12" value="${state.SUBJECT_FREQ[s] || 2}"` +
        ` title="Target periods/week"` +
        ` onchange="setSubjectFreq('${s}',parseInt(this.value)||2)">` +
      `<div class="freq-daily-cell">` +
        `<input type="checkbox" ${state.SUBJECT_MUST_APPEAR_DAILY[s] ? 'checked' : ''}` +
          ` title="Must appear every day"` +
          ` onchange="setSubjectMustAppearDaily('${s}',this.checked)">` +
      `</div>` +
      `</div>`
    ).join('');
}

export function setSubjectFreq(subj, val) {
  state.SUBJECT_FREQ[subj] = Math.max(1, val);
  saveState();
  saveConfig();
}

export function setSubjectMinFreq(subj, val) {
  state.SUBJECT_MIN_FREQ[subj] = Math.max(0, val);
  saveState();
  saveConfig();
}

export function setSubjectMustAppearDaily(subj, val) {
  state.SUBJECT_MUST_APPEAR_DAILY[subj] = val;
  saveState();
  saveConfig();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRAINTS PANEL
// ─────────────────────────────────────────────────────────────────────────────

export function renderConstraintsPanel() {
  const c = state.CONSTRAINTS;
  const p1Exempt = NO_P1_LOCK_CLASSES.length ? NO_P1_LOCK_CLASSES.join(', ') : 'none';
  const satHalf  = SAT_HALF_BASES.join(', ');

  document.getElementById('constraints-panel').innerHTML =
    `<div class="constraint-row">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">Max same-subject periods per day</div>` +
        `<div class="constraint-desc">A subject may appear at most this many times per class per day. Takes effect on next generation.</div>` +
      `</div>` +
      `<input type="number" class="constraint-input" min="1" max="8" value="${c.maxSubjectPeriodsPerDay}"` +
        ` onchange="setConstraint('maxSubjectPeriodsPerDay',parseInt(this.value)||2)">` +
    `</div>` +
    `<div class="constraint-row">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">Max teacher periods per day</div>` +
        `<div class="constraint-desc">Soft cap per teacher per day. A relaxed 2nd pass may exceed it to fill remaining gaps.</div>` +
      `</div>` +
      `<input type="number" class="constraint-input" min="1" max="12" value="${c.maxTeacherPeriodsPerDay}"` +
        ` onchange="setConstraint('maxTeacherPeriodsPerDay',parseInt(this.value)||6)">` +
    `</div>` +
    `<div class="constraint-row">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">Physical Education: max once per day</div>` +
        `<div class="constraint-desc">PE cannot appear more than once per class per day, regardless of the subject cap above.</div>` +
      `</div>` +
      `<label class="constraint-toggle">` +
        `<input type="checkbox" ${c.peOncePerDay ? 'checked' : ''} onchange="setConstraint('peOncePerDay',this.checked)">` +
        `<span class="constraint-toggle-track"></span>` +
      `</label>` +
    `</div>` +
    `<div class="constraint-section-divider">Structural / read-only constraints</div>` +
    `<div class="constraint-row constraint-row-readonly">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">📌 Period 1 lock</div>` +
        `<div class="constraint-desc">P1 every day is always the class teacher's own subject, except: <strong>${p1Exempt}</strong>. Edit via <code>noP1LockClasses</code> in school-config.json.</div>` +
      `</div>` +
    `</div>` +
    `<div class="constraint-row constraint-row-readonly">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">📅 Saturday half-day</div>` +
        `<div class="constraint-desc">P7 and P8 are skipped on Saturdays for: <strong>${satHalf}</strong>.</div>` +
      `</div>` +
    `</div>` +
    `<div class="constraint-row constraint-row-readonly">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">🔒 Locked cells survive regeneration</div>` +
        `<div class="constraint-desc">Manually locked cells (🔒) and auto-locked P1 cells (📌) are never overwritten when regenerating.</div>` +
      `</div>` +
    `</div>` +
    `<div class="constraint-row constraint-row-readonly">` +
      `<div class="constraint-info">` +
        `<div class="constraint-label">🚫 No teacher double-booking</div>` +
        `<div class="constraint-desc">A teacher cannot be assigned to two classes at the same time. Violations appear in the conflict panel.</div>` +
      `</div>` +
    `</div>`;
}

export function setConstraint(key, value) {
  state.CONSTRAINTS[key] = value;
  renderConstraintsPanel();
  saveState();
  saveConfig();
  showToast(`Constraint updated`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DUTIES PANEL
// ─────────────────────────────────────────────────────────────────────────────

export function renderDutiesPanel() {
  const el = document.getElementById('duties-panel');
  if (!el) return;

  const list = state.DUTY_TYPES.length
    ? state.DUTY_TYPES.map((d, i) =>
        `<div class="admin-row" style="padding:8px 12px;align-items:center">` +
        `<div class="admin-row-info"><div class="admin-row-name">${d}</div></div>` +
        `<div class="admin-row-actions">` +
          `<button class="btn btn-sm" style="color:#dc2626;border-color:#fca5a5" onclick="removeDutyType(${i})">` +
          `<i class="ti ti-trash"></i></button>` +
        `</div>` +
        `</div>`
      ).join('')
    : `<div class="empty-state">No duty types defined.</div>`;

  el.innerHTML =
    list +
    `<div style="display:flex;gap:8px;margin-top:12px;padding:0 12px 4px;align-items:center">` +
    `<input type="text" id="new-duty-input" placeholder="New duty type…" style="flex:1"` +
    ` onkeydown="if(event.key==='Enter')addDutyType()">` +
    `<button class="btn btn-sm btn-primary" onclick="addDutyType()"><i class="ti ti-plus"></i> Add</button>` +
    `</div>`;
}

export function addDutyType() {
  const inp = document.getElementById('new-duty-input');
  const val = inp?.value.trim();
  if (!val) return;
  if (state.DUTY_TYPES.includes(val)) {
    showToast('Duty type already exists', 'error');
    return;
  }
  state.DUTY_TYPES.push(val);
  inp.value = '';
  renderDutiesPanel();
  saveState();
  saveConfig();
  showToast(`Added: ${val}`);
}

export function removeDutyType(idx) {
  const name = state.DUTY_TYPES[idx];
  if (name === undefined) return;
  const usedCount = state.DUTY_ASSIGNMENTS.filter(a => a.type === name).length;
  if (usedCount && !confirm(`"${name}" is assigned to ${usedCount} slot(s). Remove anyway?`)) return;
  state.DUTY_TYPES.splice(idx, 1);
  renderDutiesPanel();
  saveState();
  saveConfig();
  showToast(`Removed: ${name}`);
}
