# IDE Extensions for Angular

## Task Management

### Task Tree
- **Extension ID**: `andres-munoz.tasktree`
- **Description**: Manage tasks directly in IDE using `tasks.json`
- **Usage**: 
  - Tasks are stored in `tasks.json` (should be in Git for team collaboration)
  - Use tags for assignment: `@username` for team member nicknames
  - Combine tags: `@username`, `bug`, `high-priority`

### Bookmarks
- **Extension ID**: `alefragnani.bookmarks`
- **Description**: Bookmarks for quick code navigation
- **Hotkey**: `Ctrl+Alt+K` to create bookmark

## Translation & Internationalization

### Comment Translate
- **Extension ID**: `intellsmi.comment-translate`
- **Description**: Translate comments and strings in code
- **Configuration** (add to `.vscode/settings.json`):
{
  "commentTranslate.targetLanguage": "ru",
  "commentTranslate.maxTranslationLength": 1000000,
  "commentTranslate.browse.enabled": false,
  "commentTranslate.ignore": [],
  "commentTranslate.hover.string": false,
  "commentTranslate.hover.concise": false,
  "commentTranslate.hover.variable": false,
  "commentTranslate.multiLineMerge": false,
  "commentTranslate.hover.content": true,
  "commentTranslate.hover.enabled": true
}
- **Usage**: Hover over comments or strings to see translation

## Angular Development

### Core Angular Support
- `angular.ng-template` - Angular template support
- `johnpapa.angular-essentials` - Angular essential extensions pack
- `johnpapa.angular2` - Angular 2+ snippets
- `infinity1207.angular2-switcher` - Switch between component files
- `john-crowson.angular-file-changer` - Angular file navigation
- `tomwhite007.rename-angular-component` - Rename Angular components

### Angular HTML/Template
- `ghaschel.vscode-angular-html` - Angular HTML support
- `alexiv.vscode-angular2-files` - Angular 2 file templates
- `dannymcgee.ng-html` - Angular HTML snippets
- `vismalietuva.vscode-angular-support` - Angular language support

### Angular Snippets
- `danielehrhardt.ionic3-vs-ionview-snippets` - Ionic/Angular snippets
- `fivethree.vscode-ionic-snippets` - Ionic snippets
- `pinkpotato.ionic-essentials` - Ionic essentials
- `segerdekort.angular-cli` - Angular CLI snippets
- `mikael.angular-beastcode` - Angular Beast Code snippets

### i18n Ally (ngx-translate)
- **Extension ID**: `lokalise.i18n-ally`
- **Description**: Internationalization support for Angular projects using ngx-translate
- **Configuration** (add to `.vscode/settings.json`):
{
  "i18n-ally.localesPaths": [
    "public/i18n"
  ],
  "i18n-ally.displayLanguage": "en",
  "i18n-ally.enabledFrameworks": [
    "ngx-translate"
  ],
  "i18n-ally.enabledParsers": [
    "json"
  ],
  "i18n-ally.extract.autoDetect": true,
  "i18n-ally.keystyle": "nested",
  "i18n-ally.pathMatcher": "{locale}/**/*.json",
  "i18n-ally.extract.keygenStyle": "camelCase",
  "i18n-ally.editor.preferEditor": true,
  "i18n-ally.dirStructure": "auto",
  "i18n-ally.extract.targetPickingStrategy": "most-similar",
  "i18n-ally.extract.keyMaxLength": 10000000000,
  "i18n-ally.extract.keygenStrategy": "slug",
  "i18n-ally.languageTagSystem": "bcp47",
  "i18n-ally.ignoredLocales": []
}
### Angular Recommended Settings
Add to `.vscode/settings.json`:n
{
  "vscode-angular-html.angularAnimationTriggerPrefix": "#B4F9F8",
  "vscode-angular-html.angularBindingAttributeDelimiter": "#B4F9F8",
  "vscode-angular-html.angularExpression": "#B4F9F8",
  "vscode-angular-html.angularPrefixedAttributesRefPrefix": "#B4F9F8",
  "vscode-angular-html.angularSyntaxSugarAttributesPrefix": "#B4F9F8",
  "vscode-angular-html.angularTemplateVariablePrefix": "#B4F9F8",
  "vscode-angular-html.colorCustomizations": true,
  "vscode-angular-html.dtdDoctypeQuantifier": "#B4F9F8",
  "vscode-angular-html.xmlAttributeNamespaceDivider": "#B4F9F8",
  "vscode-angular-html.xmlTagNamespaceDivider": "#B4F9F8",
  "vscode-angular-html.controlFlowPrefix": "#B4F9F8"
}

### TypeScript Support
- `ms-vscode.vscode-typescript-next` - TypeScript language support
- `steoates.autoimport` - Auto import modules
- `pmneo.tsimporter` - TypeScript import management
- `rbbit.typescript-hero` - TypeScript utilities
- `stringham.move-ts` - Move TypeScript files with imports update

### JavaScript Snippets
- `akamud.vscode-javascript-snippet-pack` - JavaScript snippets
- `nathanchapman.javascriptsnippets` - Additional JS snippets
- `xabikos.javascriptsnippets` - More JS snippets
- `runningcoder.js-snippets` - JS code snippets

### Import Management
- `cmborchert.local-import-intellisense` - Local import intellisense
- `mike-co.import-sorter` - Sort and organize imports
- `christian-kohler.npm-intellisense` - NPM package intellisense
- `christian-kohler.path-intellisense` - Path autocomplete

## Git & Version Control

- `mhutchie.git-graph` - Visualize Git graph
- `codezombiech.gitignore` - Work with .gitignore files
- `maciejdems.add-to-gitignore` - Quick add to .gitignore

## Code Formatting & Quality

### JSON Formatting
- `supperchong.pretty-json` - JSON formatter
- `chrismeyers.vscode-pretty-json` - Alternative JSON formatter
- `mohsen1.prettify-json` - JSON prettifier
- `meezilla.json` - JSON tools
- `zainchen.json` - JSON utilities

### TypeScript Formatting
- `mylesmurphy.prettify-ts` - TypeScript formatter

### Spell Checking
- `streetsidesoftware.code-spell-checker` - Code spell checker
- `streetsidesoftware.code-spell-checker-russian` - Russian spell checker

## Utilities

### Comments
- `aaron-bond.better-comments` - Better comment highlighting
- `parthr2031.colorful-comments` - Colorful comments

### Environment Files
- `bernardxiong.env-vscode` - .env file support
- `irongeek.vscode-env` - Alternative .env support

### File Management
- `thinker.data-size-count` - Count data size
- `jannisx11.batch-rename-extension` - Batch rename files
- `yutengjing.vscode-archive` - Archive viewer
- `avive.archive-viewer` - Archive utilities

### Code Utilities
- `adrianwilczynski.terminal-commands` - Terminal commands
- `adrianwilczynski.toggle-hidden` - Toggle hidden files
- `akhail.save-typing` - Save typing utilities
- `tenjojeremy.word-intellisense` - Word intellisense