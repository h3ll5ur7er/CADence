import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, output, signal, viewChild } from '@angular/core';
import type { DocumentSummary, PluginExporter, PluginPart, Project, ProjectPlugin, ProjectScript, ProjectSummary, ScriptParameter } from '@core/contracts';
import { workerSandbox } from '@core/utilities/sandbox';
import type { Cadence } from '../../automation/api';
import type { parameterValues, runGenerator, runScript } from '../../automation/script';
import { completionsAfter, scriptApiTypes, type ScriptMember } from '../../automation/script-api';
import { PROJECT_MANAGER, SCRIPTING } from '../core.providers';
import { Icon } from '../shared/icon';

/** Values asked for before something runs: a script's or a plugin's parameters. */
interface Asking {
  readonly title: string;
  readonly action: string;
  readonly parameters: readonly ScriptParameter[];
  readonly values: Record<string, string>;
  run(values: Readonly<Record<string, string>>): Promise<void>;
}

/** How the last run ended, for the output pane. */
interface Ran {
  readonly ok: boolean;
  readonly text: string;
  readonly made: readonly string[];
  readonly changed: readonly string[];
}

const newSource = `// The body of an async function: cadence is the scripting API (await every call),
// params holds the values asked for before the run, project is this project.
const created = await cadence.projects.createDocument(project.id, 'component', 'Box ' + params.size);
const box = await cadence.component(created.value.id);
await box.run(
  { type: 'create-sketch', id: 's', plane: 'XY' },
  { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: params.size, height: params.size },
);
const [profile] = (await box.summary({ only: ['sketches'] })).sketches[0].profiles;
await box.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile.id], distance: params.size + ' mm', direction: 'normal', operation: 'new-body' } });
console.log('Made', created.value.name);
return created.value.name;
`;

/**
 * The script console (CAD-173): scripts kept with the project, edited with the scripting API's types
 * and completions, run in a worker against the project with parameters asked first, and stoppable;
 * and the project's plugins (CAD-174): installed from a file, their generators, features and exporters.
 */
@Component({
  selector: 'cad-scripts-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scripts-dialog.html',
  styleUrls: ['../shared/dialogs.scss', './scripts-dialog.scss'],
})
export class ScriptsDialog {
  /** Scripts changed documents of the project: what shows them should load them again. */
  readonly changed = output();
  protected readonly project = signal<Project | undefined>(undefined);
  /** The document open in the editor, for plugin features and exporters. */
  protected readonly document = signal<DocumentSummary | undefined>(undefined);
  protected readonly scripts = computed(() => this.project()?.scripts ?? []);
  protected readonly plugins = computed(() => this.project()?.plugins ?? []);
  protected readonly component = computed(() => (this.document()?.kind === 'component' ? this.document() : undefined));
  /** The kept script being edited; undefined for a new one. */
  protected readonly selected = signal<string | undefined>(undefined);
  protected readonly name = signal('');
  protected readonly parameters = signal<readonly ScriptParameter[]>([]);
  protected readonly asking = signal<Asking | undefined>(undefined);
  protected readonly running = signal(false);
  protected readonly output = signal<readonly string[]>([]);
  protected readonly ran = signal<Ran | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly completions = signal<readonly ScriptMember[]>([]);
  protected readonly highlighted = signal(0);
  protected readonly types = scriptApiTypes;
  protected readonly kinds: readonly ScriptParameter['kind'][] = ['length', 'number', 'angle', 'text'];

  private readonly projects = inject(PROJECT_MANAGER);
  private readonly scripting = inject(SCRIPTING, { optional: true });
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly editor = viewChild.required<ElementRef<HTMLTextAreaElement>>('editor');
  private stopper: AbortController | undefined;
  private api: Promise<Api> | undefined;

  async open(project: ProjectSummary, document?: DocumentSummary): Promise<void> {
    this.document.set(document);
    this.error.set(undefined);
    this.asking.set(undefined);
    await this.reload(project.id);
    const first = this.scripts()[0];
    if (first) this.select(first);
    else this.newScript();
    this.dialog().nativeElement.showModal();
  }

  protected select(script: ProjectScript): void {
    this.selected.set(script.id);
    this.name.set(script.name);
    this.parameters.set(script.parameters);
    this.editor().nativeElement.value = script.source;
    this.completions.set([]);
  }

  protected newScript(): void {
    this.selected.set(undefined);
    const taken = new Set(this.scripts().map((s) => s.name));
    let n = this.scripts().length + 1;
    while (taken.has(`Script ${n}`)) n++;
    this.name.set(`Script ${n}`);
    this.parameters.set([{ name: 'size', label: 'Size', default: '20 mm', kind: 'length' }]);
    this.editor().nativeElement.value = newSource;
  }

  protected addParameter(): void {
    const names = new Set(this.parameters().map((p) => p.name));
    let n = this.parameters().length + 1;
    while (names.has(`value${n}`)) n++;
    this.parameters.update((list) => [...list, { name: `value${n}`, default: '10', kind: 'number' }]);
  }

  protected setParameter(index: number, change: Partial<ScriptParameter>): void {
    this.parameters.update((list) => list.map((p, i) => (i === index ? { ...p, ...change } : p)));
  }

  protected removeParameter(index: number): void {
    this.parameters.update((list) => list.filter((_, i) => i !== index));
  }

  /** Keeps the script with the project (a new one, or in place of the one edited). */
  protected async save(): Promise<ProjectScript | undefined> {
    const project = this.project();
    if (!project) return undefined;
    const script: ProjectScript = { id: this.selected() ?? `script-${Date.now().toString(36)}`, name: this.name(), source: this.editor().nativeElement.value, parameters: this.parameters() };
    const others = this.scripts().filter((s) => s.id !== script.id);
    const saved = await this.projects.setProjectScripts(project.id, [...others, script]);
    if (!saved.ok) {
      this.error.set(saved.error.message);
      return undefined;
    }
    this.error.set(undefined);
    this.selected.set(script.id);
    await this.reload(project.id);
    return script;
  }

  protected async remove(): Promise<void> {
    const project = this.project();
    const id = this.selected();
    if (!project || !id) return;
    await this.projects.setProjectScripts(project.id, this.scripts().filter((s) => s.id !== id));
    await this.reload(project.id);
    const first = this.scripts()[0];
    if (first) this.select(first);
    else this.newScript();
  }

  /** Runs the script as edited, asking for its parameters first. */
  protected run(): void {
    const project = this.project();
    if (!project || this.running()) return;
    const source = this.editor().nativeElement.value;
    const parameters = this.parameters();
    this.ask({ title: this.name(), action: 'Run', parameters, values: {}, run: async (values) => {
      const { cadence, runScript, parameterValues } = await this.loaded();
      const params = parameterValues(parameters, values);
      await this.track(() => runScript(cadence, source, { ...this.runOptions(), params, project }));
    } });
  }

  protected runGenerator(plugin: ProjectPlugin, generator: PluginPart): void {
    const project = this.project();
    if (!project) return;
    this.ask({ title: `${plugin.name}: ${generator.label}`, action: 'Run', parameters: generator.parameters, values: {}, run: async (values) => {
      const { cadence, runGenerator } = await this.loaded();
      await this.track(() => runGenerator(cadence, project.id, `${plugin.id}/${generator.name}`, values, this.runOptions()));
    } });
  }

  /** Adds a plugin's feature to the open component, with its parameters as expressions. */
  protected addFeature(plugin: ProjectPlugin, feature: PluginPart): void {
    const document = this.component();
    if (!document) return;
    this.ask({ title: `${plugin.name}: ${feature.label}`, action: 'Add', parameters: feature.parameters, values: {}, run: async (values) => {
      const { cadence } = await this.loaded();
      await this.attempt(async () => {
        const script = await cadence.component(document.id);
        const ids = new Set((script.summary({ only: ['timeline'] }).timeline ?? []).map((item) => item.id));
        let id = feature.name;
        for (let n = 2; ids.has(id); n++) id = `${feature.name}${n}`;
        const parameters = Object.fromEntries(feature.parameters.map((p) => [p.name, values[p.name] ?? p.default]));
        await script.run({ type: 'add-feature', feature: { type: 'plugin', id, name: feature.label, suppressed: false, plugin: plugin.id, version: plugin.version, feature: feature.name, plane: 'XY', parameters, operation: 'new-body' } });
        this.ran.set({ ok: true, text: `Added ${feature.label} to ${document.name}.`, made: [], changed: [document.name] });
      });
    } });
  }

  protected async exportWith(plugin: ProjectPlugin, exporter: PluginExporter): Promise<void> {
    const document = this.component();
    if (!document) return;
    const { cadence } = await this.loaded();
    await this.attempt(async () => {
      await (await cadence.component(document.id)).exportWith(plugin.id, exporter.name);
      this.ran.set({ ok: true, text: `Exported ${document.name} as ${exporter.label} (.${exporter.extension}).`, made: [], changed: [] });
    });
  }

  protected async install(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.installSource(await file.text());
  }

  /** The sample plugin the app carries (public/plugins). */
  protected async installSample(): Promise<void> {
    const response = await fetch(new URL('plugins/trays.cadence-plugin.js', document.baseURI));
    await this.installSource(await response.text());
  }

  protected async removePlugin(plugin: ProjectPlugin): Promise<void> {
    const project = this.project();
    if (!project) return;
    await this.projects.removePlugin(project.id, plugin.id);
    await this.reload(project.id);
    this.changed.emit();
  }

  protected stop(): void {
    this.stopper?.abort();
  }

  protected async confirmAsked(): Promise<void> {
    const asked = this.asking();
    if (!asked) return;
    this.asking.set(undefined);
    await asked.run(asked.values);
  }

  protected setAsked(name: string, value: string): void {
    const asked = this.asking();
    if (asked) asked.values[name] = value;
  }

  /** Completions after `word.` where the caret is; Tab indents, Ctrl+Enter runs. */
  protected keydown(event: KeyboardEvent): void {
    const list = this.completions();
    if (list.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.highlighted.update((i) => (i + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.complete(list[this.highlighted()] as ScriptMember);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.completions.set([]);
        return;
      }
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.insert('  ', 0);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.run();
    }
  }

  protected typed(): void {
    const editor = this.editor().nativeElement;
    const before = editor.value.slice(0, editor.selectionStart);
    const match = /([A-Za-z_$][\w$]*)\.([A-Za-z_$]*)$/.exec(before);
    const list = match ? completionsAfter(match[1] as string).filter((m) => m.name.startsWith(match[2] as string) && m.name !== match[2]) : [];
    this.completions.set(list.slice(0, 12));
    this.highlighted.set(0);
  }

  protected complete(member: ScriptMember): void {
    const editor = this.editor().nativeElement;
    const typedSoFar = /[A-Za-z_$]*$/.exec(editor.value.slice(0, editor.selectionStart))?.[0] ?? '';
    this.insert(member.name, typedSoFar.length);
    this.completions.set([]);
    editor.focus();
  }

  private insert(text: string, replacing: number): void {
    const editor = this.editor().nativeElement;
    const start = editor.selectionStart - replacing;
    editor.setRangeText(text, start, editor.selectionEnd, 'end');
  }

  private ask(asking: Asking): void {
    this.error.set(undefined);
    if (!asking.parameters.length) {
      void asking.run({});
      return;
    }
    this.asking.set({ ...asking, values: Object.fromEntries(asking.parameters.map((p) => [p.name, p.default])) });
  }

  private runOptions() {
    this.stopper = new AbortController();
    const scripting = this.scripting;
    return {
      signal: this.stopper.signal,
      timeLimit: 10 * 60_000,
      onOutput: (line: string) => this.output.update((lines) => [...lines, line]),
      ...(scripting ? { sandbox: workerSandbox(scripting.worker) } : {}),
    };
  }

  /** Runs a script and shows what it printed, returned and touched; documents shown again after. */
  private async track(run: () => Promise<Awaited<ReturnType<Api['runScript']>>>): Promise<void> {
    await this.attempt(async () => {
      const result = await run();
      const value = result.ok ? (result.value === undefined ? '' : ` It returned ${JSON.stringify(result.value)}.`) : '';
      this.ran.set({
        ok: result.ok,
        text: result.ok ? `Done in ${result.seconds} s.${value}` : result.error,
        made: result.documents.created.map((d) => d.name),
        changed: result.documents.changed.map((d) => d.name),
      });
    });
  }

  /** Something that runs: output cleared, errors shown, the project and the editor brought up to date after. */
  private async attempt(work: () => Promise<void>): Promise<void> {
    const project = this.project();
    this.running.set(true);
    this.output.set([]);
    this.ran.set(undefined);
    this.error.set(undefined);
    try {
      await work();
    } catch (error) {
      this.ran.set({ ok: false, text: error instanceof Error ? error.message : String(error), made: [], changed: [] });
    } finally {
      this.running.set(false);
      this.stopper = undefined;
      if (project) await this.reload(project.id);
      this.changed.emit();
    }
  }

  private async installSource(source: string): Promise<void> {
    const project = this.project();
    if (!project) return;
    const installed = await this.projects.installPlugin(project.id, source);
    this.error.set(installed.ok ? undefined : installed.error.message);
    await this.reload(project.id);
    if (installed.ok) this.changed.emit();
  }

  private async reload(id: Project['id']): Promise<void> {
    this.project.set(await this.projects.findProject(id));
  }

  /** The scripting API over the app's core, loaded with the console's first run. */
  private loaded(): Promise<Api> {
    const scripting = this.scripting;
    if (!scripting) return Promise.reject(new Error('Scripts cannot run here.'));
    this.api ??= Promise.all([import('../../automation/api'), import('../../automation/script')]).then(([{ Cadence }, script]) => ({
      cadence: new Cadence(scripting.core, { delivered: [], deliverNextTo: () => undefined, downloads: 'your downloads' }),
      runScript: script.runScript,
      runGenerator: script.runGenerator,
      parameterValues: script.parameterValues,
    }));
    return this.api;
  }
}

interface Api {
  readonly cadence: Cadence;
  readonly runScript: typeof runScript;
  readonly runGenerator: typeof runGenerator;
  readonly parameterValues: typeof parameterValues;
}
