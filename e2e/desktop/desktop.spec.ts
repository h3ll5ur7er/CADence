import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, expect, type Page, test } from '@playwright/test';
import { evidence, plateProject } from '../support';

/**
 * The built desktop app, driven through WebView2's remote debugging: projects as folders, exports
 * through the native save dialog (answered with UI Automation), and the app started again.
 */
const repository = join(import.meta.dirname, '..', '..');
const executable = join(repository, 'src-tauri', 'target', 'release', 'cadence.exe');
/** WebView2's remote debugging port; each start gets its own, since the last one's WebView2 may still hold the port. */
let port = 9333;
/** Where the desktop app keeps projects (Tauri's app data folder). */
const dataFolder = join(process.env['APPDATA'] ?? '', 'dev.cadence.app');

test.skip(process.platform !== 'win32' || !existsSync(executable), 'Needs the built Windows desktop app');

let app: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page;

async function launch(files: readonly string[] = []): Promise<void> {
  port++;
  const started = spawn(executable, files, { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  app = started;
  await expect
    .poll(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false), { timeout: 60_000, message: 'WebView2 remote debugging' })
    .toBe(true);
  const connected = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  browser = connected;
  await expect.poll(() => connected.contexts()[0]?.pages().length ?? 0).toBeGreaterThan(0);
  page = connected.contexts()[0]?.pages()[0] as Page;
}

async function quit(): Promise<void> {
  await browser?.close();
  browser = undefined;
  const running = app;
  app = undefined;
  if (!running || running.exitCode !== null) return;
  const exited = new Promise((resolve) => running.once('exit', resolve));
  running.kill();
  await exited;
}

/** Answers the next native save dialog of the app with `path`. */
function answerSaveDialog(path: string): Promise<void> {
  const script = join(import.meta.dirname, 'save-dialog.ps1');
  const answer = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProcessId', String(app?.pid), '-Path', path]);
  let errors = '';
  answer.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  return new Promise((resolve, reject) => answer.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(errors || `exit ${code}`)))));
}

// Each test starts the app itself; WebView2 shares its browser process with an app still running.
test.afterEach(quit);

test('models in project folders, exports through the save dialog, and starts again', async () => {
  const work = mkdtempSync(join(tmpdir(), 'cadence-desktop-'));
  const name = `Desktop check ${Date.now()}`;
  let folder: string | undefined;
  try {
    await launch();
    const home = new URL('/', page.url()).href;
    await plateProject(page, name, home);
    await expect(page.getByTestId('storage')).toHaveText('Project folders');
    const projectId = /\/projects\/([^/]+)/.exec(page.url())?.[1] as string;
    const projectFolder = join(dataFolder, 'projects', projectId);
    folder = projectFolder;
    expect(JSON.parse(readFileSync(join(projectFolder, 'project.json'), 'utf8')).name).toBe(name);
    // Versions are recorded a few seconds after changes, into the project folder.
    await expect.poll(() => existsSync(join(projectFolder, '.git', 'refs', 'heads', 'main')), { timeout: 15_000 }).toBe(true);
    await evidence(page, '63-desktop');

    // An export goes through the native save dialog.
    const stl = join(work, 'plate.stl');
    await page.getByRole('button', { name: 'Export' }).click();
    const answered = answerSaveDialog(stl);
    await page.getByRole('menuitem', { name: 'STL (for slicers)' }).click();
    await answered;
    await expect.poll(() => existsSync(stl) && readFileSync(stl).byteLength).toBeGreaterThan(84);

    // Closed and started again, the project is still there.
    await quit();
    await launch();
    await page.goto(home);
    const card = page.getByRole('list', { name: 'Projects' }).getByRole('listitem').filter({ hasText: name });
    await card.getByRole('link').click();
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');

    // Leaves the desktop app's projects as they were.
    await page.goto(home);
    await card.getByRole('button', { name: `Delete ${name}` }).click();
    await page.getByRole('button', { name: 'Delete project' }).click();
    await expect(card).toHaveCount(0);
    expect(existsSync(projectFolder)).toBe(false);
  } finally {
    rmSync(work, { recursive: true, force: true });
    // A failed run must not leave its project behind either.
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
});

test('opens files it is started with as a project (Open with CADence)', async () => {
  let folder: string | undefined;
  try {
    await launch([join(repository, 'e2e', 'fixtures', 'wedge.stl')]);
    await expect(page).toHaveURL(/\/projects\/[^/]+\/documents\//);
    const projectId = /\/projects\/([^/]+)/.exec(page.url())?.[1] as string;
    folder = join(dataFolder, 'projects', projectId);
    await expect(page.getByRole('link', { name: 'wedge' })).toBeVisible();
    await expect(page.getByTestId('imported-size')).toBeVisible();
    expect(JSON.parse(readFileSync(join(folder, 'project.json'), 'utf8')).name).toBe('wedge');
  } finally {
    await quit();
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
});
