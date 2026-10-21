import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { center, evidence, typeDimension } from './support';

/** Phase 43, Anywhere: the viewer on phones (CAD-179), augmented reality (CAD-180) and onboarding (CAD-181). */

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Touches through the browser's own input: each frame lists where the fingers are; an empty frame lifts them. */
async function touch(page: Page, frames: readonly (readonly Point[])[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  let down = false;
  for (const points of frames) {
    const touchPoints = points.map((p, id) => ({ x: p.x, y: p.y, id }));
    const type = points.length === 0 ? 'touchEnd' : down ? 'touchMove' : 'touchStart';
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    down = points.length > 0;
    await page.waitForTimeout(16);
  }
  await cdp.detach();
}

/** Steps of a straight move from `from` to `to`. */
const along = (from: Point, to: Point, steps = 8): Point[] => Array.from({ length: steps + 1 }, (_, k) => ({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps }));

/** The 3D view's camera: where it is and how far from what it turns about. */
function camera(page: Page): Promise<{ position: number[]; distance: number }> {
  return page.evaluate(() => {
    // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
    return { position: scene.camera.position.toArray(), distance: scene.camera.position.distanceTo(scene.controls.target) };
  });
}

/** Where the first body's corners land on screen, as the box around them. */
function modelOnScreen(page: Page): Promise<{ left: number; right: number; top: number; bottom: number }> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
    const scene = viewport.scene();
    const p = viewport.bodies()[0].positions;
    const rect = scene.eventTarget.getBoundingClientRect();
    const Vector = scene.camera.position.constructor;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      const v = new Vector(p[i], p[i + 1], p[i + 2]).project(scene.camera);
      xs.push(rect.left + ((v.x + 1) / 2) * rect.width);
      ys.push(rect.top + ((1 - v.y) / 2) * rect.height);
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  });
}

/** Screen points on `count` different faces of the first body, each one the viewport itself picks there. */
function visibleFaces(page: Page, count: number): Promise<Point[]> {
  return page.evaluate((count) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
    const scene = viewport.scene();
    const mesh = viewport.bodies()[0];
    const rect = scene.eventTarget.getBoundingClientRect();
    const Vector = scene.camera.position.constructor;
    const found: { x: number; y: number }[] = [];
    for (const face of mesh.faces) {
      if (found.length === count) break;
      // The middle of the face's largest triangle, if a pick there finds the face.
      for (let t = face.start; t < face.start + face.count; t += 3) {
        const corner = (k: number) => [0, 1, 2].map((a) => mesh.positions[mesh.indices[t + k] * 3 + a]);
        const [a, b, c] = [corner(0), corner(1), corner(2)];
        const v = new Vector((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3).project(scene.camera);
        const point = { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
        // Away from the view cube, the phone bar and the sheet over the bottom of the view.
        if (point.y > rect.top + rect.height * 0.5 || point.y < rect.top + 140 || point.x > rect.right - 24 || point.x < rect.left + 24) continue;
        if (scene.pickUnder({ clientX: point.x, clientY: point.y })?.name === face.name) {
          found.push(point);
          break;
        }
      }
    }
    return found;
  }, count);
}

/** Opens a sample from the home page: a project of one's own made from it. */
async function openSample(page: Page, name: string, tap = false): Promise<void> {
  await page.goto('/');
  const sample = page.getByRole('button', { name: `Open sample ${name}` });
  await (tap ? sample.tap() : sample.click());
  await expect(page).toHaveURL(/\/projects\/[^/]+\/documents\//);
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
  // The sample's bodies are built and drawn.
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const viewport = document.querySelector('cad-viewport');
    return viewport !== null && ng.getComponent(viewport).bodies().length > 0;
  });
  await page.waitForTimeout(500);
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('opens a sample as a viewer: one finger turns, two pinch, a tap measures (CAD-179)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Samples' })).toBeVisible();
    // Nothing wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await evidence(page, 'phase-43-phone-home');
    await openSample(page, 'Wall bracket', true);

    // A viewer: the model fills the screen; touch tools instead of the modelling tools.
    const bar = page.getByRole('toolbar', { name: 'Viewer tools' });
    await expect(bar).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Model tools' })).toBeHidden();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeHidden();
    await expect(page.getByRole('complementary', { name: 'Project' })).toBeHidden();
    await expect(page.getByTestId('body-count')).toHaveCount(1);

    // One finger turns the view.
    const view = await page.locator('cad-viewport canvas').boundingBox();
    if (!view) throw new Error('no view');
    const middle = { x: view.x + view.width / 2, y: view.y + view.height / 3 };
    const before = await camera(page);
    await touch(page, [...along(middle, { x: middle.x + 120, y: middle.y + 40 }).map((p) => [p]), []]);
    await expect.poll(async () => (await camera(page)).position.map((v, k) => Math.abs(v - (before.position[k] as number))).reduce((a, b) => a + b)).toBeGreaterThan(5);
    // Two fingers spread apart zoom in.
    const turned = await camera(page);
    const pinch = Array.from({ length: 9 }, (_, k) => [
      { x: middle.x - 40 - k * 12, y: middle.y },
      { x: middle.x + 40 + k * 12, y: middle.y },
    ]);
    await touch(page, [...pinch, []]);
    await expect.poll(async () => (await camera(page)).distance).toBeLessThan(turned.distance * 0.9);
    await page.waitForTimeout(500);
    await bar.getByRole('button', { name: 'Zoom to fit' }).tap();
    // The whole bracket in view, also across the narrow screen.
    await expect.poll(async () => {
      const shown = await modelOnScreen(page);
      return shown.left >= 0 && shown.right <= 390 && shown.top >= 44;
    }).toBe(true);

    // A tap on a face measures it; a second face gives what lies between them.
    await bar.getByRole('button', { name: 'Measure' }).tap();
    await expect(bar.getByRole('button', { name: 'Measure' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(800);
    const [first, second] = await visibleFaces(page, 2);
    if (!first || !second) throw new Error('two faces in view');
    await expect(page.getByText('Tap faces, edges and corners')).toBeVisible();
    await page.touchscreen.tap(first.x, first.y);
    const sheet = page.getByRole('complementary', { name: 'Properties' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('measure-area')).toBeVisible();
    await page.touchscreen.tap(second.x, second.y);
    await expect(sheet.getByRole('list', { name: 'Measured elements' }).getByRole('listitem')).toHaveCount(2);
    await expect(sheet.getByTestId('measure-angle').or(sheet.getByTestId('measure-distance')).first()).toBeVisible();
    await evidence(page, 'phase-43-phone-measure');
    await bar.getByRole('button', { name: 'Measure' }).tap();
    await expect(sheet).toBeHidden();

    // The project's documents slide in over the model.
    await bar.getByRole('button', { name: 'Documents' }).tap();
    const drawer = page.getByRole('complementary', { name: 'Project' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Bracket');
    await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
    await evidence(page, 'phase-43-phone-documents');
    // A tap beside the drawer closes it.
    await page.getByRole('button', { name: 'Close documents' }).tap({ position: { x: 370, y: 300 } });
    await expect(drawer).toBeHidden();
  });

  test('shows the model in augmented reality through WebXR where the phone has it (CAD-180)', async ({ page }) => {
    // A phone whose browser can place models in the room (Chrome on Android): WebXR, stood in for.
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      Object.assign(window, { xrCalls: calls });
      Object.defineProperty(navigator, 'xr', {
        value: {
          isSessionSupported: async (mode: string) => mode === 'immersive-ar',
          requestSession: async (mode: string, options: unknown) => {
            calls.push({ mode, options });
            throw new DOMException('No camera in this test', 'NotSupportedError');
          },
        },
      });
    });
    await openSample(page, 'Wall bracket', true);
    const ar = page.getByRole('button', { name: 'View in AR' });
    await expect(ar).toHaveAttribute('data-ar', 'webxr');
    await evidence(page, 'phase-43-phone-ar');
    await ar.tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as { xrCalls: { mode: string; options: { requiredFeatures: string[] } }[] }).xrCalls)).toEqual([
      { mode: 'immersive-ar', options: expect.objectContaining({ requiredFeatures: ['hit-test'] }) },
    ]);
    await expect(page.getByRole('alert')).toContainText('Augmented reality could not start');
  });

  test('opens the model in Quick Look as USDZ on iPhones and iPads (CAD-180)', async ({ page }) => {
    // Safari's `<a rel="ar">`, stood in for: the link Quick Look would open is kept.
    await page.addInitScript(() => {
      const supports = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function (token: string) {
        return token === 'ar' || supports.call(this, token);
      };
      const opened: { rel: string; href: string; hasPicture: boolean; bytes?: number[] }[] = [];
      Object.assign(window, { quickLook: opened });
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        const link = { rel: this.rel, href: this.href, hasPicture: this.querySelector('img') !== null } as (typeof opened)[number];
        opened.push(link);
        void fetch(this.href.split('#')[0] as string)
          .then((r) => r.arrayBuffer())
          .then((b) => (link.bytes = [...new Uint8Array(b)]));
      };
    });
    await openSample(page, 'Wall bracket', true);
    const ar = page.getByRole('button', { name: 'View in AR' });
    await expect(ar).toHaveAttribute('data-ar', 'quick-look');
    await ar.tap();
    const opened = () => page.evaluate(() => (window as unknown as { quickLook: { rel: string; href: string; hasPicture: boolean; bytes?: number[] }[] }).quickLook[0]);
    await expect.poll(opened).toMatchObject({ rel: 'ar', href: expect.stringMatching(/^blob:.*#allowsContentScaling=0$/), hasPicture: true, bytes: expect.any(Array) });
    const text = new TextDecoder().decode(new Uint8Array((await opened())?.bytes ?? []));
    expect(text.startsWith('PK')).toBe(true);
    expect(text).toContain('model.usda');
    expect(text).toContain('upAxis = "Y"');
  });

  test('a shared HTML viewer is touched on a phone: tap to measure, pinch to zoom (CAD-179)', async ({ browser, page }, info) => {
    // Made on a computer and sent to the phone.
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openSample(desktop, 'Wall bracket');
    await desktop.getByRole('button', { name: 'Export' }).click();
    const download = desktop.waitForEvent('download');
    await desktop.getByRole('menuitem', { name: 'Viewer (HTML, to share)' }).click();
    const file = info.outputPath('Bracket.html');
    await (await download).saveAs(file);
    await desktop.close();
    expect(readFileSync(file, 'utf8')).toContain('two fingers to pan, pinch to zoom');

    await page.goto(`file://${file.replace(/\\/g, '/')}`);
    // Small screens start with the parts folded away.
    await expect(page.locator('#parts-box')).not.toHaveAttribute('open');
    await expect(page.locator('#hint')).toContainText('pinch to zoom');
    const picture = () => page.evaluate(() => (document.getElementById('view') as HTMLCanvasElement).toDataURL());
    const before = await picture();
    const box = await page.locator('#view').boundingBox();
    if (!box) throw new Error('no view');
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 4 };
    await touch(page, [...Array.from({ length: 9 }, (_, k) => [{ x: middle.x - 30 - k * 10, y: middle.y }, { x: middle.x + 30 + k * 10, y: middle.y }]), []]);
    expect(await picture()).not.toBe(before);

    await page.getByRole('button', { name: 'Fit' }).tap();
    await page.getByRole('button', { name: 'Measure' }).tap();
    await expect(page.getByRole('status')).toHaveText('Tap two points on the model.');
    // Points on the model: where the picture differs from the background.
    const points = await page.evaluate(() => {
      const canvas = document.getElementById('view') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d') as CanvasRenderingContext2D;
      context.drawImage(canvas, 0, 0);
      const { data } = context.getImageData(0, 0, copy.width, copy.height);
      const hits: { x: number; y: number }[] = [];
      const scale = canvas.clientWidth / canvas.width;
      for (let y = 0; y < copy.height * 0.45; y += 6) {
        for (let x = 0; x < copy.width; x += 6) {
          const i = (y * copy.width + x) * 4;
          // The background is #eef2f3; the model is darker.
          if ((data[i] as number) < 200) hits.push({ x: x * scale, y: y * scale });
        }
      }
      return [hits[Math.floor(hits.length * 0.3)], hits[Math.floor(hits.length * 0.7)]];
    });
    for (const point of points) if (point) await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByRole('status')).toHaveText(/Distance \d+\.\d\d mm/);
    await evidence(page, 'phase-43-phone-viewer');
  });
});

test('exports glTF and USDZ, and tools link to their page of the User guide (CAD-180, CAD-181)', async ({ page }) => {
  await openSample(page, 'Wall bracket');
  const exported = async (item: string) => {
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: item }).click();
    const file = await download;
    return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
  };
  const gltf = await exported('glTF (GLB, viewers and AR)');
  expect(gltf.name).toBe('Bracket.glb');
  expect(gltf.bytes.subarray(0, 4).toString('latin1')).toBe('glTF');
  const json = JSON.parse(gltf.bytes.subarray(20, 20 + gltf.bytes.readUInt32LE(12)).toString('utf8')) as { asset: { version: string }; meshes: unknown[]; accessors: { max?: number[] }[] };
  expect(json.asset.version).toBe('2.0');
  expect(json.meshes.length).toBeGreaterThan(0);
  // Metres: the bracket is tens of millimetres.
  expect(Math.max(...json.accessors.flatMap((a) => a.max ?? []))).toBeLessThan(0.5);
  const usdz = await exported('USDZ (AR on iPhone and iPad)');
  expect(usdz.name).toBe('Bracket.usdz');
  expect(usdz.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(usdz.bytes.toString('latin1')).toContain('metersPerUnit = 1');

  // The measure tool's “?” opens its page of the User guide.
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const help = page.getByRole('link', { name: 'Help: Measuring' });
  await expect(help).toHaveAttribute('href', /docs\/User-guide\/Measuring-and-checking\.md#measure$/);
  await expect(help).toHaveAttribute('target', '_blank');
  await evidence(page, 'phase-43-help-link');
});

test.describe('the first start', () => {
  // A person at the keys: the tour starts by itself only where the browser is not automated.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  });

  test('offers the tour once; Skip keeps it away', async ({ page }) => {
    await page.goto('/');
    const card = page.getByRole('dialog', { name: 'Welcome to CADence' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Skip' }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Samples' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome to CADence' })).toHaveCount(0);
  });

  test('the tour runs through a first part: a project, a sketch, an extrude, an export (CAD-181)', async ({ page }) => {
    await page.goto('/');
    const card = page.getByRole('dialog');
    await expect(card).toHaveAccessibleName('Welcome to CADence');
    await evidence(page, 'phase-43-tour-welcome');
    await card.getByRole('button', { name: 'Take the tour' }).click();

    await expect(card).toHaveAccessibleName('A project');
    await page.getByRole('button', { name: 'New project' }).first().click();
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(card).toHaveAccessibleName('A sketch');
    await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
    await page.getByRole('button', { name: 'New sketch' }).click();
    await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();

    await expect(card).toHaveAccessibleName('Draw a rectangle');
    await page.waitForTimeout(500);
    const origin = await center(page, 'circle.point.origin');
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.click(origin.x, origin.y);
    await page.mouse.click(origin.x + 240, origin.y - 120);
    await page.getByRole('button', { name: 'Dimension', exact: true }).click();
    await page.mouse.click(origin.x + 120, origin.y);
    await page.mouse.click(origin.x + 120, origin.y + 50);
    await typeDimension(page, '60');
    await evidence(page, 'phase-43-tour-sketch');
    await card.getByRole('button', { name: 'Next' }).click();

    await expect(card).toHaveAccessibleName('Finish the sketch');
    await page.getByRole('button', { name: 'Finish sketch' }).click();

    await expect(card).toHaveAccessibleName('Extrude');
    await page.getByRole('button', { name: 'Extrude', exact: true }).click();
    await page.locator('#feature-distance').fill('6 mm');
    await page.locator('#feature-distance').press('Tab');
    await page.getByRole('button', { name: 'OK' }).click();

    await expect(card).toHaveAccessibleName('Export');
    await expect(page.getByTestId('body-count')).toHaveText('1');
    await evidence(page, 'phase-43-tour-export');
    await card.getByRole('button', { name: 'Next' }).click();

    await expect(card).toHaveAccessibleName('That is a part');
    await expect(card.getByRole('link', { name: 'User guide' })).toHaveAttribute('href', /Getting-started\.md/);
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('cadence.tour'))).toBe('done');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
