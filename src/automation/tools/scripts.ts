import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ProjectId } from '@core/contracts';
import { type Cadence, unwrap } from '../api';
import { CadenceError } from '../results';
import { runGenerator, runScript, type ScriptRun, type ScriptSandbox } from '../script';
import { number, object, projectArg, string, type Tool } from './schema';

/** Whole scripts in the sandbox, and the scripts and plugins kept with projects (CAD-171, CAD-174). */
export function scriptTools(cadence: Cadence, exportsFolder: string | undefined, sandbox?: ScriptSandbox): Tool[] {
  /** Scripts write files only in the exports folder; a relative path lies in it. */
  const checkPath = (path: string) => {
    if (!exportsFolder) throw new Error('Scripts write files to the exports folder: give no path.');
    const full = resolve(exportsFolder, path);
    const inside = relative(exportsFolder, full);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`Scripts write files only in the exports folder (${exportsFolder}), not to ${path}.`);
    return full;
  };
  /** A run as an answer; a failed one is an error that still tells what was printed and touched. */
  const answer = (run: ScriptRun) => {
    const { output, documents, seconds } = run;
    if (run.ok) return { value: run.value ?? null, output, documents, seconds };
    throw new CadenceError(run.reason, `The script failed: ${run.error}\n${JSON.stringify({ output, documents, seconds }, null, 2)}`);
  };
  return [
    {
      name: 'run_script',
      description:
        'Runs a whole script against the scripting API in one call: loops and calculations without a call per step (ten parts, dimensions on every sheet). The script is the body of an async function: `cadence` is the API (every call returns a promise: await it; resource cadence://reference/scripts lists it), `args` your arguments, `console.log` prints; `return` gives the answer. It runs sandboxed (no files but exports, no network) within a time limit, and answers with its value, what it printed and the documents it created, changed or deleted. With project and generator instead of script, runs a script kept with the project or a plugin generator ("<plugin id>/<generator>") with parameters.',
      inputSchema: object({
        script: string('The script: the body of an async function, e.g. const doc = (await cadence.projects.createDocument(projectId, "component")).value; …; return doc.id;'),
        arguments: { description: 'Any JSON, given to the script as `args`.' },
        project: projectArg,
        generator: string('With project: the name of a kept script, or "<plugin id>/<generator>".'),
        parameters: { type: 'object', description: "With generator: its parameters' values (the defaults otherwise)." },
        seconds: number('Time limit (120 by default, at most 600).'),
      }),
      run: async (args, _progress, signal) => {
        const timeLimit = Math.min(600, Math.max(1, args['seconds'] === undefined ? 120 : Number(args['seconds']))) * 1000;
        const options = { timeLimit, checkPath, ...(signal ? { signal } : {}), ...(sandbox ? { sandbox } : {}) };
        if (typeof args['generator'] === 'string') {
          if (typeof args['project'] !== 'string') throw new CadenceError('usage', 'A generator belongs to a project: give project too.');
          return answer(await runGenerator(cadence, args['project'], args['generator'], (args['parameters'] ?? {}) as Record<string, unknown>, options));
        }
        if (typeof args['script'] !== 'string') throw new CadenceError('usage', 'Give a script, or a project and a generator.');
        const project = typeof args['project'] === 'string' ? await cadence.project(args['project']) : undefined;
        return answer(await runScript(cadence, args['script'], { ...options, args: args['arguments'] ?? null, ...(project ? { project } : {}) }));
      },
    },
    {
      name: 'list_scripts',
      description: "The scripts kept with a project (with their parameters) and its plugins: each plugin's features (for add-feature with type \"plugin\"), generators (run_script) and exporters (export_component).",
      inputSchema: object({ project: projectArg }, ['project']),
      run: async (args) => {
        const project = await cadence.projects.findProject((await cadence.project(String(args['project']))).id);
        return {
          scripts: (project?.scripts ?? []).map(({ id, name, parameters }) => ({ id, name, parameters })),
          plugins: (project?.plugins ?? []).map(({ source: _, ...plugin }) => plugin),
        };
      },
    },
    {
      name: 'install_plugin',
      description:
        'Installs a plugin (one JavaScript file, *.cadence-plugin.js) into a project, in place of an older version of it. Its features, generators and exporters can be used then; its features regenerate wherever the project goes.',
      inputSchema: object({ project: projectArg, path: string('Path of the plugin file on this computer.') }, ['project', 'path']),
      run: async (args) => {
        const project = await cadence.project(String(args['project']));
        const { source: _, ...plugin } = unwrap(await cadence.projects.installPlugin(project.id as ProjectId, await readFile(String(args['path']), 'utf8')));
        cadence.forget();
        return plugin;
      },
    },
  ];
}
