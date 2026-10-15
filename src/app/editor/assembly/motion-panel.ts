import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import type { Matrix4, MotionFrame, MotionKey, MotionStudy } from '@core/contracts';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';

const fps = 30;

/** A motion study: keyframes of joint values over time, played back in the view and recorded to video. */
@Component({
  selector: 'cad-motion-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (study(); as study) {
      <p class="eyebrow">Motion study</p>
      <div class="head">
        <h2>{{ study.name }}</h2>
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
          <tr><th>Time</th><th>Joint</th><th>Values</th><th><span class="visually-hidden">Delete</span></th></tr>
        </thead>
        <tbody>
          @for (key of sortedKeys(); track $index) {
            <tr>
              <td class="mono">{{ key.time }} s</td>
              <td>{{ jointName(key.joint) }}</td>
              <td class="mono">{{ key.values.join(', ') }}</td>
              <td>
                <button type="button" class="icon-btn" aria-label="Delete key" (click)="removeKey(study, key)"><cad-icon name="trash" [size]="12" /></button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="hint">Add keys: a joint's values at a moment.</td></tr>
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
  private frames: { readonly document: unknown; readonly study: string; readonly frames: readonly MotionFrame[] } | undefined;
  private animation = 0;

  protected readonly study = computed(() => this.store.state()?.document.motionStudies.find((s) => s.id === this.studyId()));
  protected readonly joints = computed(() => this.store.state()?.document.joints.filter((j) => j.values.length > 0) ?? []);
  protected readonly selectedJoint = computed(() => this.keyJoint() ?? this.joints()[0]?.id);
  protected readonly sortedKeys = computed(() => [...(this.study()?.keys ?? [])].sort((a, b) => a.time - b.time));

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
    const started = performance.now() - (this.time() >= study.duration ? 0 : this.time() * 1000);
    const step = () => {
      const time = Math.min(study.duration, (performance.now() - started) / 1000);
      this.time.set(time);
      this.show(frames, time);
      if (time < study.duration && this.playing()) {
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
