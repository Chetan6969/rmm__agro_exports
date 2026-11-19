import { Redo2, Undo2, X } from 'lucide-react';
import { timeAgo, type FormCache } from '../lib/formCache';

/** Undo / Redo pair for a form header (hidden when read-only). */
export function UndoRedo({ cache }: { cache: FormCache }) {
  const btn = 'rounded p-1.5 text-slate-500 enabled:hover:bg-slate-100 enabled:hover:text-slate-800 disabled:opacity-30';
  return (
    <span className="flex items-center">
      <button type="button" tabIndex={-1} className={btn} onClick={cache.undo} disabled={!cache.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 className="size-4" />
      </button>
      <button type="button" tabIndex={-1} className={btn} onClick={cache.redo} disabled={!cache.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
        <Redo2 className="size-4" />
      </button>
    </span>
  );
}

/** Offers back a draft found in the browser from a previous visit. */
export function DraftBanner({ cache }: { cache: FormCache }) {
  if (cache.draftAt == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      <span>
        Unsaved changes from <b>{timeAgo(cache.draftAt)}</b> are kept on this device.
      </span>
      <span className="ml-auto flex items-center gap-2">
        <button type="button" className="rounded bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700" onClick={cache.restore}>
          Restore them
        </button>
        <button type="button" className="rounded p-1 text-amber-700 hover:bg-amber-100" onClick={cache.discard} title="Discard the saved draft" aria-label="Discard">
          <X className="size-4" />
        </button>
      </span>
    </div>
  );
}
