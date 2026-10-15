import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UpdateNotice } from './shared/update-notice';

@Component({
  selector: 'cad-root',
  imports: [RouterOutlet, UpdateNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet /><cad-update-notice />',
  styles: ':host { display: contents; }',
})
export class App {}
