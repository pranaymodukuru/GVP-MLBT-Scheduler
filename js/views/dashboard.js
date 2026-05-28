// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD VIEW — teacher workload, schedule issues, class coverage
// Note: jumpToSlot lives in app.js (it calls switchTab which would be circular)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { DAYS, WORK_PERIODS } from '../../config/school-config.js';
import { allSectionIds, parseSection, isSatHalf, getSubjects } from '../helpers.js';

/** Compute all dashboard statistics from current state (pure data, no DOM). */
export function computeDashboardStats() {
  const ds = {
    totalSlots:     0,
    filledSlots:    0,
    emptySlots:     0,
    unassignedSlots: 0,
    byTeacher:      {},
    byClass:        {},
    emptyList:      [],
    unassignedList: [],
    belowMinList:   [],
    missingDailyList: [],
  };

  state.TEACHERS.forEach(t => {
    ds.byTeacher[t.id] = { id: t.id, name: t.name, periods: 0, byDay: {} };
    DAYS.forEach(d => { ds.byTeacher[t.id].byDay[d] = 0; });
  });

  allSectionIds().forEach(secId => {
    const { base } = parseSection(secId);
    const half      = isSatHalf(secId);
    ds.byClass[secId] = { total: 0, filled: 0, empty: 0, unassigned: 0 };

    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
      if (p === 'P8' && ['PP1', 'PP2'].includes(base)) return;

      ds.totalSlots++;
      ds.byClass[secId].total++;

      const cell = (state.timetable[secId] || {})[d]?.[p];
      if (!cell || !cell.subject) {
        ds.emptySlots++;
        ds.byClass[secId].empty++;
        ds.emptyList.push({ secId, day: d, period: p });
      } else if (!cell.teacherId) {
        ds.unassignedSlots++;
        ds.byClass[secId].unassigned++;
        ds.unassignedList.push({ secId, day: d, period: p, subject: cell.subject });
      } else {
        ds.filledSlots++;
        ds.byClass[secId].filled++;
        if (ds.byTeacher[cell.teacherId]) {
          ds.byTeacher[cell.teacherId].periods++;
          ds.byTeacher[cell.teacherId].byDay[d]++;
        }
      }
    }));
  });

  // Check mustAppearDaily subjects
  if (state.SUBJECT_MUST_APPEAR_DAILY) {
    allSectionIds().forEach(secId => {
      const { base } = parseSection(secId);
      const half     = isSatHalf(secId);
      const subjects = getSubjects(secId);
      const dayCount = {};
      DAYS.forEach(d => {
        dayCount[d] = {};
        WORK_PERIODS.forEach(p => {
          if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
          const cell = (state.timetable[secId] || {})[d]?.[p];
          if (cell?.subject) dayCount[d][cell.subject] = (dayCount[d][cell.subject] || 0) + 1;
        });
      });
      subjects.forEach(subj => {
        if (!state.SUBJECT_MUST_APPEAR_DAILY[subj]) return;
        const missingDays = DAYS.filter(d => !(dayCount[d][subj] > 0));
        if (missingDays.length) ds.missingDailyList.push({ secId, subject: subj, missingDays });
      });
    });
  }

  // Check subject minimums per section
  if (state.SUBJECT_MIN_FREQ) {
    allSectionIds().forEach(secId => {
      const { base } = parseSection(secId);
      const half     = isSatHalf(secId);
      const subjects = getSubjects(secId);
      const count    = {};
      DAYS.forEach(d => WORK_PERIODS.forEach(p => {
        if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
        const cell = (state.timetable[secId] || {})[d]?.[p];
        if (cell?.subject) count[cell.subject] = (count[cell.subject] || 0) + 1;
      }));
      subjects.forEach(subj => {
        const min    = state.SUBJECT_MIN_FREQ[subj];
        if (!min) return;
        const actual = count[subj] || 0;
        if (actual < min) ds.belowMinList.push({ secId, subject: subj, actual, min });
      });
    });
  }

  return ds;
}

/** Render the full Dashboard tab. */
export function renderDashboard() {
  const ds      = computeDashboardStats();
  const fillPct = ds.totalSlots > 0 ? Math.round(ds.filledSlots / ds.totalSlots * 100) : 0;

  // ── Summary stats ──────────────────────────────────────────────────────────
  document.getElementById('dash-stats').innerHTML =
    `<div class="stat">` +
      `<div class="stat-val" style="color:${fillPct >= 95 ? '#16a34a' : fillPct >= 80 ? '#d97706' : '#dc2626'}">${fillPct}%</div>` +
      `<div class="stat-lbl">Fill Rate</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val" style="color:#16a34a">${ds.filledSlots}</div>` +
      `<div class="stat-lbl">Filled Periods</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val" style="color:${ds.emptySlots ? '#6b7280' : '#16a34a'}">${ds.emptySlots}</div>` +
      `<div class="stat-lbl">Empty Slots</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val" style="color:${ds.unassignedSlots ? '#d97706' : '#16a34a'}">${ds.unassignedSlots}</div>` +
      `<div class="stat-lbl">Need a Teacher</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val" style="color:${state.conflictRecords.length ? '#dc2626' : '#16a34a'}">${state.conflictRecords.length}</div>` +
      `<div class="stat-lbl">Conflicts</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val" style="color:${ds.missingDailyList.length ? '#dc2626' : '#16a34a'}">${ds.missingDailyList.length}</div>` +
      `<div class="stat-lbl">Missing Daily</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val" style="color:${ds.belowMinList.length ? '#ea580c' : '#16a34a'}">${ds.belowMinList.length}</div>` +
      `<div class="stat-lbl">Below Min</div></div>` +
    `<div class="stat">` +
      `<div class="stat-val">${ds.totalSlots}</div>` +
      `<div class="stat-lbl">Total Slots</div></div>`;

  // ── Teacher workload bars ──────────────────────────────────────────────────
  const sorted = Object.values(ds.byTeacher).sort((a, b) => b.periods - a.periods);
  const wlMax  = 48; // theoretical max: 8 periods × 6 days
  document.getElementById('dash-workload').innerHTML = sorted.map(t => {
    const pct   = Math.min(100, (t.periods / wlMax) * 100);
    const avg   = (t.periods / 6).toFixed(1);
    const cls   = t.periods < 10 ? 'wl-low' : t.periods <= 30 ? 'wl-ok' : t.periods <= 40 ? 'wl-high' : 'wl-over';
    const label = t.name.split(' ').slice(-2).join(' ');
    return (
      `<div class="workload-row">` +
      `<span class="workload-name" title="${t.name}">${label}</span>` +
      `<span class="workload-count">${t.periods}</span>` +
      `<div class="workload-bar-bg"><div class="workload-bar ${cls}" style="width:${pct}%"></div></div>` +
      `<span class="workload-avg">${avg}/day</span>` +
      `</div>`
    );
  }).join('');

  // ── Issues panel ───────────────────────────────────────────────────────────
  let html = '';

  if (ds.missingDailyList.length) {
    html += `<div class="issue-section">🔴 Missing Daily (${ds.missingDailyList.length})</div>`;
    html += ds.missingDailyList.map(u =>
      `<div class="issue-item issue-missing-daily">` +
      `<div><strong>${u.subject}</strong> in <strong>${u.secId}</strong><br>` +
      `<span style="color:#6b7280;font-size:11px">Not scheduled on: ${u.missingDays.join(', ')}</span></div>` +
      `</div>`
    ).join('');
  }

  if (ds.belowMinList.length) {
    html += `<div class="issue-section">🟠 Below Minimum (${ds.belowMinList.length})</div>`;
    html += ds.belowMinList.map(u =>
      `<div class="issue-item issue-below-min">` +
      `<div><strong>${u.subject}</strong> in <strong>${u.secId}</strong><br>` +
      `<span style="color:#6b7280;font-size:11px">${u.actual} assigned, min ${u.min}/week</span></div>` +
      `</div>`
    ).join('');
  }

  if (state.conflictRecords.length) {
    html += `<div class="issue-section">🔴 Conflicts (${state.conflictRecords.length})</div>`;
    html += state.conflictRecords.map(c =>
      `<div class="issue-item issue-conflict" onclick="jumpToSlot('${c.sec1}','${c.day}','${c.period}')">` +
      `<div><strong>${c.teacherName}</strong><span style="color:#9ca3af"> ${c.day} ${c.period}</span><br>` +
      `<span style="color:#6b7280;font-size:11px">${c.sec1} &amp; ${c.sec2}</span></div>` +
      `<span class="issue-arrow">→</span></div>`
    ).join('');
  }

  if (ds.unassignedSlots) {
    html += `<div class="issue-section">🟡 Need a Teacher (${ds.unassignedSlots})</div>`;
    html += ds.unassignedList.map(u =>
      `<div class="issue-item issue-unassigned" onclick="jumpToSlot('${u.secId}','${u.day}','${u.period}')">` +
      `<div><strong>${u.subject}</strong><span style="color:#9ca3af"> ${u.day} ${u.period}</span><br>` +
      `<span style="color:#6b7280;font-size:11px">${u.secId}</span></div>` +
      `<span class="issue-arrow">→</span></div>`
    ).join('');
  }

  if (ds.emptySlots) {
    html += `<div class="issue-section">⬜ Empty Slots (${ds.emptySlots})</div>`;
    html += ds.emptyList.map(u =>
      `<div class="issue-item issue-empty" onclick="jumpToSlot('${u.secId}','${u.day}','${u.period}')">` +
      `<div><span style="color:#374151;font-weight:500">${u.secId}</span>` +
      `<span style="color:#9ca3af"> ${u.day} ${u.period}</span></div>` +
      `<span class="issue-arrow">→</span></div>`
    ).join('');
  }

  if (!html) {
    html = `<div style="padding:3rem;text-align:center;color:#16a34a;font-size:14px;font-weight:500">` +
           `✅ No issues — schedule is fully covered!</div>`;
  }
  document.getElementById('dash-issues').innerHTML = html;

  // ── Class coverage table ───────────────────────────────────────────────────
  const perfect = Object.values(ds.byClass).filter(c => c.empty === 0 && c.unassigned === 0).length;
  document.getElementById('dash-coverage-summary').textContent =
    `${perfect} / ${Object.keys(ds.byClass).length} classes fully scheduled`;

  const rows = Object.entries(ds.byClass).map(([secId, c]) => {
    const pct   = c.total > 0 ? Math.round(c.filled / c.total * 100) : 0;
    const color = c.empty === 0 && c.unassigned === 0 ? '#4ade80' : pct >= 80 ? '#fbbf24' : '#f87171';
    const icon  = c.empty === 0 && c.unassigned === 0 ? '✅' : pct >= 80 ? '⚠️' : '❌';
    return (
      `<tr>` +
      `<td>${secId}</td>` +
      `<td style="text-align:center">${c.total}</td>` +
      `<td style="text-align:center;color:#16a34a;font-weight:600">${c.filled}</td>` +
      `<td style="text-align:center;color:${c.empty ? '#dc2626' : '#9ca3af'}">${c.empty}</td>` +
      `<td style="text-align:center;color:${c.unassigned ? '#d97706' : '#9ca3af'}">${c.unassigned}</td>` +
      `<td style="min-width:100px">` +
        `<div style="display:flex;align-items:center;gap:6px">` +
          `<div style="flex:1;background:#f3f4f6;border-radius:3px;height:6px;overflow:hidden">` +
            `<div style="background:${color};width:${pct}%;height:100%;border-radius:3px"></div>` +
          `</div>` +
          `<span style="font-size:11px;color:#6b7280;width:32px">${pct}%</span>` +
        `</div>` +
      `</td>` +
      `<td style="text-align:center">${icon}</td>` +
      `</tr>`
    );
  }).join('');

  document.getElementById('dash-coverage').innerHTML =
    `<thead><tr>` +
    `<th style="text-align:left">Class</th>` +
    `<th>Total</th><th>Filled</th><th>Empty</th><th>No Teacher</th>` +
    `<th style="text-align:left;min-width:120px">Fill Rate</th>` +
    `<th></th>` +
    `</tr></thead><tbody>${rows}</tbody>`;
}
