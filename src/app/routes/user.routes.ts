import { Routes } from '@angular/router';
import { authGuard, userInitGuard } from '@guards';
import { UserComponent } from '@pages';
import { languageResolver, translateResolver } from '@resolvers';

export const userRoutes: Routes = [
  {
    path: 'user',
    component: UserComponent,
    resolve: {
      language: languageResolver,
      translations: translateResolver,
    },
    canActivate: [userInitGuard],
    canActivateChild: [authGuard],
    children: [],
  },
];
