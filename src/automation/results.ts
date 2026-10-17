import type { Result } from '@core/contracts';

/** A refused command or a missing project, document or file; `code` is the core's error code. */
export class CadenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Where exported files go. */
export interface ExportTarget {
  /** Paths of the files written so far, oldest first. */
  readonly delivered: readonly string[];
  deliverNextTo(path: string): void;
}

/** A value, or the error of a result (with the ids of what is at fault, for agents). */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  const ids = result.error.involved ?? result.error.related;
  const related = ids?.length ? ` The ones involved: ${ids.join(', ')}.` : '';
  throw new CadenceError(result.error.code, `${result.error.message}${related}`);
}
