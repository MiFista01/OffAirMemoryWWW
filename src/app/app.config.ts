import { registerLocaleData } from '@angular/common';
import { HttpBackend, provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, inject, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withPreloading, withViewTransitions } from '@angular/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { MarkdownModule } from 'ngx-markdown';
import { routes } from './app.routes';
import { NgxTranslateService } from '@services';
import localeEt from '@angular/common/locales/et';
import { providePrimeNG } from 'primeng/config';
import { MessageService } from 'primeng/api';
import Aura from '@primeng/themes/aura';
import Lara from '@primeng/themes/lara';
import Material from '@primeng/themes/material';
import Nora from '@primeng/themes/nora';

registerLocaleData(localeEt, 'et');

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withViewTransitions(),
      withComponentInputBinding(),
      withPreloading(PreloadAllModules),
    ),
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: () => inject(NgxTranslateService).getLoader('common'),
          deps: [HttpBackend]
        }
      }),
      MarkdownModule.forRoot(),
    ),
    providePrimeNG({
      theme: {
        preset: Material,
        options: {
          ripple: false,
          prefix: 'p',
          darkModeSelector: 'system',
          cssLayer: false
        },
      }
    }),
    MessageService,
    provideAnimationsAsync(),
    provideHttpClient(),
    provideClientHydration()
  ]
};
