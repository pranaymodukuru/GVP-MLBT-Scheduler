// ─────────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATION — no dependencies
// ─────────────────────────────────────────────────────────────────────────────

let _tt;

/**
 * Show a brief notification at the bottom-right of the screen.
 * @param {string} msg    Text to display
 * @param {'success'|'error'} type  Visual style
 */
export function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type !== 'success' ? ' toast-' + type : '') + ' show';
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 3000);
}
