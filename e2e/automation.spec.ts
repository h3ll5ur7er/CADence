import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { GitHttpServer } from '../src/core/access/version/testing/git-http-server';
import { evidence } from './support';

/** Phase 14 (Automation) user journey: a script run on the command line makes a part, which the app opens from git. */
test.setTimeout(180_000);

const repository = join(import.meta.dirname, '..');

const script = `export default async function (cadence, [url]) {
  const { project, firstDocument } = (await cadence.projects.createProject('Made by a script')).value;
  const bracket = await cadence.component(firstDocument.id);
  await bracket.run(
    { type: 'add-parameter', parameter: { id: 'w', name: 'width', expression: '80 mm' } },
    { type: 'create-sketch', id: 's', plane: 'XY' },
    { type: 'add-rectangle', sketchId: 's', id: 'plate', x: 0, y: 0, width: 'width', height: 40 },
    { type: 'add-circle', sketchId: 's', id: 'left', x: 15, y: 20, diameter: 8 },
    { type: 'add-circle', sketchId: 's', id: 'right', x: 65, y: 20, diameter: 8 },
  );
  const plate = bracket.summary().sketches[0].profiles.find((p) => p.area > 3000);
  await bracket.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: 'Plate', suppressed: false, sketch: 's', profiles: [plate.id], distance: '5 mm', direction: 'normal', operation: 'new-body' } });
  await cadence.projects.setRemote(project.id, { url });
  const synced = await cadence.projects.syncProject(project.id);
  if (!synced.ok) throw new Error(synced.error.message);
}
`;

test('a part made by a script on the command line opens in the app through git', async ({ page }) => {
  const built = spawnSync(process.execPath, [join(repository, 'tools', 'automation', 'build.mjs')], { encoding: 'utf8' });
  expect(built.status, built.stderr).toBe(0);
  const server = await GitHttpServer.start();
  const work = mkdtempSync(join(tmpdir(), 'cadence-script-'));
  try {
    const url = server.repository('bracket');
    writeFileSync(join(work, 'bracket.mjs'), script);
    // Not spawnSync: the git server runs in this process and has to answer meanwhile.
    await promisify(execFile)(process.execPath, [join(repository, 'dist', 'automation', 'cadence.mjs'), 'run', join(work, 'bracket.mjs'), url, '--folder', join(work, 'projects')]);

    await page.goto('/');
    await page.getByRole('button', { name: 'Open from git…' }).click();
    await page.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await page.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByRole('button', { name: 'Made by a script', exact: true })).toBeVisible();
    await expect(page.getByTestId('body-size')).toHaveText('80, 40, 5 mm');
    // (80 × 40 − 2 × π × 4²) × 5
    await expect(page.getByTestId('body-volume')).toHaveText('15,497.35 mm³');
    await page.waitForTimeout(800);
    await evidence(page, '61-script-part');
  } finally {
    await server.stop();
    rmSync(work, { recursive: true, force: true });
  }
});
