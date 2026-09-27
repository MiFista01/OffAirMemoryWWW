import { HttpBackend } from '@angular/common/http';
import { Injectable, Injector } from '@angular/core';
import { TranslateFileConfig } from 'app/interfaces/translate.interface';
import { TranslateService } from '@ngx-translate/core';
import { MultiTranslateHttpLoader } from 'ngx-translate-multi-http-loader';
import { BehaviorSubject, filter, map, Observable, of, Subscription, switchMap, take, tap } from 'rxjs';
import { CookieService } from 'ngx-cookie-service';
import { activeLanguages, transFileNames } from '@const';

/**
 * Translation service for dynamic multilingual content management with section-based loading.
 * 
 * Advanced translation management service featuring dynamic translation loading by sections,
 * language switching with cookie persistence, and multi-file translation support. Includes
 * BehaviorSubject for reactive language state management, subscription management for
 * language changes, and MultiTranslateHttpLoader integration for efficient translation
 * loading. Provides section-based translation loading for optimal performance and
 * comprehensive internationalization support with proper cleanup and error handling.
 */
@Injectable({
  providedIn: 'root'
})
export class NgxTranslateService {
  langChange_: Subscription | null = null;
  availableLanguages_: Subscription | null = null;
  private langChanges_ = new Map<string, Subscription>();

  private $availableLanguages = new BehaviorSubject<string[]>([]);
  private $currentLanguage = new BehaviorSubject<string>('ee');
  private readonly $languageReady = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly httpBackend: HttpBackend,
    private readonly cookies: CookieService,
    private readonly injector: Injector,
  ) { }

  /** Lazy resolve avoids DI cycle with TranslateModule loader factory. */
  getTranslateForResolver(): TranslateService {
    return this.injector.get(TranslateService);
  }

  private getTranslate(): TranslateService {
    return this.getTranslateForResolver();
  }

  whenLanguageReady(): Observable<boolean> {
    if (this.$languageReady.value) {
      return of(true);
    }
    return this.$languageReady.pipe(filter(Boolean), take(1));
  }

  applyLanguage(lang: string): Observable<unknown> {
    const normalized = activeLanguages.includes(lang) ? lang : 'ee';
    this.$currentLanguage.next(normalized);
    this.cookies.set('lang', normalized, undefined, '/');
    return this.getTranslate().use(normalized).pipe(
      tap(() => this.$languageReady.next(true)),
    );
  }

  initialize(lang: string) {
    const initial = this.cookies.get('lang') || lang;
    this.$currentLanguage.next(initial);
    if (!this.cookies.get('lang')) {
      this.cookies.set('lang', initial, undefined, '/');
    }
    this.$availableLanguages.next(activeLanguages);
    this.applyLanguage(initial).pipe(take(1)).subscribe();
  }

  getAvailableLanguages() {
    return this.$availableLanguages.asObservable();
  }

  get currentLanguage$() {
    return this.$currentLanguage.asObservable();
  }

  setCurrentLanguage(language: string) {
    this.applyLanguage(language).pipe(take(1)).subscribe();
  }

  /** Language from cookie / app state — not ngx-translate defaultLang ('ee'). */
  resolveLang(translate: TranslateService): string {
    return (
      this.cookies.get('lang') ||
      this.$currentLanguage.value ||
      translate.currentLang ||
      translate.defaultLang ||
      'ee'
    );
  }

  backendAvailableLanguages() {
    if (this.availableLanguages_) {
      this.availableLanguages_.unsubscribe();
    }
    this.availableLanguages_ = of(activeLanguages).subscribe((languages) => {
      this.$availableLanguages.next(languages);
    });
  }

  /**
   * Creates a translation loader for the specified section
   * @param sectionName - Section name (e.g., 'guest', 'user')
   * @returns MultiTranslateHttpLoader or null if section not found
   */
  getLoader(sectionName: string) {
    const config = transFileNames.find(f => f.name === sectionName);
    if (!config) {
      return null;
    }
    const files: TranslateFileConfig[] = [];
    const directory = config.name === 'common' ? '' : config.name + '/';

    config.files.forEach(element => {
      files.push({
        prefix: `/i18n/`,
        suffix: `/${directory}${element}.json`
      });
    });

    return new MultiTranslateHttpLoader(this.httpBackend, files);
  }

  /**
   * Loads and sets translations for a section
   * @param sectionName - Section name to load translations for
   * @returns Observable<boolean> - true on successful load
   */
  loadAndSetTranslations(sectionName: string): Observable<boolean> {
    const translate = this.getTranslate();
    const loader = this.getLoader(sectionName);

    if (!loader) {
      return of(true);
    }

    const lang = this.resolveLang(translate);

    if (this.langChanges_.has(sectionName)) {
      this.langChanges_.get(sectionName)!.unsubscribe();
    }

    const subscription = translate.onLangChange.subscribe((event) => {
      const updatedLoader = this.getLoader(sectionName);
      if (updatedLoader) {
        this.changeLanguage(updatedLoader, event.lang, translate).pipe(take(1)).subscribe();
      }
    });
    this.langChanges_.set(sectionName, subscription);

    const loadSection = () => this.changeLanguage(loader, lang, translate);

    if (translate.currentLang !== lang) {
      return translate.use(lang).pipe(switchMap(() => loadSection()));
    }

    return loadSection();
  }

  /**
   * Changes language and loads translations
   * @param loader - Translation loader
   * @param lang - Language code (e.g., 'en', 'ru')
   * @param translate - Translation service
   * @returns Observable<boolean> - true on successful change
   */
  changeLanguage(loader: MultiTranslateHttpLoader, lang: string, translate: TranslateService) {
    return loader.getTranslation(lang).pipe(
      tap(translations => {
        translate.setTranslation(lang, translations, true);
      }),
      map(() => true)
    );
  }
}