import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, expect, test, type Page } from '@playwright/test';
import { startServer } from '../server/server';
import { GitHttpServer } from '../src/core/access/version/testing/git-http-server';
import { center, cutHole, evidence, plateProject, setThickness } from './support';

/** Phase 42 (Versions and collaboration) user journey: comparing versions, merging inside a document, sharing, editing live. */
test.setTimeout(240_000);

/** Opens the sync dialog, syncs, and waits for what it says. */
async function sync(page: Page, says: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Sync with git' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sync with git' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(says);
  await dialog.getByRole('button', { name: 'Close' }).click();
}

test('compares two versions of a plate: the new hole overlaid in red, side by side, and listed (CAD-175)', async ({ page }) => {
  await plateProject(page, 'Compared plate');
  await page.waitForTimeout(3500); // the version of the plain plate is recorded
  await cutHole(page);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');

  await page.getByRole('button', { name: 'History of Component 1' }).click();
  const versions = page.getByRole('list', { name: 'Versions' }).getByRole('listitem');
  await expect(versions.first()).toContainText('Changed Component 1');
  await versions.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Compare with now' }).click();

  const differences = page.getByRole('complementary', { name: 'Differences' });
  await expect(differences.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  await expect(differences.getByRole('list', { name: 'Timeline' })).toContainText('Sketch 2');
  await expect(page.getByTestId('compare-volumes')).toContainText('Removed');
  await expect(page.getByTestId('compare-volumes').locator('.removed-text')).not.toHaveText('0 mm³');
  await page.waitForTimeout(800);
  await evidence(page, 'phase-42-compare-overlay');

  await page.getByRole('button', { name: 'Side by side' }).click();
  await expect(page.getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(800);
  await evidence(page, 'phase-42-compare-side-by-side');

  await page.getByRole('button', { name: 'Close comparison' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  await expect(page.getByTestId('body-count')).toHaveText('1');
});

test('merges a hole made in one browser with a thicker plate made in another, and asks per item what both changed (CAD-176)', async ({ page, browser }) => {
  const server = await GitHttpServer.start();
  try {
    const url = server.repository('merged-plate');
    await plateProject(page, 'Merged plate');
    await page.getByRole('button', { name: 'Sync with git' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sync with git' });
    await dialog.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Sent the versions');
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Another device cuts a hole; here the plate gets thicker. Both changed the one component.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await context.newPage();
    await other.goto(new URL(page.url()).origin);
    await other.getByRole('button', { name: 'Open from git…' }).click();
    await other.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await other.getByRole('button', { name: 'Open project' }).click();
    await expect(other.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
    await cutHole(other);
    await expect(other.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
    await expect(other.getByTestId('body-count')).toHaveText('1');
    await sync(other, 'Sent the versions');

    await setThickness(page, '9 mm');
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 9 mm');
    await sync(page, 'Combined the changes');
    // One component with both: the hole and the thickness.
    await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 9 mm');
    await evidence(page, 'phase-42-merged');

    // Now both change the thickness: only that is asked, side by side.
    await sync(other, 'Took the versions');
    await setThickness(other, '15 mm');
    await sync(other, 'Sent the versions');
    await context.close();
    await setThickness(page, '12 mm');
    await page.getByRole('button', { name: 'Sync with git' }).click();
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    const choice = dialog.getByRole('radiogroup', { name: 'Component 1: Parameter thickness' });
    await expect(choice).toContainText('expression 12 mm');
    await expect(choice).toContainText('expression 15 mm');
    await expect(dialog.getByTestId('item-conflicts')).toContainText('Everything else of it was combined');
    await choice.getByRole('radio', { name: /Theirs/ }).check();
    await evidence(page, 'phase-42-item-conflict');
    await dialog.getByRole('button', { name: 'Sync with these choices' }).click();
    await expect(dialog.getByRole('status')).toContainText('Combined the changes');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 15 mm');
    await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  } finally {
    await server.stop();
  }
});

/** A CADence server for the journey, signing in by name (CAD-177). */
async function cadenceServer() {
  const data = mkdtempSync(join(tmpdir(), 'cadence-e2e-server-'));
  const server = await startServer({ data, providers: [], devSignIn: true });
  return { url: server.url, stop: async () => (await server.close(), rmSync(data, { recursive: true, force: true })) };
}

/** Signs in to the server by name in a sign-in panel (of the share or the shared projects dialog). */
async function signIn(dialog: ReturnType<Page['getByRole']>, server: string, name: string): Promise<void> {
  await dialog.getByRole('textbox', { name: 'CADence server address' }).fill(server);
  await dialog.getByRole('textbox', { name: 'CADence server address' }).press('Tab');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await dialog.getByRole('textbox', { name: 'Your name' }).fill(name);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByTestId('signed-in')).toContainText(name);
}

/** Another person's browser: storage of its own, signed in to the server on the home page. */
async function person(browser: Browser, origin: string, server: string, name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Shared projects…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shared projects' });
  await signIn(dialog, server, name);
  return { context, page, dialog };
}

/** Ada's plate shared on the server, with Bob (who signed in once) invited to edit it. */
async function shareWithBob(page: Page, server: string, bob: string) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: /^Share / });
  await signIn(share, server, 'Ada');
  await share.getByRole('button', { name: 'Share on this server' }).click();
  await expect(share.getByRole('region', { name: 'Members' })).toContainText('Ada');
  await expect(page.getByTestId('shared-chip')).toHaveText('Shared');
  await share.getByRole('textbox', { name: 'Name or e-mail address to invite' }).fill(bob);
  await share.getByRole('button', { name: 'Invite' }).click();
  await expect(share.getByRole('combobox', { name: `Role of ${bob}` })).toHaveValue('editor');
  return share;
}

test('shares a project on a CADence server: a member opens it, a link shows it to anyone (CAD-177)', async ({ page, browser }) => {
  const server = await cadenceServer();
  try {
    await plateProject(page, 'Shared bracket');
    const bob = await person(browser, new URL(page.url()).origin, server.url, 'Bob');
    await expect(bob.dialog.getByRole('list', { name: 'Shared projects' })).toContainText('Nothing shared yet');
    await bob.dialog.getByRole('button', { name: 'Close' }).click();

    const share = await shareWithBob(page, server.url, 'Bob');
    await share.getByRole('button', { name: 'Make a link to view' }).click();
    const link = await share.getByTestId('view-link').inputValue();
    expect(link).toContain('/shared?server=');
    await evidence(page, 'phase-42-share');
    await share.getByRole('button', { name: 'Close' }).click();

    // Bob opens it from the projects shared with him.
    await bob.page.getByRole('button', { name: 'Shared projects…' }).click();
    await bob.dialog.getByRole('button', { name: 'Open Shared bracket' }).click();
    await expect(bob.page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
    await expect(bob.page.getByTestId('shared-chip')).toHaveText('Shared');

    // Carl has no account: the link opens the project to view.
    const carl = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const viewer = await carl.newPage();
    await viewer.goto(link);
    await expect(viewer.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
    await expect(viewer.getByTestId('shared-chip')).toHaveText('View only');
    await evidence(viewer, 'phase-42-view-link');
    await carl.close();
    await bob.context.close();
  } finally {
    await server.stop();
  }
});

test('two browsers edit one sketch at once and see each other there (CAD-178)', async ({ page, browser }) => {
  const server = await cadenceServer();
  try {
    await plateProject(page, 'Live plate');
    const bob = await person(browser, new URL(page.url()).origin, server.url, 'Bob');
    await bob.dialog.getByRole('button', { name: 'Close' }).click();
    const share = await shareWithBob(page, server.url, 'Bob');
    await share.getByRole('button', { name: 'Close' }).click();
    await bob.page.getByRole('button', { name: 'Shared projects…' }).click();
    await bob.dialog.getByRole('button', { name: 'Open Live plate' }).click();
    await expect(bob.page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');

    // Both live, each seeing the other.
    for (const [who, other] of [[page, 'Bob'], [bob.page, 'Ada']] as const) {
      await expect(who.getByTestId('live')).toHaveAttribute('data-status', 'live');
      await expect(who.getByTestId('live-person')).toContainText(other);
    }

    // Both in Sketch 1: Bob sees where Ada is and her pointer.
    for (const who of [page, bob.page]) {
      await who.getByRole('button', { name: 'Edit Sketch 1' }).click();
      await expect(who.locator('.curve')).toHaveCount(4);
    }
    await expect(bob.page.getByTestId('live-person')).toContainText('Ada · Sketch 1');
    const canvas = await center(page, 'circle.point.origin');
    await page.mouse.move(canvas.x + 60, canvas.y + 60);
    await expect(bob.page.getByTestId('live-pointer')).toContainText('Ada');

    // A line each, at the same time.
    const draw = async (who: Page, dy: number) => {
      const origin = await center(who, 'circle.point.origin');
      await who.getByRole('button', { name: 'Line', exact: true }).click();
      await who.mouse.click(origin.x + 20, origin.y + dy);
      await who.mouse.click(origin.x + 200, origin.y + dy);
      await who.keyboard.press('Escape');
    };
    await Promise.all([draw(page, 60), draw(bob.page, 100)]);
    for (const who of [page, bob.page]) await expect(who.locator('.curve')).toHaveCount(6);
    await page.mouse.move(canvas.x + 150, canvas.y + 30);
    await expect(bob.page.getByTestId('live-pointer')).toBeVisible();
    await evidence(bob.page, 'phase-42-live-sketch');

    // A change made by Bob shows at Ada's at once, without a sync.
    await bob.page.getByRole('button', { name: 'Finish sketch' }).click();
    await page.getByRole('button', { name: 'Finish sketch' }).click();
    await setThickness(bob.page, '8 mm');
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 8 mm');
    await bob.context.close();
    await expect(page.getByTestId('live-person')).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
