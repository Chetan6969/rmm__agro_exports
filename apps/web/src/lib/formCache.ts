import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';

/**
 * Form safety net: in-memory undo/redo plus a localStorage draft that survives
 * navigation and reloads, so an accidental cut/delete is never a dead end and
 * half-finished work is offered back when the user returns to the same form.
 *
 * Both work off one serialisable `snapshot` of the whole form (header + lines +
 * terms + … — whatever the caller passes). The caller gives an `apply(snapshot)`
 * that restores every piece of state from a snapshot.
 *
 * Native browser undo still handles character-level edits inside a focused text
 * box; this adds a form-level step for structural changes (a removed product, a
 * cleared lookup, a deleted term) and a visible Undo/Redo the user can click.
 */

const PREFIX = 'rmm.draft.';
const RECORD_DEBOUNCE = 400; // ms of calm before a change becomes an undo step
const SAVE_DEBOUNCE = 600; // ms before the draft is written to localStorage
const MAX_HISTORY = 100;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const stringify = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
};
const parse = <T,>(s: string): T => JSON.parse(s) as T;

function removeDraft(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* private mode / quota — ignore */
  }
}

/** True while the user is editing a text box that owns its own native undo. */
const inTextField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(type);
  }
  return false;
};

export interface FormCache {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Timestamp (ms) of a restorable draft newer than the saved record, else null. */
  draftAt: number | null;
  restore: () => void;
  discard: () => void;
  /** Drop the stored draft — call after a successful save. */
  clear: () => void;
}

export function useFormCache<T>(args: {
  /** Stable per record, e.g. `doc:commercialInvoices:new:`. null disables persistence (read-only). */
  storageKey: string | null;
  snapshot: T;
  apply: (snap: T, source: 'undo' | 'draft') => void;
  /** Becomes true once the initial values are loaded; nothing records before that. */
  ready: boolean;
  /** Only write a draft while the form has unsaved changes. */
  dirty: boolean;
  enabled?: boolean;
  /** updatedAt (ms) of the loaded record; drafts at/older than this are stale. */
  serverStamp?: number | null;
}): FormCache {
  const { storageKey, snapshot, apply, ready, dirty, enabled = true, serverStamp } = args;

  const entries = useRef<string[]>([]);
  const index = useRef(0);
  const applying = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, bump] = useReducer((c: number) => c + 1, 0);

  const json = enabled ? stringify(snapshot) : '';

  const commit = useCallback((j: string) => {
    if (!j || j === entries.current[index.current]) return;
    const next = entries.current.slice(0, index.current + 1);
    next.push(j);
    while (next.length > MAX_HISTORY) next.shift();
    entries.current = next;
    index.current = next.length - 1;
    bump();
  }, []);

  // Baseline: the first loaded state is history step 0.
  useEffect(() => {
    if (!enabled || !ready || !json || entries.current.length) return;
    entries.current = [json];
    index.current = 0;
    bump();
  }, [enabled, ready, json]);

  // Record a new undo step once edits settle.
  useEffect(() => {
    if (!enabled || !ready || !entries.current.length) return;
    if (applying.current) {
      applying.current = false;
      return;
    }
    if (json === entries.current[index.current]) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(json), RECORD_DEBOUNCE);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [json, enabled, ready, commit]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (json && json !== entries.current[index.current]) commit(json);
  }, [json, commit]);

  const step = useCallback(
    (dir: -1 | 1) => {
      flush();
      const target = index.current + dir;
      if (target < 0 || target >= entries.current.length) return;
      index.current = target;
      applying.current = true;
      apply(parse<T>(entries.current[target]), 'undo');
      bump();
    },
    [apply, flush],
  );

  const undo = useCallback(() => step(-1), [step]);
  const redo = useCallback(() => step(1), [step]);

  // Keyboard: Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y). Left to the browser
  // while a text box is focused, and silenced while a modal is open.
  const kb = useRef({ undo, redo, enabled });
  kb.current = { undo, redo, enabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!kb.current.enabled) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y';
      if (!isUndo && !isRedo) return;
      if (document.body.dataset.modalOpen) return;
      if (inTextField(e.target)) return; // native undo owns the text box
      e.preventDefault();
      e.stopPropagation();
      if (isUndo) kb.current.undo();
      else kb.current.redo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // -------------------------------------------------------------- draft persistence
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const draftJson = useRef<string | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (!enabled || !ready || !storageKey || checked.current) return;
    checked.current = true;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PREFIX + storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    let saved: { at: number; data: T };
    try {
      saved = parse<{ at: number; data: T }>(raw);
    } catch {
      removeDraft(storageKey);
      return;
    }
    const dj = stringify(saved.data);
    // Stale (record saved since) or identical to what just loaded → drop it.
    if ((serverStamp && saved.at <= serverStamp) || dj === entries.current[0] || !dj) {
      removeDraft(storageKey);
      return;
    }
    draftJson.current = dj;
    setDraftAt(saved.at);
  }, [enabled, ready, storageKey, serverStamp]);

  useEffect(() => {
    if (!enabled || !ready || !storageKey || !dirty || !json) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(PREFIX + storageKey, `{"at":${Date.now()},"data":${json}}`);
      } catch {
        /* ignore */
      }
    }, SAVE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [json, enabled, ready, storageKey, dirty]);

  // Reused component (e.g. "save & new") drops ready to false to reload — start over.
  useEffect(() => {
    if (ready) return;
    entries.current = [];
    index.current = 0;
    applying.current = false;
    checked.current = false;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    draftJson.current = null;
    setDraftAt(null);
    bump();
  }, [ready]);

  const restore = useCallback(() => {
    const dj = draftJson.current;
    if (dj) {
      applying.current = true;
      apply(parse<T>(dj), 'draft');
      commit(dj);
    }
    setDraftAt(null);
  }, [apply, commit]);

  const discard = useCallback(() => {
    if (storageKey) removeDraft(storageKey);
    draftJson.current = null;
    setDraftAt(null);
  }, [storageKey]);

  const clear = useCallback(() => {
    if (storageKey) removeDraft(storageKey);
    draftJson.current = null;
    setDraftAt(null);
  }, [storageKey]);

  return {
    canUndo: index.current > 0,
    canRedo: index.current < entries.current.length - 1,
    undo,
    redo,
    draftAt,
    restore,
    discard,
    clear,
  };
}

/** "just now", "3 min ago", "2 h ago", or a date — for the restore banner. */
export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleString();
}
