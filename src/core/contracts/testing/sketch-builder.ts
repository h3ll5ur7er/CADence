import type { Sketch, SketchConstraint, SketchEntity } from '../sketch';

/** Terse sketch construction for tests. */
export class SketchBuilder {
  private readonly entities: SketchEntity[] = [];
  private readonly constraints: SketchConstraint[] = [];
  private next = 0;

  point(x: number, y: number, id = `p${++this.next}`): string {
    this.entities.push({ id, kind: 'point', x, y });
    return id;
  }

  line(start: string, end: string, construction = false, id = `l${++this.next}`): string {
    this.entities.push({ id, kind: 'line', start, end, construction });
    return id;
  }

  circle(center: string, radius: number, construction = false, id = `c${++this.next}`): string {
    this.entities.push({ id, kind: 'circle', center, radius, construction });
    return id;
  }

  arc(center: string, start: string, end: string, construction = false, id = `a${++this.next}`): string {
    this.entities.push({ id, kind: 'arc', center, start, end, construction });
    return id;
  }

  /** Closed polygon through the given corners; returns the line ids in order. */
  polygon(...corners: [number, number][]): string[] {
    const points = corners.map(([x, y]) => this.point(x, y));
    return points.map((p, i) => this.line(p, points[(i + 1) % points.length] as string));
  }

  constrain(constraint: SketchConstraint): string {
    this.constraints.push(constraint);
    return constraint.id;
  }

  build(): Sketch {
    return {
      id: 's1',
      type: 'sketch',
      name: 'Sketch 1',
      suppressed: false,
      plane: 'XY',
      entities: [...this.entities],
      constraints: [...this.constraints],
    };
  }
}
