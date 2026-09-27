import { Routes } from '@angular/router';
import { guestRoutes, userRoutes } from '@routes';

export const routes: Routes = [
  ...guestRoutes,
  ...userRoutes,
  {
    path: '',
    redirectTo: 'guest',
    pathMatch: 'full',
  },
];
