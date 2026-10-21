/**
 * Augmented reality on phones and tablets (CAD-180): the model at real size where the device can
 * show it. iPhones and iPads open a USDZ file in Quick Look; Android (Chrome) and headsets start a
 * WebXR session that places the glTF model on a surface the camera finds.
 */

import { InjectionToken } from '@angular/core';

/** How this device shows models in its surroundings: Quick Look (USDZ) or WebXR (glTF). */
export type ArMode = 'quick-look' | 'webxr';

/** What the page sees of WebXR (the DOM library has no types for it). */
export interface XrSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, options?: object): Promise<unknown>;
}

export const xrSystem = (): XrSystem | undefined => (navigator as Navigator & { xr?: XrSystem }).xr;

/** The way this device shows a model in augmented reality, if it has one. */
export async function arSupport(): Promise<ArMode | undefined> {
  try {
    // Safari on iOS and iPadOS supports `<a rel="ar">`, which opens Quick Look; browsers that know no
    // link types throw.
    if (document.createElement('a').relList.supports?.('ar')) return 'quick-look';
  } catch {
    // No Quick Look.
  }
  try {
    if (await xrSystem()?.isSessionSupported('immersive-ar')) return 'webxr';
  } catch {
    // A browser that refuses to answer (no secure context, a policy) has no AR for us.
  }
  return undefined;
}

/** Asks how this device shows models in augmented reality; tests give their own answer. */
export const AR_SUPPORT = new InjectionToken<() => Promise<ArMode | undefined>>('ArSupport', { factory: () => arSupport });

/** Opens a USDZ file in Quick Look: a link with `rel="ar"` and a picture inside, as Safari asks. */
export function openQuickLook(file: { readonly name: string; readonly bytes: Uint8Array }): void {
  const url = URL.createObjectURL(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: 'model/vnd.usdz+zip' }));
  const link = document.createElement('a');
  link.rel = 'ar';
  // Real size: Quick Look does not let the model be scaled.
  link.href = `${url}#allowsContentScaling=0`;
  link.download = file.name;
  link.dataset['testid'] = 'quick-look';
  link.append(document.createElement('img'));
  document.body.append(link);
  link.click();
  link.remove();
  // Quick Look reads the file after the click; keep it for a while.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A running WebXR session: `end` closes it, `ended` settles when it is closed (by us or the browser). */
export interface ArSession {
  end(): void;
  readonly ended: Promise<void>;
}

/**
 * Shows a glTF file in a WebXR session: tap to place it where the ring lies, at real size. `overlay`
 * stays on screen during the session (its exit button).
 */
export async function startWebXr(glb: Uint8Array, overlay: HTMLElement): Promise<ArSession> {
  const xr = xrSystem();
  if (!xr) throw new Error('This browser has no WebXR.');
  // The session needs the user's tap: ask for it before loading anything.
  const session = (await xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } })) as { end(): Promise<void> };
  const { runArSession } = await import('./ar-session');
  return { end: () => void session.end().catch(() => undefined), ended: runArSession(session, glb) };
}
