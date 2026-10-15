/**
 * How a body (in a component) or an instance (in an assembly) is shown. Absent fields mean the
 * default: shown, in the theme's body colour, opaque. Appearance never changes geometry.
 */
export interface Appearance {
  readonly hidden?: boolean;
  /** `#rrggbb`. */
  readonly color?: string;
  /** From 0.1 (nearly clear) to 1 (opaque). */
  readonly opacity?: number;
}

export const minimumOpacity = 0.1;

/** Why an appearance cannot be stored, or `undefined` when it can. */
export function appearanceProblem(appearance: Appearance): string | undefined {
  if (appearance.color !== undefined && !/^#[0-9a-f]{6}$/i.test(appearance.color)) return 'A colour is written #rrggbb.';
  if (appearance.opacity !== undefined && !(appearance.opacity >= minimumOpacity && appearance.opacity <= 1)) {
    return `Opacity goes from ${minimumOpacity} to 1.`;
  }
  return undefined;
}

/** True when the appearance only holds defaults, so nothing needs storing. */
export const isDefaultAppearance = (appearance: Appearance): boolean =>
  !appearance.hidden && appearance.color === undefined && (appearance.opacity === undefined || appearance.opacity === 1);
