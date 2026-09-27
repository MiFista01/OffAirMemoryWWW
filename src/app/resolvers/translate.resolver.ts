import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { NgxTranslateService } from '@services';


/**
 * Translation resolver for loading section-specific translations before route activation.
 * 
 * Route resolver that preloads translation data for specific application sections
 * using NgxTranslateService. Extracts section name from route configuration and
 * loads corresponding translations to ensure localized content is available
 * before component initialization, providing seamless multilingual user experience.
 */
export const translateResolver: ResolveFn<boolean> = (route) => {
  const ngxTranslate = inject(NgxTranslateService);
  const sectionName = route.pathFromRoot[1]?.routeConfig?.path;
  if (!sectionName) {
    return of(true);
  }
  return ngxTranslate.whenLanguageReady().pipe(
    switchMap(() => ngxTranslate.loadAndSetTranslations(sectionName)),
  );
};
