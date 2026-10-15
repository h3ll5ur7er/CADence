import type { Vec3 } from './feature';

/** A face of a tessellated body: a range of triangle indices plus what picking and sketching need. */
export interface MeshFace {
  readonly name: string;
  /** First index into `indices` and number of indices (3 per triangle). */
  readonly start: number;
  readonly count: number;
  readonly planar: boolean;
  readonly center: Vec3;
}

export interface MeshEdge {
  readonly name: string;
  /** First vertex in `edgePositions` and number of vertices of this edge's polyline segments (pairs). */
  readonly start: number;
  readonly count: number;
}

/** A solid body ready for rendering; buffers are transferable between threads. */
export interface BodyMesh {
  readonly body: string;
  readonly key: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly faces: readonly MeshFace[];
  /** Line segments (pairs of points) of all edges. */
  readonly edgePositions: Float32Array;
  readonly edges: readonly MeshEdge[];
}

/** A body in the model: its id (the feature that created it) and the cache key of its shape in the geometry worker. */
export interface BodyState {
  readonly id: string;
  readonly key: string;
}

/** How finely solids are turned into triangles for STL, 3MF and OBJ: deviation from the true surface. */
export type MeshQuality = 'draft' | 'normal' | 'fine';
