import { useEffect } from 'react';
import { useBlocker } from 'react-router';

/**
 * Guards a form with unsaved changes:
 *  - blocks in-app navigation (back arrow, sidebar links, Ctrl+K jumps, Esc) while `dirty`,
 *    so the caller can pop a Save / Don't save / Cancel dialog;
 *  - warns the browser on tab close / refresh / window close via `beforeunload`.
 * The localStorage draft (useFormCache) is the recovery net if they leave anyway.
 */
export function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return blocker;
}
