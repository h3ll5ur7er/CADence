import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DocumentId, Joint, LibraryLink, Matrix4, ProjectId, TopologyRef } from '@core/contracts';
import { standardLibraryId } from '@core/contracts';
import type { Cadence } from '../api';
import { CadenceError, unwrap } from '../results';
import { documentArg, object, projectArg, string, type Tool } from './schema';

const identity: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * What the app's trash, project notes and libraries do, for agents (CAD-148, CAD-149, CAD-151,
 * CAD-152): restore what was deleted, read and write a project's description and attachments, and
 * insert parts of libraries (the standard parts among them) into assemblies.
 */
export function libraryTools(cadence: Cadence): Tool[] {
  const projectId = async (args: Record<string, unknown>) => (await cadence.project(String(args['project']))).id;
  /** A library by its id or name. */
  const libraryId = async (given: unknown) => {
    const wanted = given === undefined ? standardLibraryId : String(given);
    const found = (await cadence.projects.listLibraries()).find((l) => l.id === wanted || l.name === wanted || l.projectId === wanted);
    if (!found) throw new CadenceError('unknown-library', `No library "${wanted}"; list_libraries lists them.`);
    return found.id;
  };
  return [
    {
      name: 'trash',
      description:
        'The trash, where delete_project and delete_document put what they delete for 30 days: list it, restore a project or a document (as it was, with its history), delete one for good, or empty it.',
      inputSchema: object({ action: { type: 'string', enum: ['list', 'restore', 'delete', 'empty'] }, id: string('restore, delete: the project or document id (from list).') }, ['action']),
      run: async (args) => {
        const id = String(args['id'] ?? '') as ProjectId | DocumentId;
        switch (String(args['action'])) {
          case 'list':
            return cadence.projects.listTrash();
          case 'restore': {
            const item = unwrap(await cadence.projects.restoreFromTrash(id));
            cadence.forget(id);
            return `Restored ${item.name}.`;
          }
          case 'delete':
            unwrap(await cadence.projects.deleteFromTrash(id));
            return `Deleted ${id} for good.`;
          case 'empty':
            await cadence.projects.emptyTrash();
            return 'The trash is empty.';
          default:
            throw new CadenceError('usage', `No action "${String(args['action'])}".`);
        }
      },
    },
    {
      name: 'project_notes',
      description:
        "A project's description (Markdown) and attachments (datasheets, photos, links), versioned and synced with it: get (the description and the list), set (the description), attach (a file from disk by path, or a link by url), read (an attached file: text files answer their text, others are written to the exports folder), remove (an attachment).",
      inputSchema: object(
        {
          action: { type: 'string', enum: ['get', 'set', 'attach', 'read', 'remove'] },
          project: projectArg,
          description: string('set: the new description, in Markdown.'),
          path: string('attach: a file on this computer.'),
          url: string('attach: a link (https://…).'),
          name: string('attach: a name for the link.'),
          attachment: string('read, remove: the attachment id (from get).'),
        },
        ['action', 'project'],
      ),
      run: async (args) => {
        const project = await projectId(args);
        switch (String(args['action'])) {
          case 'get': {
            const { description, attachments } = await cadence.project(project);
            return { description: description ?? '', attachments: attachments ?? [] };
          }
          case 'set':
            unwrap(await cadence.projects.setProjectDescription(project, String(args['description'] ?? '')));
            return 'The description is set.';
          case 'attach': {
            if (args['url'] !== undefined) return unwrap(await cadence.projects.addAttachment(project, { link: { url: String(args['url']), ...(args['name'] ? { name: String(args['name']) } : {}) } }));
            if (args['path'] === undefined) throw new CadenceError('usage', 'attach needs a path or a url.');
            const path = String(args['path']);
            return unwrap(await cadence.projects.addAttachment(project, { file: { name: basename(path), bytes: new Uint8Array(await readFile(path)) } }));
          }
          case 'read': {
            const { attachment, bytes } = unwrap(await cadence.projects.attachmentFile(project, String(args['attachment'])));
            if (attachment.kind === 'file' && /^text\/|json/.test(attachment.mediaType)) return new TextDecoder().decode(bytes);
            const before = cadence.exports.delivered.length;
            await cadence.projects.deliverFile({ name: attachment.name, mediaType: attachment.kind === 'file' ? attachment.mediaType : 'application/octet-stream', bytes });
            return cadence.exports.delivered[before];
          }
          case 'remove':
            unwrap(await cadence.projects.removeAttachment(project, String(args['attachment'])));
            return 'Removed.';
          default:
            throw new CadenceError('usage', `No action "${String(args['action'])}".`);
        }
      },
    },
    {
      name: 'list_libraries',
      description:
        'Libraries whose components assemblies insert without copying them by hand: the built-in standard parts (ISO 4762 screws, ISO 4032 nuts, ISO 7089 washers, heat-set inserts, ball bearings, in every size; stepper motors NEMA 8 to 23 in their common lengths) and the projects marked as libraries. With library, lists its parts (match filters them, e.g. "M3").',
      inputSchema: object({ library: string('A library id or name: lists its parts.'), match: string('Only parts whose name contains this.') }),
      run: async (args) => {
        if (args['library'] === undefined) return cadence.projects.listLibraries();
        const parts = unwrap(await cadence.projects.libraryParts(await libraryId(args['library'])));
        const match = args['match'] === undefined ? undefined : String(args['match']).toLowerCase();
        return match ? parts.filter((p) => p.name.toLowerCase().includes(match)) : parts;
      },
    },
    {
      name: 'library',
      description:
        "Makes a project a library (on true) or no longer one; for a project that uses libraries, lists the parts whose library has a newer version (updates), brings them to it (update: all, or the documents given), or sets whether a part follows its library's new versions on its own (follow).",
      inputSchema: object(
        {
          action: { type: 'string', enum: ['mark', 'updates', 'update', 'follow'] },
          project: projectArg,
          on: { type: 'boolean', description: 'mark: whether the project is a library.' },
          documents: { type: 'array', items: { type: 'string' }, description: 'update: only these library parts (ids).' },
          document: documentArg,
          follow: { type: 'string', enum: ['asked', 'always'], description: 'follow: when the part takes new versions.' },
        },
        ['action'],
      ),
      run: async (args) => {
        switch (String(args['action'])) {
          case 'mark':
            unwrap(await cadence.projects.setLibrary(await projectId(args), args['on'] !== false));
            return (await cadence.project(String(args['project']))).library ?? 'No longer a library.';
          case 'updates':
            return (await cadence.projects.libraryUpdates(await projectId(args))).map(({ document, link, latest }) => ({ document: document.id, name: document.name, library: link.libraryName, version: link.version, latest }));
          case 'update': {
            const updated = unwrap(await cadence.projects.updateLibraryParts(await projectId(args), args['documents'] as DocumentId[] | undefined));
            cadence.forget();
            return updated.map(({ id, name, library }) => ({ id, name, version: library?.version }));
          }
          case 'follow':
            unwrap(await cadence.projects.setLibraryFollow(String(args['document']) as DocumentId, args['follow'] as LibraryLink['follow']));
            return `It follows ${args['follow'] === 'always' ? 'every new version' : 'new versions when asked'}.`;
          default:
            throw new CadenceError('usage', `No action "${String(args['action'])}".`);
        }
      },
    },
    {
      name: 'insert_library_part',
      description:
        'Inserts a library part into an assembly as an instance, by designation for standard parts ("ISO 4762 M3 x 12", "ISO 4032 M3", "Ball bearing 608", "Stepper motor NEMA 17 x 40") or by name or id for other libraries; with at, also a joint that lays it on a hole: its origin (a screw\'s head underside, a nut\'s bottom face, a motor\'s mounting face with its shaft along the axis) on the axis of a round face or circular edge of another instance (flip turns it over). The project keeps the part as the library version it took; it appears in the bill of materials by its designation.',
      inputSchema: object(
        {
          document: string('The assembly (id).'),
          part: string('The part: a designation, name or id (list_libraries).'),
          library: string('The library (id or name); the standard parts by default.'),
          instance: string('The new instance id (one is made by default).'),
          name: string('The instance name (the part’s by default).'),
          at: object({ instance: string('The instance with the hole.'), ref: { type: 'object', description: 'A round face or circular edge of it: {"kind":"edge","body":"<body>","name":"<edge>"}.' } }, ['instance', 'ref']),
          flip: { type: 'boolean', description: 'Turns the part over on the joint.' },
          joint: { type: 'string', enum: ['revolute', 'rigid'], description: 'The joint at a hole: revolute (turns on the axis, by default) or rigid.' },
          follow: { type: 'boolean', description: "Other libraries: the part takes the library's new versions on its own." },
        },
        ['document', 'part'],
      ),
      run: async (args) => {
        const document = await cadence.document(String(args['document']));
        if (document.kind !== 'assembly') throw new CadenceError('not-an-assembly', `${document.name} is not an assembly.`);
        const part = unwrap(await cadence.projects.useLibraryPart(document.projectId, await libraryId(args['library']), String(args['part']), args['follow'] === true ? { follow: 'always' } : {}));
        const script = await cadence.assembly(document.id);
        const before = await script.summary();
        const taken = new Set(before.instances.map((i) => i.id));
        let id = args['instance'] === undefined ? undefined : String(args['instance']);
        for (let n = 1; !id || taken.has(id); n++) id = `${(part.library?.document ?? part.id).replace(/[^\w-]/g, '-')}-${n}`;
        const at = args['at'] as { instance: string; ref: TopologyRef } | undefined;
        const type = args['joint'] === 'rigid' ? 'rigid' : 'revolute';
        const joint: Joint | undefined = at && { id: `${id}-joint`, name: '', type, a: { instance: at.instance, ref: at.ref }, b: { instance: id }, flip: args['flip'] === true, values: type === 'rigid' ? [] : [0], limits: type === 'rigid' ? [] : [null] };
        await script.run({ type: 'insert-instance', instance: { id, component: part.id, name: args['name'] === undefined ? '' : String(args['name']), transform: identity, grounded: false }, ...(joint ? { joint } : {}) });
        return { part: { id: part.id, name: part.name, library: part.library?.libraryName, version: part.library?.version }, ...(await script.changes(before)) };
      },
    },
  ];
}
