import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A git server over HTTP for tests: the system's `git http-backend` behind a Node server, with
 * empty bare repositories made on request and, optionally, a basic-auth sign-in.
 */
export class GitHttpServer {
  private readonly root = mkdtempSync(join(tmpdir(), 'cadence-remote-'));
  private readonly server: Server;

  private constructor(private readonly login?: { username: string; password: string }) {
    this.server = createServer((request, response) => {
      // Browsers (end-to-end tests) reach it from another origin.
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? '*');
      response.setHeader('Access-Control-Expose-Headers', '*');
      if (request.method === 'OPTIONS') return void response.writeHead(204).end();
      const authorization = request.headers.authorization ?? '';
      const expected = this.login && `Basic ${Buffer.from(`${this.login.username}:${this.login.password}`).toString('base64')}`;
      if (expected && authorization !== expected) {
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const backend = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: this.root,
          GIT_HTTP_EXPORT_ALL: '1',
          // A signed-in user may push.
          REMOTE_USER: 'tester',
          REMOTE_ADDR: '127.0.0.1',
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
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
        const headers: Record<string, string> = {};
        let status = 200;
        for (const line of head.subarray(0, end).toString().split('\r\n')) {
          const [name, ...value] = line.split(':');
          if (name?.toLowerCase() === 'status') status = Number.parseInt(value.join(':').trim(), 10);
          else if (name) headers[name] = value.join(':').trim();
        }
        response.writeHead(status, headers);
        response.write(head.subarray(end + 4));
      });
      backend.on('close', () => response.end());
    });
  }

  static async start(login?: { username: string; password: string }): Promise<GitHttpServer> {
    const server = new GitHttpServer(login);
    await new Promise<void>((resolve) => server.server.listen(0, '127.0.0.1', resolve));
    return server;
  }

  /** Makes an empty bare repository; returns its URL. */
  repository(name: string): string {
    spawnSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', join(this.root, `${name}.git`)]);
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/${name}.git`;
  }

  /** The commit messages on a repository's main, newest first (as the system's git sees them). */
  log(name: string): string[] {
    const result = spawnSync('git', ['--git-dir', join(this.root, `${name}.git`), 'log', '--format=%s', 'main'], { encoding: 'utf8' });
    return result.stdout.split('\n').filter(Boolean);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    rmSync(this.root, { recursive: true, force: true });
  }
}
