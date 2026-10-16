import { expect, test } from '@playwright/test';
import { cutHole, evidence, fromModelMenu, hinge, plateProject, setThickness, standardView, topPoints } from './support';

/** Phase 26 (stress-test findings, CAD-96) user journey: ring gears with planets, and cams. */
test.setTimeout(240_000);

test('makes a ring gear with smooth teeth and says where a planet goes (CAD-98, CAD-107)', async ({ page }) => {
  await plateProject(page, 'Reduction');
  await topPoints(page, [0]);

  await fromModelMenu(page, 'Create', 'Part');
  await page.locator('#feature-part-kind').selectOption('ring-gear');
  await page.locator('#feature-mate-teeth').fill('18');
  await page.locator('#feature-mate-teeth').press('Tab');
  // 60 teeth of module 1: an 18-tooth planet at (60 − 18) / 2 mm; the sun has 24 teeth, the carrier turns 24/84.
  await expect(page.getByTestId('centre-distance')).toHaveText("Put the planet's centre 21 mm along X; with a sun of 24 teeth, the carrier turns 0.2857 of the sun.");
  await page.locator('#feature-mate-teeth').fill('55');
  await page.locator('#feature-mate-teeth').press('Tab');
  await expect(page.getByTestId('centre-distance')).toContainText('A planet needs at least 10 teeth fewer than the ring');
  await page.locator('#feature-operation').selectOption('new-body');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByTestId('body-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Top view' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '94-ring-gear');
});

test('moves a follower by a cam profile (CAD-99)', async ({ page }) => {
  await plateProject(page, 'Cam');
  await setThickness(page, '4 mm');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2', '3']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await hinge(page, 0, 1);
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');
  await hinge(page, 1, 2);
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 2');

  // The first joint turns the cam; the second follows its profile: one lobe, 5° up at 90°.
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.locator('#link-kind').selectOption('cam');
  await expect(page.locator('#link-profile')).toHaveValue('0 0\n90 5\n180 0\n270 0');
  await expect(page.locator('#link-size-a')).toHaveCount(0);
  await page.locator('#link-profile').fill('0 0\n90 12\n180 0\n270 0');
  await page.locator('#link-profile').press('Tab');
  await expect(page.getByRole('list', { name: 'Links' })).toContainText('Gear 1');
  await page.getByRole('button', { name: 'Select Revolute 1' }).click();
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('90');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await page.getByRole('button', { name: 'Select Revolute 2' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Angle value of Revolute 2' })).toHaveValue('12');
  await page.getByRole('button', { name: 'Select Revolute 1' }).click();
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('270');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await page.getByRole('button', { name: 'Select Revolute 2' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Angle value of Revolute 2' })).toHaveValue('0');
  await page.getByRole('button', { name: 'Select Gear 1' }).click();
  await standardView(page, 'Home');
  await evidence(page, '95-cam-link');
});
