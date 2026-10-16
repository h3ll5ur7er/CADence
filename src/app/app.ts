import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommandPalette } from './shared/command-palette';
import { FileOpener, OPENED_FILES } from './shared/file-opener';
import { UpdateNotice } from './shared/update-notice';

@Component({
  selector: 'cad-root',
  imports: [RouterOutlet, UpdateNotice, CommandPalette],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet /><cad-update-notice /><cad-command-palette />',
  styles: ':host { display: contents; }',
})
export class App {
  constructor() {
    // Files the app was started with (desktop: Open with CADence) open as a project.
    const opener = inject(FileOpener);
    const router = inject(Router);
    void inject(OPENED_FILES)()
      .then((files) => opener.open(files))
      .then((result) => (result.ok && result.value ? router.navigate(['/projects', result.value.id]) : undefined));
  }
}
