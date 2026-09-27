import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { activeLanguages } from '@const';
import { Settings, User } from '@interface';
import { AccountCoreService, NgxTranslateService } from '@services';
import {
  catchError,
  filter,
  map,
  of,
  switchMap,
  take,
  timeout,
} from 'rxjs';

/**
 * Sets UI language from user settings (DB) before section translations load.
 * Falls back to lang cookie / app default when guest or settings unavailable.
 */
export const languageResolver: ResolveFn<boolean> = () => {
  const account = inject(AccountCoreService);
  const ngxTranslate = inject(NgxTranslateService);

  return account.user$.pipe(
    filter((user): user is User => !!user?.id),
    take(1),
    timeout(15000),
    switchMap((user) => resolveLanguageForUser(account, user, ngxTranslate)),
    catchError(() =>
      ngxTranslate.applyLanguage(ngxTranslate.resolveLang(ngxTranslate.getTranslateForResolver())).pipe(
        map(() => true),
      ),
    ),
  );
};

function resolveLanguageForUser(
  account: AccountCoreService,
  user: User,
  ngxTranslate: NgxTranslateService,
) {
  const embedded = user.settings?.language;
  if (embedded) {
    return ngxTranslate
      .applyLanguage(normalizeLanguage(embedded))
      .pipe(map(() => true));
  }

  return account.settings$.pipe(
    filter((settings): settings is Settings => !!settings?.language),
    take(1),
    timeout(10_000),
    switchMap((settings) =>
      ngxTranslate
        .applyLanguage(normalizeLanguage(settings.language))
        .pipe(map(() => true)),
    ),
    catchError(() =>
      ngxTranslate
        .applyLanguage(ngxTranslate.resolveLang(ngxTranslate.getTranslateForResolver()))
        .pipe(map(() => true)),
    ),
  );
}

function normalizeLanguage(lang: string): string {
  const code = lang === 'est' ? 'ee' : lang;
  return activeLanguages.includes(code) ? code : 'ee';
}
