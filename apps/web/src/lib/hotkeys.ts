import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts.
 *
 * Combos look like "ctrl+s", "alt+n", "shift+?", "f2", "escape", "/".
 * "mod" = Ctrl on Windows/Linux, ⌘ on Mac.
 * By default shortcuts without a modifier are ignored while typing in an input,
 * so "/" or "n" never steal keystrokes from a form field. Pass { inInputs: true } to override.
 */
export interface HotkeyOptions {
  inInputs?: boolean;
  enabled?: boolean;
  /** Keep firing when a modal dialog is open (dialogs set data-modal-open on <body>). */
  inModal?: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const want = new Set(parts.map((p) => (p === 'mod' ? (isMac ? 'meta' : 'ctrl') : p)));
  if (want.has('ctrl') !== e.ctrlKey) return false;
  if (want.has('alt') !== e.altKey) return false;
  if (want.has('meta') !== e.metaKey) return false;
  // shift is implied for symbols like "?"; only enforce when listed or for letters
  if (want.has('shift') !== e.shiftKey && (want.has('shift') || /^[a-z]$/.test(key))) return false;
  const k = e.key.toLowerCase();
  if (k === key) return true;
  // Alt+letter yields special characters on some layouts; fall back to the physical key
  if (/^[a-z0-9]$/.test(key) && e.code.toLowerCase() === (/[0-9]/.test(key) ? `digit${key}` : `key${key}`)) return true;
  return (key === 'esc' && k === 'escape') || (key === 'del' && k === 'delete') || (key === 'enter' && k === 'enter');
}

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[] = [], opts: HotkeyOptions = {}) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (opts.enabled === false) return;
    const handler = (e: KeyboardEvent) => {
      if (!opts.inModal && document.body.dataset.modalOpen) return;
      // an open dropdown owns Enter/Escape/arrows
      if ((e.target as HTMLElement | null)?.dataset?.comboboxOpen && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      for (const [combo, fn] of Object.entries(ref.current)) {
        for (const c of combo.split(',').map((x) => x.trim())) {
          if (!matches(e, c)) continue;
          const hasMod = /(ctrl|alt|meta|mod)\+/.test(c) || /^f\d+$/.test(c) || c === 'esc' || c === 'escape';
          if (!opts.inInputs && !hasMod && isTyping(e.target)) continue;
          e.preventDefault();
          e.stopPropagation();
          fn(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.inInputs, opts.inModal, ...deps]);
}

/** Human label for a combo, e.g. "mod+s" → "Ctrl+S". */
export const keyLabel = (combo: string) =>
  combo
    .split('+')
    .map((p) => (p === 'mod' ? (isMac ? '⌘' : 'Ctrl') : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+');

/** Global shortcut reference, shown with F1. Screens add their own sections. */
export const SHORTCUTS: { section: string; items: [string, string][] }[] = [
  {
    section: 'Anywhere',
    items: [
      ['mod+k', 'Command palette: open any screen or action'],
      ['alt+c', 'Switch company'],
      ['f1', 'Show keyboard shortcuts'],
      ['alt+h', 'Go to home'],
      ['alt+l', 'Log out'],
    ],
  },
  {
    section: 'Lists',
    items: [
      ['/', 'Search'],
      ['↑ ↓', 'Move between rows'],
      ['enter', 'Open the selected row'],
      ['alt+n', 'New record'],
      ['del', 'Delete the selected row'],
      ['pageup pagedown', 'Previous / next page'],
      ['alt+e', 'Export to Excel (CSV)'],
      ['alt+1 … alt+3', 'Filter: all / own / shared'],
    ],
  },
  {
    section: 'Forms',
    items: [
      ['enter', 'Next field (like Tally)'],
      ['shift+enter', 'Previous field'],
      ['mod+s', 'Save'],
      ['mod+enter', 'Save (works inside text boxes too)'],
      ['esc', 'Close / back'],
      ['alt+d', 'Save current values as defaults for new records'],
      ['f2', 'Open the dropdown of the focused lookup field'],
    ],
  },
];
