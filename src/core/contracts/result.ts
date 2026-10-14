/** Expected failures are values, not exceptions (see Conventions). */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface DomainError {
  readonly code: string;
  readonly message: string;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E = DomainError>(error: E): Result<never, E> => ({ ok: false, error });
