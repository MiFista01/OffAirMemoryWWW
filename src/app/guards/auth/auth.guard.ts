import { map, tap } from 'rxjs';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserData } from '@interface';
import { AuthCoreService } from '@services';

/**
 * Redirects unauthenticated users to /guest.
 */
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthCoreService);
  const router = inject(Router);

  return auth.checkUser()
  .pipe(
    tap((res: UserData) => {
      if (res === null) {
        router.navigate(['/guest']);
      }
    }),
    map((res: UserData): res is UserData => res !== null),
  );
};
