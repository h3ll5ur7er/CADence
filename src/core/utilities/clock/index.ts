/** Source of the current time, injectable so time-dependent workflows stay testable. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** A clock that advances by `stepMs` on every reading; for tests. */
export function steppingClock(start: string, stepMs = 1000): Clock {
  let next = Date.parse(start);
  return () => {
    const now = new Date(next);
    next += stepMs;
    return now;
  };
}
