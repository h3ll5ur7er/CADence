export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, data?: unknown): void;
}

export const consoleLogger: Logger = {
  log(level, message, data) {
    const line = `[cadence] ${message}`;
    if (data === undefined) console[level](line);
    else console[level](line, data);
  },
};

/** Runs `work` and records its duration as a performance measure named `name`. */
export async function measured<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    performance.measure(name, { start, end: performance.now() });
  }
}
