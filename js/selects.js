// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR BUTTONS — populates class-select, teacher-select, subject-select
// Lives in its own module so admin-view.js can import it without depending
// on app.js (which would create a circular dependency).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { SECTION_LABELS } from '../config/school-config.js';

/** Read the currently selected value from a btn-selector container */
export function getSelectorValue(id) {
  return document.getElementById(id)?.dataset.selected ?? '';
}

/** Programmatically select a value in a btn-selector container */
export function setSelectorValue(id, value) {
  const container = document.getElementById(id);
  if (!container) return;
  container.dataset.selected = value;
  container.querySelectorAll('.selector-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function makeBtn(value, label, callback) {
  const btn = document.createElement('button');
  btn.className = 'selector-btn';
  btn.dataset.value = value;
  btn.textContent = label;
  btn.onclick = () => {
    const container = btn.closest('.btn-selector');
    container.dataset.selected = value;
    container.querySelectorAll('.selector-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    callback();
  };
  return btn;
}

/** Rebuild all three btn-selector containers from current state */
export function refreshSelects() {
  // ── Class select ──
  const cs   = document.getElementById('class-select');
  const prev = cs.dataset.selected || '';
  cs.innerHTML = '';

  let firstClass = null;
  Object.entries(state.CLASS_CONFIG).forEach(([base, cfg]) => {
    const n = cfg.sections || 1;
    if (n <= 1) {
      const btn = makeBtn(base, base, () => window.renderClassView());
      if (!firstClass) firstClass = base;
      cs.appendChild(btn);
    } else {
      SECTION_LABELS.slice(0, n).forEach(l => {
        const id = `${base} - ${l}`;
        const btn = makeBtn(id, `${base}–${l}`, () => window.renderClassView());
        if (!firstClass) firstClass = id;
        cs.appendChild(btn);
      });
    }
  });

  const resolvedClass = (prev && cs.querySelector(`[data-value="${CSS.escape(prev)}"]`)) ? prev : firstClass;
  cs.dataset.selected = resolvedClass || '';
  if (resolvedClass) cs.querySelector(`[data-value="${CSS.escape(resolvedClass)}"]`)?.classList.add('active');

  // ── Teacher select ──
  const ts    = document.getElementById('teacher-select');
  const prevT = ts.dataset.selected || '';
  ts.innerHTML = '';

  state.TEACHERS.forEach(t => {
    ts.appendChild(makeBtn(t.id, `${t.name} (${t.id})`, () => window.renderTeacherView()));
  });

  const firstTeacher = state.TEACHERS[0]?.id || '';
  const resolvedTeacher = (prevT && ts.querySelector(`[data-value="${CSS.escape(prevT)}"]`)) ? prevT : firstTeacher;
  ts.dataset.selected = resolvedTeacher;
  if (resolvedTeacher) ts.querySelector(`[data-value="${CSS.escape(resolvedTeacher)}"]`)?.classList.add('active');

  // ── Subject select ──
  const ss    = document.getElementById('subject-select');
  const prevS = ss.dataset.selected || '';
  ss.innerHTML = '';

  const allSubjects = [...new Set(
    Object.values(state.CLASS_CONFIG).flatMap(cfg => cfg.subjects || [])
  )].sort();

  allSubjects.forEach(s => {
    ss.appendChild(makeBtn(s, s, () => window.renderSubjectView()));
  });

  const firstSubject = allSubjects[0] || '';
  const resolvedSubject = (prevS && ss.querySelector(`[data-value="${CSS.escape(prevS)}"]`)) ? prevS : firstSubject;
  ss.dataset.selected = resolvedSubject;
  if (resolvedSubject) ss.querySelector(`[data-value="${CSS.escape(resolvedSubject)}"]`)?.classList.add('active');
}
