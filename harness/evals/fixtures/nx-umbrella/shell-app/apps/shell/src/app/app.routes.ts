import { loadRemoteModule } from '@nx/angular/mf';

export const appRoutes = [
  { path: 'orders', loadChildren: () => loadRemoteModule('app-a', './Routes').then((m) => m.remoteRoutes) },
];
