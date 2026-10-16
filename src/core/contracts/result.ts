/** Expected failures are values, not exceptions (see Conventions). */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface DomainError {
  readonly code: string;
  readonly message: string;
  /** Ids of what is at fault (e.g. the constraints a new one conflicts with), when the client can point at them. */
  readonly related?: readonly string[];
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E = DomainError>(error: E): Result<never, E> => ({ ok: false, error });
