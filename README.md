# Angular Infra Starter

Стартер на Angular 18: инфраструктура готова, доменную логику добавляешь под проект.

## Что внутри

- **Bootstrap**: `app.config`, guest/user routes, i18n, PrimeNG, markdown
- **Auth**: `AuthCoreService`, `AccountCoreService`, `UsersCoreService`, guards, language/translate resolvers
- **Infra**: HTTP, socket, translate, lightbox, drag-drop, catalogs cache, utils, cron
- **UI kit**: pipes, directives, animations, widgets (pagination, editor, gallery, swiper, upload, lightbox, …)
- **Themes**: color + layout tokens
- **Pages**: пустые guest/user шеллы с `router-outlet` — страницы добавляешь сам

## Запуск

```bash
npm install
npm start
```

API по умолчанию: `http://localhost:3000` (см. `src/environments/`).

## Path aliases

`@services`, `@pipes`, `@widgets`, `@guards`, `@interface`, `@const`, `@abstracts`, `@components`, `@pages`, `@routes`, `@env`, `@css-*`
