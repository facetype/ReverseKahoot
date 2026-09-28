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

```
.
├── index.html               Main app entry
├── login/index.html         Login page entry (served at /login/)
├── public/                  Static assets
├── supabase/migrations/     SQL migrations for the database
└── src/
    ├── main.tsx             Main app render
    ├── pages/               Route-level pages
    ├── features/
    │   ├── auth/            Login page, login entry point, useSession hook
    │   └── routes/          AppRoutes: the app's route table
    ├── common/
    │   ├── components/      Shared UI components
    │   ├── hooks/           Shared hooks
    │   ├── utils/           Helpers
    │   ├── types/           Shared TypeScript types
    │   ├── constants/       Shared constants (e.g. join code length)
    │   ├── context/         React context providers
    │   ├── assets/          Images, fonts, etc.
    │   └── styles/          Global and shared CSS
    └── api/
        └── supabase/        Supabase client and data access (quizzes, games, profiles)
```

Imports across folders use the `@/` alias, which maps to `src/`
(for example `@/api/supabase/quiz-api`). It is configured in both
`vite.config.ts` and `tsconfig.app.json`, so keep the two in sync.