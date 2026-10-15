import { describe, expect, it } from 'vitest';
import { compose, fromFrame, identity, invertRigid, type Matrix4, rotation, rotationVector, transformPoint, translation, translationOf } from './transform';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, 9));

describe('rigid transforms', () => {
  it('rotates and translates points, applied right to left', () => {
    const m = compose(translation([10, 0, 0]), rotation([0, 0, 1], Math.PI / 2));
    close(transformPoint(m, [1, 0, 0]), [10, 1, 0]);
  });

  it('builds transforms from frames', () => {
    const m = fromFrame([1, 2, 3], [0, 1, 0], [-1, 0, 0], [0, 0, 1]);
    close(transformPoint(m, [1, 0, 0]), [1, 3, 3]);
  });

  it('inverts rigid transforms', () => {
    const m = compose(translation([5, -2, 7]), rotation([0, 1, 0], 0.7), rotation([1, 0, 0], -1.1));
    close(compose(m, invertRigid(m)), identity());
    close(translationOf(compose(invertRigid(m), m)), [0, 0, 0]);
  });

  it('extracts the rotation vector, including half turns', () => {
    close(rotationVector(identity()), [0, 0, 0]);
    close(rotationVector(rotation([0, 0, 1], 0.3)), [0, 0, 0.3]);
    const axis = [1, 2, 2].map((v) => v / 3) as [number, number, number];
    close(rotationVector(rotation(axis, 1.2)), axis.map((v) => v * 1.2));
    const half: Matrix4 = rotation([0, 1, 0], Math.PI);
    close(rotationVector(half).map(Math.abs), [0, Math.PI, 0]);
  });
});
