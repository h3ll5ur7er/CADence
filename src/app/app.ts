import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommandPalette } from './shared/command-palette';
import { FileOpener, OPENED_FILES } from './shared/file-opener';
import { Shortcuts } from './shared/shortcuts';
import { Tour } from './shared/tour';
import { TourOverlay } from './shared/tour-overlay';
import { UpdateNotice } from './shared/update-notice';

@Component({
  selector: 'cad-root',
  imports: [RouterOutlet, UpdateNotice, CommandPalette, TourOverlay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The tour loads once it is taken (CAD-181).
  template: '<router-outlet /><cad-update-notice /><cad-command-palette />@defer (when tour.index() !== undefined) {<cad-tour />}',
  styles: ':host { display: contents; }',
})
export class App {
  protected readonly tour = inject(Tour);

  constructor() {
    // Files the app was started with (desktop: Open with CADence) open as a project.
    const opener = inject(FileOpener);
    const router = inject(Router);
    void inject(OPENED_FILES)()
      .then((files) => opener.open(files))
      .then((result) => (result.ok && result.value ? router.navigate(['/projects', result.value.id]) : undefined));
    inject(Shortcuts).registerActions([{ label: 'Take the tour', group: 'CADence', run: () => this.tour.start() }]);
  }
}
