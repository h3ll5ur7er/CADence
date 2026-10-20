import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ConflictChoice, DocumentId, RemoteCredentials } from '@core/contracts';
import type { Cadence, ExportTarget } from '../api';
import { CadenceError, unwrap } from '../results';
import { templates } from '../templates';
import { documentArg, object, projectArg, string, type Tool } from './schema';

/** Git sign-in from the environment, as on the command line; agents never see it. */
function credentials(env: NodeJS.ProcessEnv): RemoteCredentials | undefined {
  const [username, password] = [env['CADENCE_GIT_USERNAME'], env['CADENCE_GIT_PASSWORD']];
  return username || password ? { username: username ?? '', password: password ?? '' } : undefined;
}

/**
 * What the app's home page, project menu and history do, for agents (CAD-124): projects renamed,
 * deleted, copied, made from templates, archived and restored; versions; git.
 */
export function projectTools(cadence: Cadence, env: NodeJS.ProcessEnv = process.env): Tool[] {
  const exports: ExportTarget = cadence.exports;
  const projectId = async (args: Record<string, unknown>) => (await cadence.project(String(args['project']))).id;
  const brief = ({ id, name, documentCount }: { id: string; name: string; documentCount: number }) => ({ id, name, documentCount });
  return [
    {
      name: 'create_project_from_template',
      description: `A new project from a template, its parameters and parts ready to change. Templates: ${templates.map((t) => `${t.id} (${t.description})`).join('; ')}`,
      inputSchema: object({ template: { type: 'string', enum: templates.map((t) => t.id) }, name: string('The project name (the template name by default).') }, ['template']),
      run: async (args) => {
        const definition = templates.find((t) => t.id === args['template']);
        if (!definition) throw new CadenceError('usage', `No template "${String(args['template'])}".`);
        const { project, firstDocument } = unwrap(await cadence.projects.createProject(args['name'] === undefined ? definition.name : String(args['name'])));
        unwrap(await cadence.projects.setProjectParameters(project.id, definition.parameters.map((p, i) => ({ id: `p${i + 1}`, ...p }))));
        await definition.build(cadence, project.id, firstDocument.id);
        return { project: { id: project.id, name: project.name }, documents: (await cadence.projects.listDocuments(project.id)).map(({ id, name, kind }) => ({ id, name, kind })) };
      },
    },
    {
      name: 'rename_project',
      description: 'Renames a project.',
      inputSchema: object({ project: projectArg, name: string('The new name.') }, ['project', 'name']),
      run: async (args) => {
        unwrap(await cadence.projects.renameProject(await projectId(args), String(args['name'])));
        return `Renamed to ${String(args['name'])}.`;
      },
    },
    {
      name: 'delete_project',
      description: 'Deletes a project with all its documents and its version history, for good. Export it first (export_project) to keep a copy.',
      inputSchema: object({ project: projectArg }, ['project']),
      run: async (args) => {
        const project = await cadence.project(String(args['project']));
        for (const document of await cadence.projects.listDocuments(project.id)) cadence.forget(document.id);
        await cadence.projects.deleteProject(project.id);
        return `Deleted ${project.name}.`;
      },
    },
    {
      name: 'duplicate',
      description: 'Copies a project (with new ids, references between its documents following) or a document within its project.',
      inputSchema: object({ project: string('A project to copy (id or name).'), document: string('Or a document to copy (id).') }),
      run: async (args) => {
        if (args['document'] !== undefined) {
          const copy = unwrap(await cadence.projects.duplicateDocument(String(args['document']) as DocumentId));
          return { id: copy.id, name: copy.name, kind: copy.kind };
        }
        if (args['project'] === undefined) throw new CadenceError('usage', 'Name a project or a document to copy.');
        return brief(unwrap(await cadence.projects.duplicateProject(await projectId(args))));
      },
    },
    {
      name: 'export_project',
      description: 'Writes a project as a .cadence archive (its documents and imported originals, with history: its versions too), to back it up or hand it on. Returns the path.',
      inputSchema: object({ project: projectArg, history: { type: 'boolean', description: 'Include the version history.' }, path: string('Where to write the archive (default: the exports folder).') }, ['project']),
      run: async (args) => {
        if (args['path'] !== undefined) exports.deliverNextTo(String(args['path']));
        const before = exports.delivered.length;
        unwrap(await cadence.projects.exportProject(await projectId(args), { history: args['history'] === true }));
        return exports.delivered[before];
      },
    },
    {
      name: 'import_project',
      description: 'A new project from a .cadence archive on disk (as export_project or the app writes them). Its documents keep their ids where the project is not here yet; beside its original (a copy) they get new ones, and the history comes along either way.',
      inputSchema: object({ path: string('Path of the archive on this computer.') }, ['path']),
      run: async (args) => {
        const path = String(args['path']);
        return brief(unwrap(await cadence.projects.importProject({ name: basename(path), bytes: new Uint8Array(await readFile(path)) })));
      },
    },
    {
      name: 'versions',
      description:
        "A project's version history: list (a project's, or a document's with document), record (a version now, with a message), restore (a document as it was in a version; the restore is a change of its own), compare (a document in version with it in to, or as it is now: what was added, removed, changed and moved in its timeline, sketches and parameters, in words, and for components the volume added and removed), name or unname (a version, the latest by default). Copies of projects (duplicated, or imported beside their original) keep the history.",
      inputSchema: object(
        {
          action: { type: 'string', enum: ['list', 'record', 'restore', 'compare', 'name', 'unname'] },
          project: projectArg,
          document: documentArg,
          version: string('A version id (from list).'),
          to: string('compare: the newer version id (the document as it is now by default).'),
          message: string('record: what changed.'),
          name: string('name, unname: the version name, e.g. "v1.0".'),
        },
        ['action'],
      ),
      run: async (args) => {
        const action = String(args['action']);
        const version = args['version'] === undefined ? undefined : String(args['version']);
        if (action === 'restore' || action === 'compare' || (action === 'list' && args['document'] !== undefined)) {
          const document = String(args['document'] ?? '') as DocumentId;
          // Ids are the document's own: refuse one of another project than the one named (CAD-147).
          if (args['project'] !== undefined) {
            const [named, found] = [await projectId(args), await cadence.projects.findDocument(document)];
            if (found && found.projectId !== named) throw new CadenceError('wrong-project', `${found.name} is a document of another project; its id there is ${found.id}.`);
          }
          if (action === 'list') return cadence.projects.documentHistory(document);
          if (!version) throw new CadenceError('usage', `${action} needs a document and a version.`);
          if (action === 'compare') return cadence.compareVersions(document, version, args['to'] === undefined ? undefined : String(args['to']));
          unwrap(await cadence.projects.restoreDocument(document, version));
          cadence.forget(document);
          return `Restored as of ${version}.`;
        }
        const project = await projectId(args);
        switch (action) {
          case 'list':
            return cadence.projects.projectHistory(project);
          case 'record':
            await cadence.projects.recordVersion(project, args['message'] === undefined ? undefined : String(args['message']));
            return (await cadence.projects.projectHistory(project))[0];
          case 'name':
            unwrap(await cadence.projects.nameVersion(project, String(args['name']), version));
            return `Named ${String(args['name'])}.`;
          case 'unname':
            await cadence.projects.unnameVersion(project, String(args['name']));
            return `${String(args['name'])} is no longer a name.`;
          default:
            throw new CadenceError('usage', `No action "${action}".`);
        }
      },
    },
    {
      name: 'sync_project',
      description:
        'Syncs a project with its git repository (sign-in from $CADENCE_GIT_USERNAME and $CADENCE_GIT_PASSWORD), after setting the repository with url. Answers what happened. Documents changed on both sides are merged by their timeline items, sketch elements and parameters; what both changed differently is listed per document (items, each with how mine and theirs have it): sync again with resolutions, {"<path>#<item path>": "mine" | "theirs"} per item, or {"<path>": "mine" | "theirs"} for a whole document.',
      inputSchema: object({ project: projectArg, url: string('The repository to sync with from now on.'), resolutions: { type: 'object', additionalProperties: { type: 'string', enum: ['mine', 'theirs'] }, description: 'Which side to keep for each conflict: by "<path>#<item path>" per item, or by the path of the document for all of it.' } }, ['project']),
      run: async (args) => {
        const project = await projectId(args);
        if (args['url'] !== undefined) unwrap(await cadence.projects.setRemote(project, { url: String(args['url']) }));
        const outcome = unwrap(await cadence.projects.syncProject(project, credentials(env), args['resolutions'] as Readonly<Record<string, ConflictChoice>> | undefined));
        cadence.forget();
        return outcome;
      },
    },
    {
      name: 'open_git',
      description: 'Opens a project from a git repository as a new project (sign-in from $CADENCE_GIT_USERNAME and $CADENCE_GIT_PASSWORD).',
      inputSchema: object({ url: string('The repository, e.g. https://github.com/me/bracket.git.') }, ['url']),
      run: async (args) => brief(unwrap(await cadence.projects.openRemoteProject({ url: String(args['url']) }, credentials(env)))),
    },
  ];
}
