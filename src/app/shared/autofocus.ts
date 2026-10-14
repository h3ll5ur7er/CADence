import { afterNextRender, Directive, ElementRef, inject } from '@angular/core';

/** Focuses (and selects) an input as soon as it appears. */
@Directive({ selector: 'input[cadAutofocus]' })
export class Autofocus {
  constructor() {
    const element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      element.focus();
      element.select();
    });
  }
}
