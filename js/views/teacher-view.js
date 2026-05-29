// ─────────────────────────────────────────────────────────────────────────────
// TEACHER VIEW — renders the per-teacher timetable grid + duty assignments
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { PERIODS, DAYS, WORK_PERIODS, SUBJECT_COLORS, SUBJECT_TEXT } from '../../config/school-config.js';
import { allSectionIds, isTeacherAvailable, isActivePeriod, shortSec, getGamesVenue } from '../helpers.js';
import { getSelectorValue } from '../selects.js';
import { showToast } from '../toast.js';
import { saveState } from '../persistence.js';

export function renderTeacherView() {
  const tid = getSelectorValue('teacher-select');
  if (!tid) return;

  const secs = allSectionIds();
  let filled = 0;
  const cc  = {}; // classes count
  const sc  = {}; // subjects count
  const csc = {}; // per-class subject counts: { sec: { subject: count } }

  const thead = `<tr><th>Period / Day</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr>`;
  let tbody = '';

  PERIODS.forEach(per => {
    // ── Break rows ──
    if (per.isBreak) {
      tbody +=
        `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>` +
        DAYS.map(() => `<td><div class="cell-break">${per.label}</div></td>`).join('') +
        `</tr>`;
      return;
    }

    tbody += `<tr><td>${per.label}<div class="period-label">${per.time}</div></td>`;

    DAYS.forEach(day => {
      // Collect all sections where this teacher is assigned this slot.
      // When multiple sections match, only treat them as combined (not conflict)
      // if they share the same subject — conflicts are flagged via conflictSet.
      const allMatches = [];
      secs.forEach(s => {
        if (!isActivePeriod(s, per.id)) return;
        const c = (state.timetable[s] || {})[day]?.[per.id];
        if (c?.teacherId === tid) allMatches.push({ cls: s, subject: c.subject, locked: c.locked });
      });
      // For display, group by subject so combined classes (same subject) stay together;
      // if there's a conflict (different subjects), show only the primary occurrence.
      const primarySubject = allMatches[0]?.subject;
      const matches = allMatches.length > 1
        ? allMatches.filter(f => f.subject === primarySubject)
        : allMatches;

      if (matches.length > 0) {
        filled++;
        matches.forEach(f => {
          cc[f.cls]     = (cc[f.cls]     || 0) + 1;
          sc[f.subject] = (sc[f.subject] || 0) + 1;
          if (!csc[f.cls]) csc[f.cls] = {};
          csc[f.cls][f.subject] = (csc[f.cls][f.subject] || 0) + 1;
        });

        const primary    = matches[0];
        const bg         = SUBJECT_COLORS[primary.subject] || '#f5f5f5';
        const tc         = SUBJECT_TEXT[primary.subject]   || '#333';
        const isConflict = matches.some(f => state.conflictSet.has(`${f.cls}|${day}|${per.id}`));
        const lockIcon   = primary.locked ? (per.id === 'P1' ? '📌' : '🔒') : '';
        const clsLabel   = matches.map(f => shortSec(f.cls)).join(' + ');
        const venue      = getGamesVenue(primary.cls, day, per.id);

        tbody +=
          `<td><div class="cell${primary.locked ? ' cell-locked' : ''}${isConflict ? ' cell-conflict' : ''}"` +
          ` style="background:${bg};color:${tc}"` +
          ` onclick="openEdit('${primary.cls}','${day}','${per.id}')"` +
          ` oncontextmenu="toggleCellLock('${primary.cls}','${day}','${per.id}',event)">` +
          (lockIcon ? `<span class="lock-badge">${lockIcon}</span>` : '') +
          `<span class="cell-subj">${primary.subject}</span>` +
          `<span class="cell-teacher">${clsLabel}</span>` +
          (venue ? `<span class="venue-badge venue-${venue.toLowerCase()}">${venue}</span>` : '') +
          `</div></td>`;
      } else {
        const dayBlocked    = !isTeacherAvailable(tid, day);
        const periodBlocked = !isTeacherAvailable(tid, day, per.id);
        if (dayBlocked || periodBlocked) {
          tbody +=
            `<td><div class="cell cell-empty"` +
            ` style="cursor:default${periodBlocked ? ';background:#fef2f2;border-color:#fca5a5;color:#dc2626' : ''}">` +
            `${dayBlocked ? '🚫' : '<span style="font-size:1.1em">⛔</span>'}</div></td>`;
        } else {
          // Check if a duty is assigned to this exact slot
          const duty = state.DUTY_ASSIGNMENTS.find(
            a => a.teacherId === tid && a.day === day && a.period === per.id
          );
          if (duty) {
            tbody +=
              `<td><div class="cell cell-duty" onclick="openDutyPicker('${tid}','${day}','${per.id}')">` +
              `<span class="cell-subj">${duty.type}</span>` +
              `<span class="cell-teacher">Duty</span>` +
              `</div></td>`;
          } else {
            tbody +=
              `<td><div class="cell cell-empty cell-duty-add" onclick="openDutyPicker('${tid}','${day}','${per.id}')">` +
              `<span class="duty-add-hint">+ duty</span>` +
              `</div></td>`;
          }
        }
      }
    });

    tbody += '</tr>';
  });

  document.getElementById('teacher-table').innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  document.getElementById('teacher-stats-badge').textContent = `${filled} periods/week`;
  document.getElementById('teacher-stats').innerHTML =
    `<div class="stat"><div class="stat-val">${filled}</div><div class="stat-lbl">Periods / week</div></div>` +
    `<div class="stat"><div class="stat-val">${Object.keys(cc).length}</div><div class="stat-lbl">Sections</div></div>` +
    `<div class="stat"><div class="stat-val">${Object.keys(sc).length}</div><div class="stat-lbl">Subjects taught</div></div>` +
    `<div class="stat"><div class="stat-val">${Math.round(filled / 6)}</div><div class="stat-lbl">Avg / day</div></div>`;

  document.getElementById('teacher-legend').innerHTML =
    Object.entries(cc)
      .sort((a, b) => b[1] - a[1])
      .map(([sec, count]) => {
        const subjItems = Object.entries(csc[sec] || {})
          .sort((a, b) => b[1] - a[1])
          .map(([subj, cnt]) =>
            `<span class="legend-item">` +
            `<span class="legend-dot" style="background:${SUBJECT_COLORS[subj] || '#eee'};border:1px solid ${SUBJECT_TEXT[subj] || '#999'}60"></span>${subj}` +
            ` <span class="legend-count">${cnt}</span></span>`
          ).join('');
        return (
          `<span class="legend-class-block">` +
          `<span class="legend-item">` +
          `<span class="legend-dot" style="background:#e5e7eb;border:1px solid #9ca3af60"></span><strong>${sec}</strong>` +
          ` <span class="legend-count">${count}</span></span>` +
          subjItems +
          `</span>`
        );
      }).join('');

  document.getElementById('teacher-duties').innerHTML = renderDutiesSection(tid);
}

// ─── Duty helpers ──────────────────────────────────────────────────────────────

function hasTimetableConflict({ teacherId, day, period }) {
  if (!teacherId) return false;
  return allSectionIds().some(secId =>
    (state.timetable[secId]?.[day]?.[period])?.teacherId === teacherId
  );
}

function renderDutiesSection(tid) {
  const myDuties = state.DUTY_ASSIGNMENTS.filter(a => a.teacherId === tid);
  const conflictCount = myDuties.filter(a => hasTimetableConflict(a)).length;

  const rows = myDuties.length
    ? myDuties.map(a => {
        const conflict = hasTimetableConflict(a);
        return (
          `<div class="duty-row${conflict ? ' duty-row-conflict' : ''}">` +
          `<span class="duty-type-tag">${a.type}</span>` +
          `<span class="duty-slot-info">${a.day} · ${a.period}</span>` +
          (conflict
            ? `<span class="duty-conflict-badge">&#9888; Class conflict — slot open for pickup</span>`
            : '') +
          `<button class="btn btn-sm duty-remove-btn" onclick="removeDutyAssignment('${a.id}')">Remove</button>` +
          `</div>`
        );
      }).join('')
    : `<div class="duty-empty-msg">No duties assigned to this teacher.</div>`;

  const addForm =
    `<div class="duty-add-row">` +
    `<select id="duty-type-sel" class="duty-sel">` +
    `<option value="">Select duty…</option>` +
    state.DUTY_TYPES.map(d => `<option value="${d}">${d}</option>`).join('') +
    `</select>` +
    `<select id="duty-day-sel" class="duty-sel">` +
    `<option value="">Day…</option>` +
    DAYS.map(d => `<option value="${d}">${d}</option>`).join('') +
    `</select>` +
    `<select id="duty-period-sel" class="duty-sel">` +
    `<option value="">Period…</option>` +
    WORK_PERIODS.map(p => `<option value="${p}">${p}</option>`).join('') +
    `</select>` +
    `<button class="btn btn-sm btn-primary" onclick="addDutyAssignment('${tid}')">` +
    `<i class="ti ti-plus"></i> Assign</button>` +
    `</div>`;

  const conflictBadge = conflictCount
    ? ` <span class="duty-conflict-count">${conflictCount} conflict${conflictCount > 1 ? 's' : ''}</span>`
    : '';

  return (
    `<div class="duty-panel">` +
    `<div class="duty-panel-header">` +
    `<span class="duty-panel-title"><i class="ti ti-clipboard-list"></i> Duty Assignments</span>` +
    `<span class="duty-panel-meta">${myDuties.length} assigned${conflictBadge}</span>` +
    `</div>` +
    rows +
    addForm +
    `</div>`
  );
}

// ─── Duty picker modal (cell-click assignment) ────────────────────────────────

let _pickerState = null; // { tid, day, period, existingId }

export function openDutyPicker(tid, day, period) {
  const existing = state.DUTY_ASSIGNMENTS.find(
    a => a.teacherId === tid && a.day === day && a.period === period
  );
  _pickerState = { tid, day, period, existingId: existing?.id ?? null };

  const title = existing ? `Update duty — ${day} · ${period}` : `Assign duty — ${day} · ${period}`;
  document.getElementById('duty-picker-title').textContent = title;
  document.getElementById('duty-picker-slot').textContent = '';

  const sel = document.getElementById('duty-picker-sel');
  sel.innerHTML = state.DUTY_TYPES.map(d =>
    `<option value="${d}"${existing?.type === d ? ' selected' : ''}>${d}</option>`
  ).join('');

  document.getElementById('duty-picker-remove-btn').style.display = existing ? '' : 'none';
  document.getElementById('duty-picker-save-btn').textContent = existing ? 'Update' : 'Assign';

  document.getElementById('duty-picker-modal').classList.add('open');
}

export function closeDutyPicker() {
  document.getElementById('duty-picker-modal').classList.remove('open');
  _pickerState = null;
}

export function saveDutyFromPicker() {
  if (!_pickerState) return;
  const { tid, day, period, existingId } = _pickerState;
  const type = document.getElementById('duty-picker-sel').value;
  if (!type) return;

  // Prevent assigning the same duty type to a slot already claimed by someone else
  const dup = state.DUTY_ASSIGNMENTS.find(
    a => a.type === type && a.day === day && a.period === period && a.id !== existingId
  );
  if (dup) { showToast('This duty slot is already assigned', 'error'); return; }

  if (existingId) {
    const a = state.DUTY_ASSIGNMENTS.find(x => x.id === existingId);
    if (a) a.type = type;
  } else {
    state.DUTY_ASSIGNMENTS.push({ id: `d${Date.now()}`, type, day, period, teacherId: tid });
  }

  saveState();
  closeDutyPicker();
  renderTeacherView();
  showToast(existingId ? 'Duty updated' : 'Duty assigned');
}

export function removeDutyFromPicker() {
  if (!_pickerState?.existingId) return;
  const idx = state.DUTY_ASSIGNMENTS.findIndex(a => a.id === _pickerState.existingId);
  if (idx !== -1) state.DUTY_ASSIGNMENTS.splice(idx, 1);
  saveState();
  closeDutyPicker();
  renderTeacherView();
  showToast('Duty removed');
}

// ─── Exported mutations (exposed on window.* in app.js) ───────────────────────

export function addDutyAssignment(tid) {
  const type   = document.getElementById('duty-type-sel')?.value;
  const day    = document.getElementById('duty-day-sel')?.value;
  const period = document.getElementById('duty-period-sel')?.value;

  if (!type || !day || !period) {
    showToast('Select a duty type, day, and period', 'error');
    return;
  }

  // Prevent the same duty type from being double-booked in the same slot
  const dup = state.DUTY_ASSIGNMENTS.find(
    a => a.type === type && a.day === day && a.period === period
  );
  if (dup) {
    showToast('This duty slot is already assigned', 'error');
    return;
  }

  state.DUTY_ASSIGNMENTS.push({ id: `d${Date.now()}`, type, day, period, teacherId: tid });
  saveState();
  renderTeacherView();
  showToast('Duty assigned');
}

export function removeDutyAssignment(id) {
  const idx = state.DUTY_ASSIGNMENTS.findIndex(a => a.id === id);
  if (idx === -1) return;
  state.DUTY_ASSIGNMENTS.splice(idx, 1);
  saveState();
  renderTeacherView();
  showToast('Duty removed');
}
