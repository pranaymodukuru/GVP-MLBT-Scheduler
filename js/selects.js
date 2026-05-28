// ─────────────────────────────────────────────────────────────────────────────
// SELECT DROPDOWNS — populates class-select and teacher-select
// Lives in its own module so admin-view.js can import it without depending
// on app.js (which would create a circular dependency).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { SECTION_LABELS } from '../config/school-config.js';

/** Rebuild the class-select and teacher-select dropdowns from current state */
export function refreshSelects() {
  // ── Class select ──
  const cs   = document.getElementById('class-select');
  const prev = cs.value;
  cs.innerHTML = '';

  Object.entries(state.CLASS_CONFIG).forEach(([base, cfg]) => {
    const n = cfg.sections || 1;
    if (n <= 1) {
      const o = document.createElement('option');
      o.value = base;
      o.textContent = base;
      if (base === prev) o.selected = true;
      cs.appendChild(o);
    } else {
      const g = document.createElement('optgroup');
      g.label = base;
      SECTION_LABELS.slice(0, n).forEach(l => {
        const id = `${base} - ${l}`;
        const o  = document.createElement('option');
        o.value = id;
        o.textContent = `${base} — Section ${l}`;
        if (id === prev) o.selected = true;
        g.appendChild(o);
      });
      cs.appendChild(g);
    }
  });

  // ── Teacher select ──
  const ts    = document.getElementById('teacher-select');
  const prevT = ts.value;
  ts.innerHTML = '';

  state.TEACHERS.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name} (${t.id})`;
    if (t.id === prevT) o.selected = true;
    ts.appendChild(o);
  });

  // ── Subject select ──
  const ss    = document.getElementById('subject-select');
  const prevS = ss.value;
  ss.innerHTML = '';

  const allSubjects = [...new Set(
    Object.values(state.CLASS_CONFIG).flatMap(cfg => cfg.subjects || [])
  )].sort();

  allSubjects.forEach(s => {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    if (s === prevS) o.selected = true;
    ss.appendChild(o);
  });
}
