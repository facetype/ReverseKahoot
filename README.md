# Blinded Flutter

<!-- TODO: one or two sentences on the game concept -->

> **Status:** early development.

## Getting started

### Setup

```bash
npm install
copy .env.example .env
```

Open `.env` and fill in the values from your Supabase dashboard
(Project Settings, then API):

```
VITE_SUPABASE_URL = "https://<your-project>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY = "<your publishable key>"
```

Never commit `.env`. It is git-ignored. Only use the **publishable** key here, never
a `service_role` or secret key, because everything prefixed `VITE_` is shipped to the browser.

```bash
npm run dev
```

### Scripts

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start the Vite dev server                 |
| `npm run build`   | Type-check (`tsc -b`) and build for production |
| `npm run preview` | Serve the production build locally        |
| `npm run lint`    | Lint with oxlint                          |

## Project structure

The folder layout is meant to explain itself. Run this from the project root
(through WSL on Windows) to get an overview:

```bash
tree -d -I 'node_modules|.git|dist'
```

Every folder name says what lives there, so the output of `tree` should be
enough to find what you are looking for without searching through files.
The top levels look like this (sub folders inside `pages/`, `features/` and
`common/` are left out on purpose, `tree` shows them):

```
.                  Project metadata and tooling config
├── public/        Static files served as-is
├── supabase/      Database migrations and edge functions
└── src/
    ├── main.tsx   App entry, mounts the router
    ├── pages/     Route-level pages, one folder each
    ├── features/  Standalone app features that are not pages
    ├── common/    Code shared across the whole app
    └── api/       Frontend access to the backend
```

### Root: project metadata

The root holds no app code. It holds files that describe and configure the
project: `package.json`, `vite.config.ts`, `tsconfig*.json`,
`eslint.config.js`, `index.html`, this README and so on. If you are looking
for a build, lint or TypeScript setting, it is here.

### `src/pages/<SomePage>/`

Pages are route-level: every page is a component that a `<Route>` in
`AppRoutes.tsx` renders directly. Each page gets its own folder, for example
`pages/auth/` or `pages/quizcrud/`. The folder holds the page component and
everything that only that page uses: its CSS, hooks and small sub components.
A component that no route renders directly is not a page. Keeping it all
together means a page can be understood, changed or deleted by looking at a
single folder.

### `src/features/`

A feature is a specific piece of app functionality that is **not** a page,
**not** shared utility code, and **not** connected to the API. It is app
logic that stands on its own, such as the route table in `features/routes/`.
If something is only used by one page, put it in that page's folder instead.

### `src/common/`

Code that is reused across several pages or features: shared components,
hooks, utils, types, constants, context providers, assets and global styles.
Nothing in `common/` should depend on a specific page. If code is only used
in one place, it does not belong here.

### `src/api/`

Everything from the backend that the frontend needs to read or call lives
here, grouped by service (`api/supabase/`). This is the client setup and the
data access functions (quizzes, games, profiles). Code that runs on the
backend itself, such as edge functions and migrations, does not go here. It
goes in `supabase/` at the project root. Pages and features call these
functions instead of talking to Supabase directly, so the backend can change
in one place.

### Routing

Routes are defined in `src/features/routes/AppRoutes.tsx` and use a
`HashRouter`, so URLs look like `/#/quizzes/new`. Login is a normal route
now, not a separate HTML entry.

| Path               | Page                                  |
| ------------------ | ------------------------------------- |
| `/`                | `pages/landingpage/LandingPage`       |
| `/login`           | `pages/auth/Login`                    |
| `/quizzes`         | `pages/quizcrud/QuizList`             |
| `/quizzes/new`     | `pages/quizcrud/QuizEditor`           |
| `/quizzes/:quizId` | `pages/quizcrud/QuizEditor`           |
| anything else      | `pages/landingpage/LandingPage`       |

To add a page, create `src/pages/<SomePage>/`, then add a `<Route>` for it in
`AppRoutes.tsx`.

Imports across folders use the `@/` alias, which maps to `src/`
(for example `@/api/supabase/quiz-api`). It is configured in both
`vite.config.ts` and `tsconfig.app.json`, so keep the two in sync.