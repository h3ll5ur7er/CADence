import { chordOf, commandFor, controlSchemes, keysFor, shortcutCommands, type ShortcutCommand, type ShortcutScope } from './keymap';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
const all = new Set<ShortcutScope>(['app', 'document', 'view', 'modeling']);

describe('keymap', () => {
  it('writes chords with their modifiers, letters upper case, digits by their key, punctuation as typed', () => {
    expect(chordOf(key({ key: 'z', ctrlKey: true }))).toBe('Ctrl+Z');
    expect(chordOf(key({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Z');
    expect(chordOf(key({ key: 'e' }))).toBe('E');
    expect(chordOf(key({ key: 'E', shiftKey: true }))).toBe('Shift+E');
    expect(chordOf(key({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('Shift+1');
    expect(chordOf(key({ key: '?', code: 'Slash', shiftKey: true }))).toBe('?');
    expect(chordOf(key({ key: 'F6' }))).toBe('F6');
    expect(chordOf(key({ key: 'Shift', shiftKey: true }))).toBeUndefined();
  });

  it('finds the command of a chord in the active scopes, the most specific scope first', () => {
    expect(commandFor('cadence', 'E', all)).toBe('extrude');
    expect(commandFor('cadence', 'Ctrl+Z', all)).toBe('undo');
    expect(commandFor('cadence', 'R', all)).toBe('revolve');
    expect(commandFor('cadence', 'R', new Set(['sketch', 'document', 'view', 'app']))).toBe('sketch-rectangle');
    expect(commandFor('cadence', 'E', new Set(['view']))).toBeUndefined();
    expect(commandFor('onshape', 'Shift+E', all)).toBe('extrude');
    expect(commandFor('onshape', 'F', all)).toBe('zoom-fit');
    expect(commandFor('fusion', 'F6', all)).toBe('zoom-fit');
    expect(commandFor('fusion', 'F', all)).toBe('fillet');
  });

  it('never binds one chord twice where the same scopes are active', () => {
    const groups: ShortcutScope[][] = [
      ['sketch', 'document', 'view', 'app'],
      ['modeling', 'document', 'view', 'app'],
    ];
    for (const scheme of controlSchemes.map((s) => s.id)) {
      for (const scopes of groups) {
        const chords = (Object.keys(shortcutCommands) as ShortcutCommand[])
          .filter((c) => scopes.includes(shortcutCommands[c].scope))
          .flatMap((c) => keysFor(scheme, c).map((chord) => `${shortcutCommands[c].scope}:${chord}`));
        // Within one scope a chord means one thing.
        expect(new Set(chords).size, `${scheme}: ${chords.join(' ')}`).toBe(chords.length);
      }
    }
  });

  it('gives every scheme the commands that have no other way in: undo, redo, help, cancel', () => {
    for (const scheme of controlSchemes.map((s) => s.id)) {
      for (const command of ['undo', 'redo', 'help', 'cancel'] as const) expect(keysFor(scheme, command).length).toBeGreaterThan(0);
    }
  });
});
