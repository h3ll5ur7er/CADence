import type {
  Appearance,
  AssemblyDocument,
  BodyMesh,
  DocumentId,
  Instance,
  Interference,
  Joint,
  Matrix4,
  MotionFrame,
  MotionStudy,
  Result,
} from '@core/contracts';

/** Every change to an assembly is one of these commands; ids come from the caller. */
export type AssemblyCommand =
  /** An empty name gets the next default ("Bracket 2"). */
  | { readonly type: 'insert-instance'; readonly instance: Instance }
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
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type AssemblyFormat = 'step' | 'stl' | 'obj' | '3mf';

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
  /** Instances whose solids overlap in the current positions. */
  interference(): Promise<Interference[]>;
  /** STEP keeps one named solid per instance; mesh formats get one object per instance. */
  exportAssembly(format: AssemblyFormat): Promise<Result<void>>;
  /** Hands a recorded animation to the user (a download or a save dialog). */
  saveRecording(bytes: Uint8Array, studyName: string): Promise<void>;
  /** Stops listening for component changes. */
  close(): void;
}

/** Assembly workflow (docs/Architecture/Components.md#assembly-manager). */
export interface AssemblyManager {
  open(documentId: DocumentId): Promise<Result<AssemblySession>>;
}
