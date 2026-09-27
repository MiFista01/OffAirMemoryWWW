import { GuestComponent } from '@pages';
import { Routes } from '@angular/router';
import { translateResolver } from '@resolvers';

export const guestRoutes: Routes = [
  {
    path: 'guest',
    component: GuestComponent,
    resolve: {
      translate: translateResolver,
    },
    children: [
      {
        path: 'tv/:slug',
        loadComponent: () =>
          import('../pages/guest/channel-watch/channel-watch.component').then(
            (m) => m.ChannelWatchComponent,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: 'tv/nickelodeon' },
    ],
  },
];
