import type { Profile, ProfileEdge, ProfileLoop, Vec2 } from '../index';

/** Hand-made profiles for modeling tests (the Sketch Engine finds real ones). */

function loop(edges: ProfileEdge[], polygon: Vec2[]): ProfileLoop {
  return { edges, polygon };
}

/** Counter-clockwise rectangle; side sources are `${prefix}-bottom/right/top/left`. */
export function rectangleLoop(x: number, y: number, width: number, height: number, prefix = 'rect'): ProfileLoop {
  const corners: Vec2[] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
  const names = ['bottom', 'right', 'top', 'left'];
  const edges = corners.map((start, i): ProfileEdge => ({
    kind: 'line',
    start,
    end: corners[(i + 1) % 4] as Vec2,
    source: `${prefix}-${names[i]}`,
  }));
  return loop(edges, corners);
}

/** A circle as two half arcs; `ccw` false makes it a hole loop. */
export function circleLoop(cx: number, cy: number, r: number, source = 'circle', ccw = true): ProfileLoop {
  const right: Vec2 = [cx + r, cy];
  const left: Vec2 = [cx - r, cy];
  const edges: ProfileEdge[] = ccw
    ? [
        { kind: 'arc', source, start: right, end: left, center: [cx, cy], radius: r, ccw: true },
        { kind: 'arc', source, start: left, end: right, center: [cx, cy], radius: r, ccw: true },
      ]
    : [
        { kind: 'arc', source, start: right, end: left, center: [cx, cy], radius: r, ccw: false },
        { kind: 'arc', source, start: left, end: right, center: [cx, cy], radius: r, ccw: false },
      ];
  const polygon = Array.from({ length: 72 }, (_, i): Vec2 => {
    const a = ((ccw ? 1 : -1) * 2 * Math.PI * i) / 72;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  return loop(edges, polygon);
}

export function profile(outer: ProfileLoop, holes: ProfileLoop[] = [], id = 'p'): Profile {
  return { id, outer, holes, area: 0 };
}
