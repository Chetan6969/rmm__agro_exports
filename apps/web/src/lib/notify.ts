import { toast } from 'sonner';
import { errorHint, errorMessage } from './api';

/** Error toast that always tells the user what to do next. */
export function showError(e: unknown) {
  toast.error(errorMessage(e), { description: errorHint(e) });
}

/** For problems detected in the browser before calling the server. */
export function showProblem(message: string, hint: string) {
  toast.error(message, { description: hint });
}
