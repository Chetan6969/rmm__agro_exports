import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ErrorBox } from './ui';

const FOCUSABLE = 'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessible modal: traps focus, Esc closes, restores focus to the opener. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    document.body.dataset.modalOpen = '1';
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      delete document.body.dataset.modalOpen;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={`w-full ${width} rounded-lg bg-white shadow-xl`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab' && ref.current) {
            const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
            if (!els.length) return;
            const i = els.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && i <= 0) {
              e.preventDefault();
              els[els.length - 1].focus();
            } else if (!e.shiftKey && i === els.length - 1) {
              e.preventDefault();
              els[0].focus();
            }
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          <button type="button" tabIndex={-1} onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation, optionally asking for a mandatory reason (used for deletes). */
/** Save / Don't save / Cancel prompt shown when leaving a form with unsaved changes. */
export function UnsavedDialog({
  open,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title="Save your changes?"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} shortcut="esc">
            Cancel
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            Don’t save
          </Button>
          <Button variant="primary" loading={saving} onClick={onSave} shortcut="enter">
            Save
          </Button>
        </>
      }
    >
      <p className="text-slate-700">You have unsaved changes on this form. Save them before leaving, or discard them?</p>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requireReason,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setErr(null);
    }
  }, [open]);
  const submit = async () => {
    if (requireReason && !reason.trim()) return setErr(new Error('Please enter a reason: it is saved in the audit log.'));
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit} shortcut="enter">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        <div className="text-slate-700">{message}</div>
        {requireReason ? (
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Reason (kept in the audit log)</span>
            <input data-autofocus className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        ) : (
          <button type="submit" data-autofocus className="sr-only">
            confirm
          </button>
        )}
        {err != null && <ErrorBox error={err} />}
      </form>
    </Modal>
  );
}
