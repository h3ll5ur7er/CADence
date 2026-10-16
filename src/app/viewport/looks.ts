import type { Appearance, Finish, Vec3 } from '@core/contracts';

/** How a shown body is drawn. */
export interface Look {
  readonly color: string;
  readonly opacity: number;
  readonly finish?: Finish;
}

/**
 * The look of a body from its appearance layers, later layers winning (the component's body, then
 * the assembly instance). `undefined` when any layer hides it.
 */
export function lookOf(fallback: string, ...layers: readonly (Appearance | undefined)[]): Look | undefined {
  let look: Look = { color: fallback, opacity: 1 };
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.hidden) return undefined;
    const finish = layer.finish ?? look.finish;
    look = { color: layer.color ?? look.color, opacity: layer.opacity ?? look.opacity, ...(finish ? { finish } : {}) };
  }
  return look;
}

/** The section view as the user sets it: a principal plane or one parallel to a picked face, moved along its normal. */
export type SectionSetting =
  | { readonly plane: 'XY' | 'XZ' | 'YZ'; readonly offset: number; readonly flipped: boolean }
  | { readonly plane: 'face'; readonly normal: Vec3; readonly offset: number; readonly flipped: boolean };

/** A cutting plane: everything on the side `normal` points to is cut away. */
export interface SectionPlane {
  readonly normal: Vec3;
  readonly point: Vec3;
}

/** The axis a principal plane's offset is measured along, and the side its cut removes by default (the side a front, top or right view looks from). */
const principal: Readonly<Record<'XY' | 'XZ' | 'YZ', { readonly axis: Vec3; readonly removed: Vec3 }>> = {
  XY: { axis: [0, 0, 1], removed: [0, 0, 1] },
  XZ: { axis: [0, 1, 0], removed: [0, -1, 0] },
  YZ: { axis: [1, 0, 0], removed: [1, 0, 0] },
};

/** The direction a setting's offset is measured along: a principal axis, or the face's normal. */
export const sectionAxis = (setting: SectionSetting): Vec3 => (setting.plane === 'face' ? setting.normal : principal[setting.plane].axis);

export function sectionPlane(setting: SectionSetting): SectionPlane {
  const axis = sectionAxis(setting);
  const removed = setting.plane === 'face' ? setting.normal : principal[setting.plane].removed;
  const point: Vec3 = [axis[0] * setting.offset + 0, axis[1] * setting.offset + 0, axis[2] * setting.offset + 0];
  return { normal: setting.flipped ? [-removed[0] + 0, -removed[1] + 0, -removed[2] + 0] : removed, point };
}
