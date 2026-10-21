import type {
  Appearance,
  AssemblyDocument,
  ExplodedView,
  BodyMesh,
  Cable,
  DocumentId,
  Instance,
  InstancePattern,
  Interference,
  Joint,
  LimitHold,
  Matrix4,
  Measurement,
  MotionFrame,
  MotionLink,
  MotionStudy,
  PlaneFrame,
  ReachTarget,
  Result,
  TopologyRef,
  Vec3,
} from '@core/contracts';
import type { ViewerFormat } from '@core/utilities/scene';

/** Every change to an assembly is one of these commands; ids come from the caller. */
export type AssemblyCommand =
  /** An empty name gets the next default ("Bracket 2"); with a joint, the instance is joined in the same change. */
  | { readonly type: 'insert-instance'; readonly instance: Instance; readonly joint?: Joint }
  /** Also removes the instance's joints. */
  | { readonly type: 'remove-instance'; readonly instanceId: string }
  | { readonly type: 'rename-instance'; readonly instanceId: string; readonly name: string }
  /** Refused for instances a joint places. */
  | { readonly type: 'move-instance'; readonly instanceId: string; readonly transform: Matrix4 }
  | { readonly type: 'ground-instance'; readonly instanceId: string; readonly grounded: boolean }
  /** How an instance is shown; an appearance of defaults only removes it. */
  | { readonly type: 'set-instance-appearance'; readonly instanceId: string; readonly appearance: Appearance }
  /** Shows a configuration of the instance's component (absent: its parameters' own values). */
  | { readonly type: 'set-instance-configuration'; readonly instanceId: string; readonly configuration?: string }
  /** An empty name gets the next default ("Revolute 2"). */
  | { readonly type: 'add-joint'; readonly joint: Joint }
  | { readonly type: 'edit-joint'; readonly joint: Joint }
  /** Also removes the joint's motion keys. */
  | { readonly type: 'remove-joint'; readonly jointId: string }
  | { readonly type: 'set-joint-values'; readonly jointId: string; readonly values: readonly number[] }
  /**
   * Several joints' values at once, solved once and all held while the others follow (CAD-195): a
   * parallel mechanism's legs. Refused, leaving the assembly as it was, when they cannot all hold.
   */
  | { readonly type: 'set-joints'; readonly joints: readonly { readonly jointId: string; readonly values: readonly number[] }[] }
  /**
   * Sets the joints so the targets are met (inverse kinematics, CAD-188): the joints leading to their
   * instances (and closing loops on the way) move, starting from their values, within limits; those in
   * `hold` keep theirs. A target out of reach gives the nearest pose and a note of how far off it is.
   */
  | { readonly type: 'reach'; readonly targets: readonly ReachTarget[]; readonly hold?: readonly string[] }
  /** Adds a pattern of instances, or changes one (same id); an empty name gets the next default ("Linear pattern 2"). */
  | { readonly type: 'set-pattern'; readonly pattern: InstancePattern }
  | { readonly type: 'remove-pattern'; readonly patternId: string }
  /** Adds a motion link, or changes one (same id); an empty name gets the next default ("Gear 2"). */
  | { readonly type: 'set-link'; readonly link: MotionLink }
  | { readonly type: 'remove-link'; readonly linkId: string }
  /** Adds an exploded view, or changes one (same id). */
  | { readonly type: 'set-exploded-view'; readonly view: ExplodedView }
  | { readonly type: 'remove-exploded-view'; readonly viewId: string }
  /** Adds a cable or hose (CAD-192), or changes one (same id); an empty name gets the next default ("Cable 2"). */
  | { readonly type: 'set-cable'; readonly cable: Cable }
  | { readonly type: 'remove-cable'; readonly cableId: string }
  | { readonly type: 'add-study'; readonly study: MotionStudy }
  | { readonly type: 'edit-study'; readonly study: MotionStudy }
  | { readonly type: 'remove-study'; readonly studyId: string };

/** A component used in the assembly, as its published result. */
export interface ComponentView {
  readonly id: DocumentId;
  /** The configuration shown (absent: the component's parameters' own values). */
  readonly configuration?: string;
  /** The configurations the component has, to choose from. */
  readonly configurations?: readonly { readonly id: string; readonly name: string }[];
  readonly name: string;
  /** `loading` while the Design Manager regenerates it; `missing` when the document is gone. */
  readonly status: 'loading' | 'ready' | 'missing';
  readonly bodies: readonly BodyMesh[];
  /** How the component shows its bodies, by body id. */
  readonly appearances?: Readonly<Record<string, Appearance>>;
}

export interface AssemblyState {
  readonly document: AssemblyDocument;
  /** By source: the component, or `<component>@<configuration>` (`sourceKey`). */
  readonly components: ReadonlyMap<string, ComponentView>;
  /** Where each instance is. */
  readonly poses: ReadonlyMap<string, Matrix4>;
  /** Instances a joint places (the others can be moved). */
  readonly placed: ReadonlySet<string>;
  /** Joints that do not hold, with the reason. */
  readonly jointErrors: ReadonlyMap<string, string>;
  /** Copies made by patterns (placed in `poses` too): the instance each copies, and the pattern. */
  readonly copies: ReadonlyMap<string, { readonly instance: string; readonly pattern: string }>;
  /** Where each joint is (its frame on instance A, offset included), in assembly coordinates: its free directions are its axes. */
  readonly jointFrames: ReadonlyMap<string, PlaneFrame>;
  /** Where limits hold joints in this pose (CAD-186). */
  readonly holds: readonly LimitHold[];
  /** What the last change did that was not asked for, such as keys past a joint's limits (CAD-186). */
  readonly notes: readonly string[];
  /** Each cable where the poses put it (CAD-192): its length and tightest bend, and a tube to draw. */
  readonly cables: readonly CableState[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type AssemblyFormat = 'step' | 'stl' | 'obj' | '3mf';

/** A face, edge or vertex of an instance (or a pattern's copy). */
export interface PlacedRef extends TopologyRef {
  readonly instance: string;
}

/** Where two instances hit during a motion study: the first moment, and how much overlaps then (mm³). */
export interface Collision {
  readonly time: number;
  readonly a: string;
  readonly b: string;
  readonly volume: number;
}

/** How a motion study is checked for collisions. */
export interface CollisionOptions {
  /** Called after each moment checked. */
  readonly onProgress?: (done: number, total: number) => void;
  /** Stop after this long (the moments checked so far are reported). */
  readonly seconds?: number;
}

/** Where instances hit while a study plays, and how many of its moments were checked. */
export interface CollisionReport {
  readonly collisions: readonly Collision[];
  readonly checked: number;
  readonly moments: number;
  /** The first moment each limit held a joint while the study played (CAD-186). */
  readonly holds?: readonly (LimitHold & { readonly time: number })[];
  /** Where cables run through parts, and how long and how tightly bent they get (CAD-192). */
  readonly cableHits?: readonly CableHit[];
  readonly cables?: readonly CableReport[];
}

/** A cable in a pose (CAD-192): mm. */
export interface CableState {
  readonly id: string;
  readonly length: number;
  readonly bendRadius: number;
  /** Where it bends tighter than its minimum radius allows. */
  readonly tooTight?: Vec3;
  readonly mesh: BodyMesh;
}

/** Where a cable runs through a part while a study plays (CAD-192): the first moment. */
export interface CableHit {
  readonly cable: string;
  readonly instance: string;
  readonly time: number;
  readonly at: Vec3;
}

/** A cable over a study (CAD-192): its longest and its tightest moment. */
export interface CableReport {
  readonly cable: string;
  readonly longest: { readonly length: number; readonly time: number };
  readonly tightest: { readonly radius: number; readonly time: number };
}

/** An assembly at a moment of a study (CAD-196). */
export interface StudyMoment {
  readonly time: number;
  readonly poses: ReadonlyMap<string, Matrix4>;
  readonly values: ReadonlyMap<string, readonly number[]>;
}

/** Joint values that meet targets (CAD-188), and how far the worst target stays off. */
export interface Reached {
  readonly values: ReadonlyMap<string, readonly number[]>;
  readonly poses: ReadonlyMap<string, Matrix4>;
  readonly miss: { readonly distance: number; readonly angle: number };
}

/** What `loads` takes into account (CAD-189). */
export interface LoadOptions {
  /** m/s²; straight down along −z at 9.81 by default. */
  readonly gravity?: Vec3;
  /** Masses carried at points of instances (kg, mm in the instance's coordinates): a payload. */
  readonly payloads?: readonly { readonly instance: string; readonly point: Vec3; readonly mass: number }[];
  /** Over this study's moments instead of the pose the assembly stands in. */
  readonly study?: string;
  readonly fps?: number;
  /** With the study: the parts' accelerations too (their centres', not their spin). */
  readonly dynamic?: boolean;
}

/** A load on a joint's freedom: N·m for a turn, N for a slide; over a study, the largest and when. */
export interface LoadLine {
  readonly joint: string;
  readonly dof: number;
  readonly load: number;
  readonly unit: 'N·m' | 'N';
  readonly time?: number;
}

export interface LoadReport {
  readonly loads: readonly LoadLine[];
  /** Over a study: how many moments were weighed. */
  readonly moments?: number;
}

/** A line of the bill of materials: one component (or configuration of it) and how many there are. */
export interface BomLine {
  readonly component: string;
  readonly configuration?: string;
  readonly count: number;
  readonly material: string;
  /** Cables (CAD-192): how long, mm, as the assembly stands. */
  readonly length?: number;
  /** Grams, each. */
  readonly mass: number;
  /** The instances (and copies) it covers. */
  readonly instances: readonly string[];
}

/**
 * A picture of the assembly for each state of an exploded view: assembled, then after each step. A
 * JPEG (the app's viewport), or RGB pixels deflated (scripts, which have no JPEG encoder).
 */
export type InstructionPicture = { readonly width: number; readonly height: number } & ({ readonly jpeg: Uint8Array } | { readonly deflatedRgb: Uint8Array });

/** Mass properties of the whole assembly, from each component's material. */
export interface AssemblyProperties {
  /** Grams. */
  readonly mass: number;
  /** mm³. */
  readonly volume: number;
  readonly centerOfMass: Vec3;
  readonly parts: readonly { readonly instance: string; readonly name: string; readonly material: string; readonly mass: number }[];
}

/** An editing session on one assembly document. */
export interface AssemblySession {
  state(): AssemblyState;
  subscribe(listener: (state: AssemblyState) => void): () => void;
  execute(command: AssemblyCommand): Promise<Result<void>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Where the instances would be with a joint at other values, without changing the document (slider drags). */
  previewJoint(jointId: string, values: readonly number[]): Promise<Result<ReadonlyMap<string, Matrix4>>>;
  /** The frames of a motion study, `fps` per second. */
  motion(studyId: string, fps: number): Promise<Result<readonly MotionFrame[]>>;
  /** Area, length, radius, distance and angle of faces, edges and vertices of instances, where they stand or at a moment of a study (CAD-196). */
  measure(refs: readonly PlacedRef[], moment?: { readonly study: string; readonly time: number }): Promise<Result<Measurement>>;
  /** Total mass, volume and centre of mass of the shown instances and copies. */
  properties(): Promise<AssemblyProperties>;
  /** Every instance's place and every joint's values at a moment of a study (CAD-196); pattern copies included. */
  at(studyId: string, time: number): Promise<Result<StudyMoment>>;
  /** The joint values that meet the targets, without changing the document (CAD-188). */
  reach(targets: readonly ReachTarget[], hold?: readonly string[]): Promise<Result<Reached>>;
  /** What each actuator must hold, as the assembly stands or over a study (CAD-189). */
  loads(options?: LoadOptions): Promise<Result<LoadReport>>;
  /**
   * Where instances and pattern copies hit while a motion study plays (sampled `fps` times a second):
   * the first moment for each pair. Pairs that keep their relative position are tested once.
   */
  collisions(studyId: string, fps: number, options?: CollisionOptions): Promise<Result<CollisionReport>>;
  /** Where the instances are with the first `steps` steps of an exploded view applied (all by default), the last one by `amount` (0 … 1). */
  explode(viewId: string, steps?: number, amount?: number): ReadonlyMap<string, Matrix4>;
  /** The components of the assembly with their counts, materials and masses. */
  billOfMaterials(): Promise<readonly BomLine[]>;
  /** The bill of materials as a CSV file. */
  exportBillOfMaterials(): Promise<Result<void>>;
  /**
   * Build instructions as a PDF: the parts list, then one page per step (the steps of the exploded
   * view in reverse, fitting its parts), from pictures of the assembled state and after each step.
   */
  exportInstructions(viewId: string, pictures: readonly InstructionPicture[]): Promise<Result<void>>;
  /** Instances whose solids overlap in the current positions. */
  /** With `onProgress`, the parts are checked one at a time against the others, and told after each (CAD-134). */
  interference(options?: { readonly onProgress?: (done: number, total: number) => void }): Promise<Interference[]>;
  /** STEP keeps one named solid per instance; mesh formats get one object per instance. */
  exportAssembly(format: AssemblyFormat): Promise<Result<void>>;
  /**
   * The assembly to share: one HTML file with a viewer (turn, measure, hide, explode) for people
   * without CADence, or glTF or USDZ for other viewers and augmented reality (CAD-180), at real size.
   */
  exportViewer(format?: ViewerFormat): Promise<Result<void>>;
  /** The file `exportViewer` delivers, for the app to show itself (augmented reality). */
  viewerFile(format: ViewerFormat): Promise<Result<{ readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }>>;
  /** Hands a recorded animation to the user (a download or a save dialog). */
  saveRecording(bytes: Uint8Array, studyName: string): Promise<void>;
  /**
   * Reads again the components whose documents changed since they were loaded without an event
   * saying so: another process (the app, a script) edited them in the same project folders (CAD-116).
   */
  catchUp(): Promise<void>;
  /** Stops listening for component changes. */
  close(): void;
}

/** Assembly workflow (docs/Architecture/Components.md#assembly-manager). */
export interface AssemblyManager {
  open(documentId: DocumentId): Promise<Result<AssemblySession>>;
}
