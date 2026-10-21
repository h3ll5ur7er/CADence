/** What the MCP server's tools are made of: their shape and the JSON schemas of their arguments. */

import { CadenceError } from '../results';

/** Reports how far a long tool call has got (MCP progress notifications, when the client asked for them). */
export type Progress = (done: number, total: number, message: string) => void;

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** `signal` aborts when the client cancels the call. */
  run(args: Record<string, unknown>, progress: Progress, signal?: AbortSignal): Promise<unknown>;
}

/** A picture to look at with a line about it. */
export interface Captioned {
  readonly picture: Uint8Array;
  readonly caption: string;
}

export const string = (description: string) => ({ type: 'string', description });
export const number = (description: string) => ({ type: 'number', description });
export const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
export const point = (description: string) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });
export const object = (properties: Record<string, unknown>, required: readonly string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const projectArg = string('Project id or name (list_projects).');
export const documentArg = string('Document id (list_documents).');

export const point2 = (description: string) => ({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description });

/** Runs commands one by one; a refusal says which command and why (the ones before stay). */
export const runAll = async <T extends { type: string }>(commands: readonly T[], run: (command: T) => Promise<void>) => {
  for (const [index, command] of commands.entries()) {
    try {
      await run(command);
    } catch (error) {
      if (!(error instanceof CadenceError)) throw error;
      throw new CadenceError(error.code, `Command ${index + 1} (${command.type}) was refused: ${error.message}${index > 0 ? ` Commands 1 to ${index} were applied.` : ''}`);
    }
  }
};
