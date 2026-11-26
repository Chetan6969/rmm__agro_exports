/**
 * Tracks how many modal-style overlays (Modal, CommandPalette) are open, as a reference count on
 * `document.body.dataset.modalOpen`. useHotkeys reads this flag to suspend page shortcuts while a
 * dialog is up. A plain boolean broke when overlays overlapped (one closing deleted the flag while
 * another was still open), which silently killed every Ctrl/Alt shortcut app-wide until reload.
 */
let count = 0;

function sync() {
  if (count > 0) document.body.dataset.modalOpen = String(count);
  else delete document.body.dataset.modalOpen;
}

export function pushModal() {
  count += 1;
  sync();
}

export function popModal() {
  count = Math.max(0, count - 1);
  sync();
}
