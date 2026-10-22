import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { jointDofs, type Matrix4, type MotionCarry, type MotionDrive, type MotionFrame, type MotionKey, type MotionStudy } from '@core/contracts';
import type { Collision } from '@core/managers/assembly';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';
import { HelpLink } from '../../shared/help';

const fps = 30;

/** A motion study: keyframes of joint values over time, played back in the view and recorded to video. */
@Component({
  selector: 'cad-motion-panel',
  imports: [HelpLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (study(); as study) {
      <p class="eyebrow">Motion study</p>
      <div class="head">
        <h2>{{ study.name }}</h2>
        <cad-help topic="motion" />
        <button type="button" class="icon-btn" [attr.aria-label]="'Delete ' + study.name" title="Delete" (click)="remove(study)">
          <cad-icon name="trash" [size]="14" />
        </button>
      </div>
      <div class="grid">
        <label class="field">Name<input id="study-name" type="text" [value]="study.name" (change)="save(study, { name: text($event) })" /></label>
        <label class="field">Duration (s)<input id="study-duration" type="number" min="0.1" step="any" [value]="study.duration" (change)="save(study, { duration: number($event) })" /></label>
      </div>

      <table class="keys" aria-label="Keys">
        <thead>
          <tr><th>Time</th><th>Joint</th><th>Values</th><th>Ease</th><th><span class="visually-hidden">Delete</span></th></tr>
        </thead>
        <tbody>
          @for (key of sortedKeys(); track $index) {
            <tr>
              <td class="mono">{{ key.time }} s</td>
              <td>{{ jointName(key.joint) }}</td>
              <td class="mono" [class.past-limit]="!!pastLimit(key)" [attr.title]="pastLimit(key) || null">{{ key.values.join(', ') }}</td>
              <td><input type="checkbox" [attr.aria-label]="'Ease into the key at ' + key.time + ' s'" [checked]="!!key.ease" (change)="ease(study, key, $any($event.target).checked)" /></td>
              <td>
                <button type="button" class="icon-btn" aria-label="Delete key" (click)="removeKey(study, key)"><cad-icon name="trash" [size]="12" /></button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="hint">Add keys: a joint's values at a moment.</td></tr>
          }
        </tbody>
      </table>
      @if (joints().length) {
        <div class="grid">
          <label class="field">Time (s)<input id="key-time" type="number" min="0" [max]="study.duration" step="any" [value]="keyTime()" (change)="keyTime.set(number($event))" /></label>
          <label class="field">
            Joint
            <select id="key-joint" (change)="keyJoint.set(text($event))">
              @for (j of joints(); track j.id) {
                <option [value]="j.id" [selected]="j.id === selectedJoint()">{{ j.name }}</option>
              }
            </select>
          </label>
        </div>
        <button type="button" class="btn" (click)="addKey(study)"><cad-icon name="plus" /> Key at current values</button>
      } @else {
        <p class="hint">Add a joint first; keys drive joints.</p>
      }

      <fieldset>
        <legend>Constant speeds</legend>
        @for (drive of study.drives ?? []; track $index) {
          <div class="drive">
            <span>{{ freedomName(drive) }}</span>
            <input type="number" step="any" [attr.aria-label]="'Speed of ' + freedomName(drive)" [value]="shownSpeed(drive)" (change)="setSpeed(study, drive, number($event))" />
            <span class="muted">{{ isTurn(drive) ? 'rpm' : 'mm/s' }}</span>
            <button type="button" class="icon-btn" aria-label="Delete speed" (click)="removeDrive(study, drive)"><cad-icon name="trash" [size]="12" /></button>
          </div>
        }
        <div class="drive">
          <select aria-label="Freedom to drive" (change)="driveChoice.set(text($event))">
            @for (f of freedoms(); track f.key) {
              <option [value]="f.key" [selected]="f.key === driveKey()">{{ f.label }}</option>
            }
          </select>
          <button type="button" class="btn" [disabled]="!freedoms().length" (click)="addDrive(study)"><cad-icon name="plus" /> Speed</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Carried parts</legend>
        @for (carry of study.carries ?? []; track $index) {
          <div class="drive" data-testid="carry">
            <span>{{ instanceName(carry.instance) }} by {{ instanceName(carry.by) }}, {{ carry.from }}–{{ carry.until ?? study.duration }} s</span>
            <button type="button" class="icon-btn" [attr.aria-label]="'Stop carrying ' + instanceName(carry.instance)" (click)="removeCarry(study, carry)"><cad-icon name="trash" [size]="12" /></button>
          </div>
        }
        @if (carriable().length && store.state()?.document?.instances?.length) {
          <div class="grid">
            <label class="field">Part<select aria-label="Part to carry" (change)="carryPart.set(text($event))">
              @for (i of carriable(); track i.id) {
                <option [value]="i.id" [selected]="i.id === carryPartId()">{{ i.name }}</option>
              }
            </select></label>
            <label class="field">Carried by<select aria-label="Carried by" (change)="carryBy.set(text($event))">
              @for (i of store.state()?.document?.instances ?? []; track i.id) {
                <option [value]="i.id" [selected]="i.id === carryById()">{{ i.name }}</option>
              }
            </select></label>
            <label class="field">From (s)<input type="number" min="0" [max]="study.duration" step="any" aria-label="Carried from" [value]="carryFrom()" (change)="carryFrom.set(number($event))" /></label>
            <label class="field">Until (s)<input type="number" min="0" [max]="study.duration" step="any" aria-label="Carried until" placeholder="end" (change)="carryUntil.set(text($event))" /></label>
          </div>
          <button type="button" class="btn" (click)="addCarry(study)"><cad-icon name="plus" /> Carry</button>
        } @else {
          <p class="hint">A part no joint holds can be picked up by another: a workpiece by a gripper.</p>
        }
      </fieldset>

      <div class="transport">
        <button type="button" class="icon-btn" [attr.aria-label]="playing() ? 'Stop' : 'Play'" (click)="playing() ? stop() : play(study)">
          <cad-icon [name]="playing() ? 'stop' : 'play'" [size]="18" />
        </button>
        <input type="range" aria-label="Time" min="0" [max]="study.duration" step="any" [value]="time()" (input)="scrub(study, number($event))" />
        <span class="mono" data-testid="motion-time">{{ time().toFixed(2) }} s</span>
      </div>
      <button type="button" class="btn" [class.recording]="recording()" [disabled]="playing()" (click)="record(study)">
        <cad-icon name="record" /> {{ recording() ? 'Recording…' : 'Record video' }}
      </button>
      <button type="button" class="btn" [disabled]="checking()" (click)="checkCollisions(study)"><cad-icon name="overlap" /> {{ checking() ? 'Checking…' : 'Check collisions' }}</button>
      @if (hits(); as hits) {
        @if (hits.length === 0) {
          <p class="ok" data-testid="collision-result">No parts hit each other.</p>
        } @else {
          <ul class="hits" aria-label="Collisions" data-testid="collision-result">
            @for (hit of hits; track hit.a + hit.b) {
              <li>
                <button type="button" class="link" (click)="showHit(study, hit)">{{ instanceName(hit.a) }} hits {{ instanceName(hit.b) }} at {{ hit.time.toFixed(2) }} s</button>
              </li>
            }
          </ul>
          <label class="check"><input type="checkbox" [checked]="stopAtHit()" (change)="stopAtHit.set($any($event.target).checked)" /> Stop playing at the first hit</label>
        }
      }
    }
  `,
  styleUrl: './assembly-panels.scss',
})
export class MotionPanel {
  readonly studyId = input.required<string>();
  /** The viewport's picture as a video stream, for recording. */
  readonly capture = input<(fps: number) => MediaStream | undefined>(() => undefined);
  protected readonly store = inject(AssemblyStore);
  protected readonly time = signal(0);
  protected readonly playing = signal(false);
  protected readonly recording = signal(false);
  protected readonly keyTime = signal(0);
  protected readonly keyJoint = signal<string | undefined>(undefined);
  protected readonly driveChoice = signal<string | undefined>(undefined);
  protected readonly hits = signal<readonly Collision[] | undefined>(undefined);
  protected readonly checking = signal(false);
  protected readonly stopAtHit = signal(true);
  private frames: { readonly document: unknown; readonly study: string; readonly frames: readonly MotionFrame[] } | undefined;
  private animation = 0;

  protected readonly study = computed(() => this.store.state()?.document.motionStudies.find((s) => s.id === this.studyId()));
  protected readonly joints = computed(() => this.store.state()?.document.joints.filter((j) => j.values.length > 0) ?? []);
  protected readonly selectedJoint = computed(() => this.keyJoint() ?? this.joints()[0]?.id);
  protected readonly sortedKeys = computed(() => [...(this.study()?.keys ?? [])].sort((a, b) => a.time - b.time));

  /** Parts no joint holds: those a study can carry (CAD-187). */
  protected readonly carriable = computed(() => {
    const document = this.store.state()?.document;
    return (document?.instances ?? []).filter((i) => !document?.joints.some((j) => j.a.instance === i.id || j.b.instance === i.id));
  });
  protected readonly carryPart = signal<string | undefined>(undefined);
  protected readonly carryBy = signal<string | undefined>(undefined);
  protected readonly carryFrom = signal(0);
  protected readonly carryUntil = signal('');
  protected readonly carryPartId = computed(() => this.carryPart() ?? this.carriable()[0]?.id);
  protected readonly carryById = computed(() => this.carryBy() ?? this.store.state()?.document.instances.find((i) => i.id !== this.carryPartId())?.id);

  protected addCarry(study: MotionStudy): void {
    const [instance, by] = [this.carryPartId(), this.carryById()];
    if (!instance || !by) return;
    const until = this.carryUntil().trim() === '' ? undefined : Number(this.carryUntil());
    const carry: MotionCarry = { instance, by, from: this.carryFrom(), ...(until === undefined ? {} : { until }) };
    this.save(study, { carries: [...(study.carries ?? []), carry] });
  }

  protected removeCarry(study: MotionStudy, carry: MotionCarry): void {
    this.save(study, { carries: (study.carries ?? []).filter((c) => c !== carry) });
  }

  /** Why a key cannot be reached: a value past its joint's limit, which holds it there (CAD-186). */
  protected pastLimit(key: MotionKey): string {
    const joint = this.joints().find((j) => j.id === key.joint);
    if (!joint) return '';
    return key.values
      .flatMap((value, i) => {
        const limit = joint.limits[i];
        const dof = jointDofs[joint.type][i];
        if (!limit || !dof || (value >= limit.min && value <= limit.max)) return [];
        return [`${dof.label} ${value} is past the limit; it is held at ${value < limit.min ? limit.min : limit.max}.`];
      })
      .join(' ');
  }
  /** Every joint freedom a speed can drive. */
  protected readonly freedoms = computed(() =>
    this.joints().flatMap((j) => jointDofs[j.type].map((dof, i) => ({ key: `${j.id}:${i}`, label: `${j.name} · ${dof.label}` }))),
  );
  protected readonly driveKey = computed(() => this.driveChoice() ?? this.freedoms()[0]?.key);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected jointName(id: string): string {
    return this.store.state()?.document.joints.find((j) => j.id === id)?.name ?? id;
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected number(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  protected save(study: MotionStudy, change: Partial<MotionStudy>): void {
    void this.store.run({ type: 'edit-study', study: { ...study, ...change } });
  }

  protected addKey(study: MotionStudy): void {
    const joint = this.store.state()?.document.joints.find((j) => j.id === this.selectedJoint());
    if (!joint) return;
    const key: MotionKey = { time: this.keyTime(), joint: joint.id, values: joint.values };
    const keys = [...study.keys.filter((k) => !(k.joint === key.joint && k.time === key.time)), key];
    this.save(study, { keys });
    this.keyTime.set(Math.min(study.duration, this.keyTime() + study.duration / 2));
  }

  protected ease(study: MotionStudy, key: MotionKey, on: boolean): void {
    this.save(study, { keys: study.keys.map((k) => (k === key ? { ...k, ease: on } : k)) });
  }

  protected isTurn(drive: MotionDrive): boolean {
    const joint = this.store.state()?.document.joints.find((j) => j.id === drive.joint);
    return joint ? jointDofs[joint.type][drive.dof]?.kind === 'rotate' : false;
  }

  protected freedomName(drive: MotionDrive): string {
    return this.freedoms().find((f) => f.key === `${drive.joint}:${drive.dof}`)?.label ?? drive.joint;
  }

  /** Turns in rpm (6° a second each), slides in mm/s. */
  protected shownSpeed(drive: MotionDrive): number {
    return Math.round((this.isTurn(drive) ? drive.speed / 6 : drive.speed) * 1000) / 1000;
  }

  protected setSpeed(study: MotionStudy, drive: MotionDrive, shown: number): void {
    const speed = this.isTurn(drive) ? shown * 6 : shown;
    this.save(study, { drives: (study.drives ?? []).map((d) => (d === drive ? { ...d, speed } : d)) });
  }

  protected addDrive(study: MotionStudy): void {
    const [joint, dof] = (this.driveKey() ?? '').split(':') as [string, string];
    if (!joint) return;
    const drive: MotionDrive = { joint, dof: Number(dof), speed: 0 };
    const isTurn = this.isTurn(drive);
    this.save(study, { drives: [...(study.drives ?? []).filter((d) => !(d.joint === joint && d.dof === drive.dof)), { ...drive, speed: isTurn ? 60 : 10 }] });
  }

  protected removeDrive(study: MotionStudy, drive: MotionDrive): void {
    this.save(study, { drives: (study.drives ?? []).filter((d) => d !== drive) });
  }

  protected instanceName(id: string): string {
    return this.store.state()?.document.instances.find((i) => i.id === id)?.name ?? id;
  }

  protected async checkCollisions(study: MotionStudy): Promise<void> {
    this.checking.set(true);
    this.hits.set(undefined);
    try {
      this.hits.set((await this.store.collisions(study.id, 10)) ?? []);
    } finally {
      this.checking.set(false);
    }
  }

  /** Shows the moment of a hit, the two parts in pink. */
  protected async showHit(study: MotionStudy, hit: Collision): Promise<void> {
    this.stop();
    await this.scrub(study, hit.time);
    this.store.flagged.set(new Set([hit.a, hit.b]));
  }

  protected removeKey(study: MotionStudy, key: MotionKey): void {
    this.save(study, { keys: study.keys.filter((k) => k !== key) });
  }

  protected remove(study: MotionStudy): void {
    this.stop();
    this.store.selection.set(undefined);
    void this.store.run({ type: 'remove-study', studyId: study.id });
  }

  protected async scrub(study: MotionStudy, time: number): Promise<void> {
    const frames = await this.framesOf(study);
    this.time.set(time);
    if (frames) this.show(frames, time);
  }

  protected async play(study: MotionStudy, onEnd?: () => void): Promise<void> {
    const frames = await this.framesOf(study);
    if (!frames) return;
    this.playing.set(true);
    this.store.flagged.set(new Set());
    const started = performance.now() - (this.time() >= study.duration ? 0 : this.time() * 1000);
    // Playing stops at the first hit, when asked (and found by a collision check).
    const hit = this.stopAtHit() ? this.hits()?.find((h) => h.time >= this.time()) : undefined;
    const end = hit ? hit.time : study.duration;
    const step = () => {
      const time = Math.min(end, (performance.now() - started) / 1000);
      this.time.set(time);
      this.show(frames, time);
      if (hit && time >= end) this.store.flagged.set(new Set([hit.a, hit.b]));
      if (time < end && this.playing()) {
        this.animation = requestAnimationFrame(step);
      } else {
        this.playing.set(false);
        onEnd?.();
      }
    };
    this.animation = requestAnimationFrame(step);
  }

  /** Plays the study from the start while recording the viewport, then hands the video over. */
  protected async record(study: MotionStudy): Promise<void> {
    const stream = this.capture()(fps);
    if (!stream || typeof MediaRecorder === 'undefined') {
      this.store.error.set('Recording is not available in this browser.');
      return;
    }
    const type = ['video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      this.recording.set(false);
      for (const track of stream.getTracks()) track.stop();
      const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
      await this.store.saveRecording(bytes, study.name);
    };
    this.recording.set(true);
    this.time.set(0);
    recorder.start();
    await this.play(study, () => recorder.stop());
  }

  protected stop(): void {
    cancelAnimationFrame(this.animation);
    this.playing.set(false);
    this.store.previewPoses.set(undefined);
    this.store.flagged.set(new Set());
  }

  /** Frames are computed once per version of the assembly document. */
  private async framesOf(study: MotionStudy): Promise<readonly MotionFrame[] | undefined> {
    const document = this.store.state()?.document;
    const cached = this.frames;
    if (cached && cached.document === document && cached.study === study.id) return cached.frames;
    const frames = await this.store.motion(study.id, fps);
    if (frames) this.frames = { document, study: study.id, frames };
    return frames;
  }

  private show(frames: readonly MotionFrame[], time: number): void {
    const last = frames[frames.length - 1];
    const frame = last && last.time > 0 ? frames[Math.min(frames.length - 1, Math.round((time / last.time) * (frames.length - 1)))] : last;
    if (frame) this.store.previewPoses.set(new Map(Object.entries(frame.poses) as [string, Matrix4][]));
  }
}
