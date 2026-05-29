// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD VIEW — teacher workload, schedule issues, class coverage
// Note: jumpToSlot lives in app.js (it calls switchTab which would be circular)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from '../state.js';
import { DAYS, WORK_PERIODS, NO_P8_CLASSES } from '../../config/school-config.js';
import { allSectionIds, parseSection, isSatHalf, getSubjects, isTeacherAvailable } from '../helpers.js';

/** Compute all dashboard statistics from current state (pure data, no DOM). */
export function computeDashboardStats() {
  const ds = {
    totalSlots:     0,
    filledSlots:    0,
    emptySlots:     0,
    unassignedSlots: 0,
    unavailableSlots: 0,
    byTeacher:      {},
    byClass:        {},
    emptyList:      [],
    unassignedList: [],
    unavailableList: [],
    belowMinList:   [],
    missingDailyList: [],
    openDutyList:   [],
  };

  state.TEACHERS.forEach(t => {
    let availableSlots = 0;
    DAYS.forEach(d => {
      WORK_PERIODS.forEach(p => {
        if (isTeacherAvailable(t.id, d, p)) availableSlots++;
      });
    });
    ds.byTeacher[t.id] = { id: t.id, name: t.name, periods: 0, availableSlots, byDay: {}, sections: new Set() };
    DAYS.forEach(d => { ds.byTeacher[t.id].byDay[d] = 0; });
  });

  // Track (teacherId|day|period) already counted to avoid double-counting combined classes
  const countedTeacherSlots = new Set();

  allSectionIds().forEach(secId => {
    const { base } = parseSection(secId);
    const half      = isSatHalf(secId);
    ds.byClass[secId] = { total: 0, filled: 0, empty: 0, unassigned: 0 };

    DAYS.forEach(d => WORK_PERIODS.forEach(p => {
      if (d === 'Sat' && half && ['P7', 'P8'].includes(p)) return;
      if (p === 'P8' && NO_P8_CLASSES.includes(base)) return;

      ds.totalSlots++;
      ds.byClass[secId].total++;

      const cell = (state.timetable[secId] || {})[d]?.[p];
      if (!cell || !cell.subject) {
        ds.emptySlots++;
        ds.byClass[secId].empty++;
        ds.emptyList.push({ secId, day: d, period: p });
      } else if (!cell.teacherId && cell.subject !== 'Free Period') {
        ds.unassignedSlots++;
        ds.byClass[secId].unassigned++;
        ds.unassignedList.push({ secId, day: d, period: p, subject: cell.subject });
      } else if (cell.teacherId && !isTeacherAvailable(cell.teacherId, d, p)) {
        ds.unavailableSlots++;
        ds.filledSlots++;
        ds.byClass[secId].filled++;
        const teacherName = state.TEACHERS.find(t => t.id === cell.teacherId)?.name || 'Unknown';
        ds.unavailableList.push({ secId, day: d, period: p, subject: cell.subject, teacherName });
      } else {
        ds.filledSlots++;
        ds.byClass[secId].filled++;
        if (ds.byTeacher[cell.teacherId]) {
          ds.byTeacher[cell.teacherId].sections.add(secId);
          const slotKey = `${cell.teacherId}|${d}|${p}`;
          if (!countedTeacherSlots.has(slotKey)) {
            countedTeacherSlots.add(slotKey);
            ds.byTeacher[cell.teacherId].periods++;
            ds.byTeacher[cell.teacherId].byDay[d]++;
          }
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

  // Open duties: unassigned or teacher has a timetable conflict in that slot
  (state.DUTY_ASSIGNMENTS || []).forEach(a => {
    const conflicted = a.teacherId && allSectionIds().some(secId =>
      (state.timetable[secId]?.[a.day]?.[a.period])?.teacherId === a.teacherId
    );
    if (!a.teacherId || conflicted) {
      const teacherName = a.teacherId
        ? (state.TEACHERS.find(t => t.id === a.teacherId)?.name || 'Unknown')
        : null;
      ds.openDutyList.push({ ...a, conflicted: !!conflicted, teacherName });
    }
  });

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
  const header =
    `<div class="workload-header">` +
      `<span class="workload-name wl-hdr-cell">Teacher</span>` +
      `<span class="workload-count wl-hdr-cell"></span>` +
      `<div style="width:220px;flex-shrink:0" class="wl-hdr-cell">Workload</div>` +
      `<div class="workload-stats">` +
        `<span class="wl-stat wl-hdr-cell">Periods</span>` +
        `<span class="wl-stat wl-hdr-cell">Avg / Day</span>` +
        `<span class="wl-stat wl-hdr-cell">Sections</span>` +
        `<span class="wl-stat wl-hdr-cell">Active Days</span>` +
        `<span class="wl-stat wl-hdr-cell">Utilized</span>` +
      `</div>` +
    `</div>`;

  document.getElementById('dash-workload').innerHTML = header + sorted.map(t => {
    const cap      = t.availableSlots || 1;
    const ratio    = t.periods / cap;
    const pct      = Math.min(100, ratio * 100);
    const utilPct  = Math.round(ratio * 100);
    const cls      = ratio < 0.4 ? 'wl-low' : ratio <= 0.7 ? 'wl-ok' : ratio <= 0.9 ? 'wl-high' : 'wl-over';
    const avgDay   = (t.periods / 6).toFixed(1);
    const secCount = t.sections.size;
    const activeDays = Object.values(t.byDay).filter(n => n > 0).length;
    return (
      `<div class="workload-row">` +
        `<span class="workload-name" title="${t.name}">${t.name}</span>` +
        `<span class="workload-count">${t.periods}</span>` +
        `<div class="workload-bar-bg"><div class="workload-bar ${cls}" style="width:${pct}%"></div></div>` +
        `<div class="workload-stats">` +
          `<span class="wl-stat">${t.periods}<em>/${t.availableSlots}</em></span>` +
          `<span class="wl-stat">${avgDay}</span>` +
          `<span class="wl-stat">${secCount}</span>` +
          `<span class="wl-stat">${activeDays}</span>` +
          `<span class="wl-stat"><span class="wl-badge ${cls}">${utilPct}%</span></span>` +
        `</div>` +
      `</div>`
    );
  }).join('');

  // ── Issues panel ───────────────────────────────────────────────────────────
  const totalIssues = state.conflictRecords.length + ds.missingDailyList.length +
                      ds.belowMinList.length + ds.unassignedSlots + ds.emptySlots +
                      ds.openDutyList.length + ds.unavailableSlots;

  function issueCards(items, fn) {
    return `<div class="issue-cards">${items.map(fn).join('')}</div>`;
  }

  const conflictCards = state.conflictRecords.length ? issueCards(state.conflictRecords, c =>
    `<div class="issue-card ic-conflict" onclick="jumpToSlot('${c.sec1}','${c.day}','${c.period}')">` +
      `<div class="ic-label">${c.sec1} &amp; ${c.sec2}</div>` +
      `<div class="ic-title">${c.teacherName}</div>` +
      `<div class="ic-sub">${c.day} · ${c.period}</div>` +
    `</div>`) : '';

  const missingCards = ds.missingDailyList.length ? issueCards(ds.missingDailyList, u =>
    `<div class="issue-card ic-missing">` +
      `<div class="ic-label">${u.secId}</div>` +
      `<div class="ic-title">${u.subject}</div>` +
      `<div class="ic-sub">Missing: ${u.missingDays.join(', ')}</div>` +
    `</div>`) : '';

  const belowMinCards = ds.belowMinList.length ? issueCards(ds.belowMinList, u =>
    `<div class="issue-card ic-belowmin">` +
      `<div class="ic-label">${u.secId}</div>` +
      `<div class="ic-title">${u.subject}</div>` +
      `<div class="ic-sub">${u.actual} periods · min ${u.min}/week</div>` +
    `</div>`) : '';

  const noTeacherCards = ds.unassignedSlots ? issueCards(ds.unassignedList, u =>
    `<div class="issue-card ic-noteacher" onclick="jumpToSlot('${u.secId}','${u.day}','${u.period}')">` +
      `<div class="ic-label">${u.secId}</div>` +
      `<div class="ic-title">${u.subject}</div>` +
      `<div class="ic-sub">${u.day} · ${u.period}</div>` +
    `</div>`) : '';

  const emptyCards = ds.emptySlots ? issueCards(ds.emptyList, u =>
    `<div class="issue-card ic-empty" onclick="jumpToSlot('${u.secId}','${u.day}','${u.period}')">` +
      `<div class="ic-label">${u.secId}</div>` +
      `<div class="ic-title">${u.day} · ${u.period}</div>` +
      `<div class="ic-sub">No subject assigned</div>` +
    `</div>`) : '';

  const openDutyCards = ds.openDutyList.length ? issueCards(ds.openDutyList, u =>
    `<div class="issue-card ic-duty">` +
      `<div class="ic-label">${u.type}</div>` +
      `<div class="ic-title">${u.day} · ${u.period}</div>` +
      `<div class="ic-sub">${u.conflicted
        ? `&#9888; ${u.teacherName} has a class — needs pickup`
        : 'Unassigned — open for pickup'}</div>` +
    `</div>`) : '';

  const unavailCards = ds.unavailableSlots ? issueCards(ds.unavailableList, u =>
    `<div class="issue-card ic-unavail" onclick="jumpToSlot('${u.secId}','${u.day}','${u.period}')">` +
      `<div class="ic-label">${u.secId}</div>` +
      `<div class="ic-title">${u.teacherName} · ${u.subject}</div>` +
      `<div class="ic-sub">${u.day} · ${u.period} — teacher unavailable</div>` +
    `</div>`) : '';

  function issueGroup(title, count, colorCls, cards) {
    if (!count) return `<div class="issue-group ig-empty"><div class="ig-head ${colorCls}"><span class="ig-title">${title}</span><span class="ig-count">0</span></div><div class="ig-ok">All clear</div></div>`;
    return `<div class="issue-group"><div class="ig-head ${colorCls}"><span class="ig-title">${title}</span><span class="ig-count">${count}</span></div>${cards}</div>`;
  }

  const issuesHtml = totalIssues === 0
    ? `<div class="issues-all-clear">✅ No issues — schedule is fully covered!</div>`
    : `<div class="issues-grid">` +
        issueGroup('Conflicts', state.conflictRecords.length, 'igc-conflict', conflictCards) +
        issueGroup('Unavailable Teacher', ds.unavailableSlots, 'igc-unavail', unavailCards) +
        issueGroup('Missing Daily', ds.missingDailyList.length, 'igc-missing', missingCards) +
        issueGroup('Below Minimum', ds.belowMinList.length, 'igc-belowmin', belowMinCards) +
        issueGroup('No Teacher', ds.unassignedSlots, 'igc-noteacher', noTeacherCards) +
        issueGroup('Empty Slots', ds.emptySlots, 'igc-empty', emptyCards) +
        issueGroup('Open Duties', ds.openDutyList.length, 'igc-duty', openDutyCards) +
      `</div>`;

  document.getElementById('dash-issues').innerHTML = issuesHtml;

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
