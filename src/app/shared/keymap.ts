/** How mouse and keys drive CADence: its own defaults, or the habits of another CAD program. */
export type ControlScheme = 'cadence' | 'fusion' | 'onshape';

export const controlSchemes: readonly { readonly id: ControlScheme; readonly label: string }[] = [
  { id: 'cadence', label: 'CADence' },
  { id: 'fusion', label: 'Fusion 360 style' },
  { id: 'onshape', label: 'Onshape style' },
];

/**
 * Where a shortcut applies. While a sketch is edited, `sketch` replaces `modeling`; `document`
 * (undo, redo, cancel), `view` and `app` apply in every mode. More specific scopes win.
 */
export type ShortcutScope = 'sketch' | 'modeling' | 'document' | 'view' | 'app';
export const precedence: readonly ShortcutScope[] = ['sketch', 'modeling', 'document', 'view', 'app'];

export const shortcutCommands = {
  help: { scope: 'app', label: 'Keyboard shortcuts' },
  undo: { scope: 'document', label: 'Undo' },
  redo: { scope: 'document', label: 'Redo' },
  cancel: { scope: 'document', label: 'Cancel, clear the selection' },
  'zoom-fit': { scope: 'view', label: 'Zoom to fit' },
  'view-home': { scope: 'view', label: 'Home view' },
  'view-front': { scope: 'view', label: 'Front view' },
  'view-back': { scope: 'view', label: 'Back view' },
  'view-left': { scope: 'view', label: 'Left view' },
  'view-right': { scope: 'view', label: 'Right view' },
  'view-top': { scope: 'view', label: 'Top view' },
  'view-bottom': { scope: 'view', label: 'Bottom view' },
  'toggle-projection': { scope: 'view', label: 'Perspective or orthographic' },
  'toggle-section': { scope: 'view', label: 'Section view on or off' },
  'new-sketch': { scope: 'modeling', label: 'New sketch' },
  extrude: { scope: 'modeling', label: 'Extrude' },
  revolve: { scope: 'modeling', label: 'Revolve' },
  fillet: { scope: 'modeling', label: 'Fillet' },
  chamfer: { scope: 'modeling', label: 'Chamfer' },
  shell: { scope: 'modeling', label: 'Shell' },
  plane: { scope: 'modeling', label: 'Construction plane' },
  measure: { scope: 'modeling', label: 'Measure' },
  parameters: { scope: 'modeling', label: 'Parameters' },
  'sketch-select': { scope: 'sketch', label: 'Select' },
  'sketch-line': { scope: 'sketch', label: 'Line' },
  'sketch-rectangle': { scope: 'sketch', label: 'Rectangle' },
  'sketch-circle': { scope: 'sketch', label: 'Circle' },
  'sketch-arc': { scope: 'sketch', label: 'Arc' },
  'sketch-point': { scope: 'sketch', label: 'Point' },
  'sketch-dimension': { scope: 'sketch', label: 'Dimension' },
  'sketch-construction': { scope: 'sketch', label: 'Construction on or off' },
  'sketch-trim': { scope: 'sketch', label: 'Trim' },
  'sketch-offset': { scope: 'sketch', label: 'Offset the selection' },
  'sketch-delete': { scope: 'sketch', label: 'Delete the selection' },
  'finish-sketch': { scope: 'sketch', label: 'Finish the sketch' },
} as const satisfies Record<string, { readonly scope: ShortcutScope; readonly label: string }>;

export type ShortcutCommand = keyof typeof shortcutCommands;

type Keymap = Readonly<Partial<Record<ShortcutCommand, readonly string[]>>>;

const common: Keymap = {
  help: ['?'],
  undo: ['Ctrl+Z'],
  redo: ['Ctrl+Y', 'Ctrl+Shift+Z'],
  cancel: ['Escape'],
  'sketch-delete': ['Delete', 'Backspace'],
};

const cadence: Keymap = {
  ...common,
  'zoom-fit': ['F'],
  'view-home': ['H'],
  'view-front': ['1'],
  'view-back': ['2'],
  'view-left': ['3'],
  'view-right': ['4'],
  'view-top': ['5'],
  'view-bottom': ['6'],
  'toggle-projection': ['O'],
  'toggle-section': ['Shift+X'],
  'new-sketch': ['S'],
  extrude: ['E'],
  revolve: ['R'],
  fillet: ['Shift+F'],
  chamfer: ['Shift+C'],
  shell: ['Shift+L'],
  plane: ['Shift+P'],
  measure: ['M'],
  parameters: ['Shift+V'],
  'sketch-select': ['S'],
  'sketch-line': ['L'],
  'sketch-rectangle': ['R'],
  'sketch-circle': ['C'],
  'sketch-arc': ['A'],
  'sketch-point': ['P'],
  'sketch-dimension': ['D'],
  'sketch-construction': ['X'],
  'sketch-trim': ['T'],
  'sketch-offset': ['O'],
  'finish-sketch': ['Enter'],
};

/** After Fusion 360's default shortcuts where it has them. */
const fusion: Keymap = {
  ...cadence,
  'zoom-fit': ['F6'],
  'view-home': ['Shift+F6'],
  fillet: ['F'],
  measure: ['I'],
};

/** After Onshape's default shortcuts where it has them. */
const onshape: Keymap = {
  ...cadence,
  'zoom-fit': ['F'],
  'view-home': ['Shift+7'],
  'view-front': ['Shift+1'],
  'view-back': ['Shift+2'],
  'view-left': ['Shift+3'],
  'view-right': ['Shift+4'],
  'view-top': ['Shift+5'],
  'view-bottom': ['Shift+6'],
  'new-sketch': ['Shift+S'],
  extrude: ['Shift+E'],
  revolve: ['Shift+R'],
  fillet: ['Shift+F'],
  'sketch-rectangle': ['G'],
  'sketch-construction': ['Q'],
};

const keymaps: Readonly<Record<ControlScheme, Keymap>> = { cadence, fusion, onshape };

export const keysFor = (scheme: ControlScheme, command: ShortcutCommand): readonly string[] => keymaps[scheme][command] ?? [];

/** A key press as written in the keymaps ("Ctrl+Shift+Z", "E", "Shift+1", "?", "F6"); `undefined` for a lone modifier. */
export function chordOf(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | undefined {
  const { key } = event;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return undefined;
  const digit = /^Digit(\d)$/.exec(event.code ?? '')?.[1];
  // Punctuation is written as typed: Shift is part of how it is typed, not of the chord.
  const punctuation = !digit && key.length === 1 && !/[a-z0-9]/i.test(key);
  const name = digit ?? (key.length === 1 ? key.toUpperCase() : key);
  const modifiers = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey && !punctuation ? 'Shift' : ''];
  return [...modifiers.filter(Boolean), name].join('+');
}

/** The command a chord stands for in the active scopes, the most specific scope first. */
export function commandFor(scheme: ControlScheme, chord: string, scopes: ReadonlySet<ShortcutScope>): ShortcutCommand | undefined {
  const map = keymaps[scheme];
  for (const scope of precedence) {
    if (!scopes.has(scope)) continue;
    const found = (Object.keys(map) as ShortcutCommand[]).find((c) => shortcutCommands[c].scope === scope && map[c]?.includes(chord));
    if (found) return found;
  }
  return undefined;
}

/** What dragging with a mouse button does; `null`: the button only selects. */
export type DragAction = 'orbit' | 'pan' | 'zoom' | null;

/** Mouse buttons of each scheme, for the viewport's navigation. */
export interface MouseBindings {
  readonly left: DragAction;
  readonly middle: DragAction;
  readonly right: DragAction;
  /** The wheel zooms toward the cursor rather than the view's centre. */
  readonly zoomToCursor: boolean;
  /** How to orbit, pan and zoom, for the shortcut reference. */
  readonly description: readonly (readonly [string, string])[];
}

export const mouseBindings: Readonly<Record<ControlScheme, MouseBindings>> = {
  cadence: {
    left: 'orbit',
    middle: 'zoom',
    right: 'pan',
    zoomToCursor: false,
    description: [
      ['Orbit', 'Left drag'],
      ['Pan', 'Right drag, or Shift + left drag'],
      ['Zoom', 'Wheel or middle drag'],
      ['Select', 'Left click'],
    ],
  },
  fusion: {
    left: null,
    middle: 'pan',
    right: null,
    zoomToCursor: true,
    description: [
      ['Orbit', 'Shift + middle drag'],
      ['Pan', 'Middle drag'],
      ['Zoom', 'Wheel, toward the cursor'],
      ['Select', 'Left click'],
    ],
  },
  onshape: {
    left: null,
    middle: 'pan',
    right: 'orbit',
    zoomToCursor: true,
    description: [
      ['Orbit', 'Right drag'],
      ['Pan', 'Middle drag, or Ctrl + right drag'],
      ['Zoom', 'Wheel, toward the cursor'],
      ['Select', 'Left click'],
    ],
  },
};
