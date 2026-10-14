import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type Signal,
  signal,
  viewChild,
} from '@angular/core';

/** Shared mechanics of a modal native <dialog> that resolves a promise with the user's answer. */
abstract class ModalDialog<T> {
  protected abstract readonly dialog: Signal<ElementRef<HTMLDialogElement>>;
  private resolve: ((answer: T) => void) | undefined;

  protected open(): Promise<T> {
    this.finish(this.dismissed());
    this.dialog().nativeElement.showModal();
    return new Promise<T>((resolve) => (this.resolve = resolve));
  }

  protected finish(answer: T): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    const dialog = this.dialog().nativeElement;
    if (dialog.open) dialog.close();
    resolve?.(answer);
  }

  /** The answer when the user cancels or presses Escape. */
  protected abstract dismissed(): T;
}

export interface NameRequest {
  readonly heading: string;
  readonly confirmLabel: string;
  readonly initial: string;
}

/** Asks for a name; resolves `undefined` when cancelled. */
@Component({
  selector: 'cad-name-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog" aria-labelledby="name-dialog-heading" (close)="finish(undefined)">
      <form (submit)="submit($event)">
        <h2 id="name-dialog-heading">{{ request().heading }}</h2>
        <label class="field">
          Name
          <input
            #input
            id="name-dialog-input"
            name="name"
            autocomplete="off"
            maxlength="80"
            [value]="value()"
            (input)="value.set(input.value)"
          />
        </label>
        <div class="actions">
          <button type="button" class="btn" (click)="finish(undefined)">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="!value().trim()">
            {{ request().confirmLabel }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: './dialogs.scss',
})
export class NameDialog extends ModalDialog<string | undefined> {
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly request = signal<NameRequest>({ heading: '', confirmLabel: 'OK', initial: '' });
  protected readonly value = signal('');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  ask(request: NameRequest): Promise<string | undefined> {
    this.request.set(request);
    this.value.set(request.initial);
    const answer = this.open();
    const input = this.input().nativeElement;
    input.value = request.initial;
    input.select();
    return answer;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const name = this.value().trim();
    if (name) this.finish(name);
  }

  protected dismissed(): undefined {
    return undefined;
  }

}

export interface ConfirmRequest {
  readonly heading: string;
  readonly message: string;
  readonly confirmLabel: string;
}

/** Asks the user to confirm a destructive action. */
@Component({
  selector: 'cad-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog" aria-labelledby="confirm-dialog-heading" (close)="finish(false)">
      <h2 id="confirm-dialog-heading">{{ request().heading }}</h2>
      <p>{{ request().message }}</p>
      <div class="actions">
        <button type="button" class="btn" (click)="finish(false)">Cancel</button>
        <button type="button" class="btn btn-danger" (click)="finish(true)">{{ request().confirmLabel }}</button>
      </div>
    </dialog>
  `,
  styleUrl: './dialogs.scss',
})
export class ConfirmDialog extends ModalDialog<boolean> {
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly request = signal<ConfirmRequest>({ heading: '', message: '', confirmLabel: 'OK' });

  confirm(request: ConfirmRequest): Promise<boolean> {
    this.request.set(request);
    return this.open();
  }

  protected dismissed(): boolean {
    return false;
  }

}
