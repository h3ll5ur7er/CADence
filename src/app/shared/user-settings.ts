import { effect, Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { Projection } from '../viewport/viewport-scene';
import { type ControlScheme, controlSchemes } from './keymap';

/** Where preferences are kept: this browser's local storage, if it allows it. */
export const SETTINGS_STORAGE = new InjectionToken<Pick<Storage, 'getItem' | 'setItem'> | undefined>('SettingsStorage', {
  factory: () => {
    try {
      return localStorage;
    } catch {
      return undefined;
    }
  },
});

const key = 'cadence.settings';

interface Stored {
  readonly controls?: ControlScheme;
  readonly projection?: Projection;
}

/**
 * The user's preferences for working in CADence (how mouse and keys behave, the camera), kept per
 * browser or desktop install. They are not part of any project.
 */
@Injectable({ providedIn: 'root' })
export class UserSettings {
  private readonly storage = inject(SETTINGS_STORAGE);
  private readonly stored = this.read();
  readonly controls = signal<ControlScheme>(controlSchemes.some((s) => s.id === this.stored.controls) ? (this.stored.controls as ControlScheme) : 'cadence');
  readonly projection = signal<Projection>(this.stored.projection === 'orthographic' ? 'orthographic' : 'perspective');

  constructor() {
    effect(() => {
      const value: Stored = { controls: this.controls(), projection: this.projection() };
      try {
        this.storage?.setItem(key, JSON.stringify(value));
      } catch {
        // Preferences are a convenience; without storage they last until the page closes.
      }
    });
  }

  private read(): Stored {
    try {
      return (JSON.parse(this.storage?.getItem(key) ?? '{}') as Stored | null) ?? {};
    } catch {
      return {};
    }
  }
}
