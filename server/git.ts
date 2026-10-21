import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

/** Whether the system's git is there: the server keeps projects as git repositories and serves them with it. */
export function gitAvailable(): boolean {
  return spawnSync('git', ['--version']).status === 0;
}

/** Makes the bare repository of a project (an empty one: the first sync fills it). */
export function createRepository(root: string, id: string): void {
  const path = join(root, `${id}.git`);
  if (existsSync(path)) return;
  const made = spawnSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', path]);
  if (made.status !== 0) throw new Error(`git could not make the repository of ${id}: ${made.stderr.toString()}`);
  // Pushes from CADence go to main; refuse rewriting its history.
  spawnSync('git', ['--git-dir', path, 'config', 'receive.denyNonFastForwards', 'true']);
}

/** Whether a git request writes (a push) or only reads (a fetch or clone). */
export const isPush = (url: URL): boolean => url.pathname.endsWith('/git-receive-pack') || url.searchParams.get('service') === 'git-receive-pack';

/**
 * Answers a git request over HTTP with the system's `git http-backend` (CGI): `path` is below the
 * repositories' root, e.g. `/abc.git/info/refs`.
 */
export function serveGit(root: string, path: string, query: string, user: string, request: IncomingMessage, response: ServerResponse): void {
  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      // Access was checked before; git lets a known user push.
      REMOTE_USER: user,
      REMOTE_ADDR: request.socket.remoteAddress ?? '',
      PATH_INFO: path,
      QUERY_STRING: query,
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
    },
  });
  request.pipe(backend.stdin);
  // CGI: headers (with a `Status` line), an empty line, then the body.
  let head = Buffer.alloc(0);
  let started = false;
  backend.stdout.on('data', (chunk: Buffer) => {
    if (started) return void response.write(chunk);
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) return;
    started = true;
    let status = 200;
    for (const line of head.subarray(0, end).toString().split('\r\n')) {
      const [name, ...value] = line.split(':');
      if (name?.toLowerCase() === 'status') status = Number.parseInt(value.join(':').trim(), 10);
      else if (name) response.setHeader(name, value.join(':').trim());
    }
    response.writeHead(status);
    response.write(head.subarray(end + 4));
  });
  backend.on('close', () => response.end());
}
