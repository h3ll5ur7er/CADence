import { expect, type Page, test } from '@playwright/test';
import { anchorOnScreen, cutHole, evidence, fromModelMenu, hinge, plateProject, setThickness, sheetPoint, standardView, topPoints } from './support';

/**
 * Phases 26 to 30 (stress-test findings, CAD-96) user journeys: ring gears with planets, cams, radial
 * exploded views of pattern copies, leaned joint offsets, and drawings of configurations with
 * cutting-plane lines and dimensions to circle centres.
 */
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

test('leans a joint offset before tilting it, to point the joint any way (CAD-118)', async ({ page }) => {
  await plateProject(page, 'Strut');
  await setThickness(page, '4 mm');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await hinge(page, 0, 1);
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');

  // Leaned a quarter turn, then tilted: the second plate's hinge axis tips over towards the frame's x.
  for (const [field, value] of [['Lean', '90'], ['Tilt', '30']] as const) {
    await page.getByRole('textbox', { name: `${field} offset of stays` }).fill(value);
    await page.getByRole('textbox', { name: `${field} offset of stays` }).press('Tab');
  }
  await expect(page.getByRole('textbox', { name: 'Lean offset of stays' })).toHaveValue('90');
  await expect(page.getByRole('textbox', { name: 'Tilt offset of stays' })).toHaveValue('30');
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await standardView(page, 'Front');
  await evidence(page, '97-joint-lean');
});

test('draws a configuration of a part, marks where a section cuts and dimensions to a hole centre (CAD-126, CAD-127)', async ({ page }) => {
  const click = async (at: Promise<{ x: number; y: number }>) => {
    const p = await at;
    await page.mouse.click(p.x, p.y);
  };
  const sheetText = (text: string | RegExp) => page.locator('svg.sheet text').filter({ hasText: text });
  await plateProject(page, 'Drawing findings');
  await cutHole(page);
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New configuration name' }).fill('Thick');
  await page.getByRole('button', { name: 'Add configuration' }).click();
  await page.getByRole('textbox', { name: 'thickness in Thick' }).fill('12 mm');
  await page.getByRole('textbox', { name: 'thickness in Thick' }).press('Enter');
  await page.getByRole('button', { name: 'Close parameters' }).click();

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await expect(page.getByRole('application', { name: 'Drawing sheet' })).toBeVisible();
  await page.locator('#sheet-scale').selectOption({ label: '2:1' });
  const addView = async (direction: string, configuration?: string) => {
    await page.getByRole('button', { name: 'View', exact: true }).click();
    if (configuration) await page.locator('#view-configuration').selectOption({ label: configuration });
    await page.locator('#view-direction').selectOption({ label: direction });
    await page.getByRole('button', { name: 'Add view' }).click();
  };
  await addView('Top');
  await addView('Front');
  await addView('Right', 'Thick');
  await expect(page.getByRole('heading', { name: 'Right of Component 1 (Thick)' })).toBeVisible();

  // The front view as a section: the top view shows where it cuts, with its letters.
  await page.keyboard.press('Escape');
  await click(anchorOnScreen(page, 1, 'point', 'left'));
  await page.getByLabel('Section (cut through the middle)').check();
  await expect(page.locator('svg.sheet text[data-owner]').filter({ hasText: /^A$/ })).toHaveCount(2);

  // From the plate's left end to the hole's centre, and the hole's diameter down and to the left.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Horizontal' }).click();
  await click(anchorOnScreen(page, 0, 'point', 'left'));
  await click(anchorOnScreen(page, 0, 'circle', 'rim'));
  // To the circle itself (its centre), not to a corner on its rim.
  const anchored = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const annotations = ng.getComponent(document.querySelector('cad-drawing-mode') as Element).store.document().annotations as { anchors?: { kind: string }[] }[];
      return annotations.map((a) => a.anchors?.map((anchor) => anchor.kind));
    });
  await expect.poll(anchored).toEqual([['point', 'circle']]);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Diameter' }).click();
  await click(anchorOnScreen(page, 0, 'circle', 'rim'));
  await expect(sheetText(/^⌀8$/)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await click(textOnScreen(page, '⌀8'));
  await page.locator('#dimension-angle').fill('225');
  await page.locator('#dimension-angle').press('Tab');
  await expect(sheetText(/^⌀8$/)).toHaveAttribute('text-anchor', 'end');

  // The title block names the part's material by itself.
  await page.keyboard.press('Escape');
  await click(sheetPoint(page, [20, 280]));
  await expect(page.locator('#title-material')).toHaveAttribute('placeholder', 'PLA');
  await expect(sheetText(/^PLA$/)).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await evidence(page, '99-drawing-findings');
});

/** Where a text of the sheet is on screen. */
async function textOnScreen(page: Page, text: string): Promise<{ x: number; y: number }> {
  const box = await page.locator('svg.sheet text').filter({ hasText: text }).first().boundingBox();
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
}

test('takes a circular pattern apart in one radial step (CAD-110)', async ({ page }) => {
  await plateProject(page, 'Radial');
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Component 1' }).click();
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  // Four plates around Z.
  await page.getByRole('button', { name: 'Pattern', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Circular pattern' }).click();
  await page.getByRole('checkbox', { name: 'Component 1 1', exact: true }).check();
  await page.locator('#pattern-axis').selectOption({ label: 'Z' });
  await page.locator('#pattern-count').fill('4');
  await page.locator('#pattern-count').press('Tab');
  await page.locator('#pattern-spacing').fill('90');
  await page.locator('#pattern-spacing').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Patterns' })).toContainText('Circular pattern 1');

  // The original and its copies in one step, each away from the Z axis.
  await page.getByRole('button', { name: 'Explode', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Component 1 1', exact: true }).check();
  for (const k of [1, 2, 3]) await page.getByRole('checkbox', { name: `Component 1 1 (copy ${k})`, exact: true }).check();
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByRole('list', { name: 'Steps' })).toContainText('Component 1 1 (copy 3)');
  await page.getByRole('checkbox', { name: 'Step 1 moves away from the axis' }).check();
  await page.getByRole('spinbutton', { name: 'Distance of step 1' }).fill('40');
  await page.getByRole('spinbutton', { name: 'Distance of step 1' }).press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Step 1 moves away from the axis' })).toBeChecked();
  await page.getByRole('slider', { name: 'Explode' }).fill('1');
  await standardView(page, 'Top');
  await evidence(page, '96-radial-explode');
});
