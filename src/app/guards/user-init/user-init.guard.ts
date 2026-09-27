import { catchError, map, of, take, tap } from 'rxjs';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserData } from '@interface';
import { AccountCoreService, AuthCoreService } from '@services';

/**
 * Loads the authenticated user into AccountCoreService before user routes activate.
 */
export const userInitGuard: CanActivateFn = (route, state) => {
  const account = inject(AccountCoreService);
  const auth = inject(AuthCoreService);
  const router = inject(Router);

  return auth.checkUser()
    .pipe(
      take(1),
      tap((userData: UserData) => {
        if (userData) {
          account.saveActiveAccountById(userData.userId);
        }
      }),
      map((userData: UserData) => {
        if (!userData) {
          router.navigate(["/guest"]);
          return false;
        }
        return true;
      }),
      catchError((err: any) => {
        router.navigate(["/guest"]);
        return of(false);
      })
    );
};
