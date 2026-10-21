import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'CADence',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'projects/:projectId',
    loadComponent: () => import('./editor/editor-page').then((m) => m.EditorPage),
  },
  {
    path: 'projects/:projectId/documents/:documentId',
    loadComponent: () => import('./editor/editor-page').then((m) => m.EditorPage),
  },
  {
    // A link to view a project shared on a CADence server (CAD-177).
    path: 'shared',
    title: 'CADence',
    loadComponent: () => import('./home/shared-link-page').then((m) => m.SharedLinkPage),
  },
  { path: '**', redirectTo: '' },
];
