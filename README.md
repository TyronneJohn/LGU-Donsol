# LGU Donsol

Project monitoring system for the Municipality of Donsol.

## Folder structure

```
frontend/                 React + Vite (deployed to Vercel)
  apps/
    public/               Public transparency portal
    staff/                Staff portal (Admin, MPDC, Engineering, BAC)
  shared/src/             Code shared by both apps (imported as `@shared/...`)
  static/                 Static files copied as-is into each build (favicon, seal)
backend/                  Supabase
  supabase/
    migrations/           Database schema, RLS policies, triggers
    functions/            Edge Functions (Deno)
dist/                     Build output (git-ignored)
```

`package.json`, `.env`, and the lint config stay at the repo root and cover the whole frontend.

## Frontend

```sh
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev:public        # or dev:staff
npm run build:public      # -> dist/public
npm run build:staff       # -> dist/staff
```

## Backend (Supabase CLI)

Run the CLI from `backend/`, or pass `--workdir backend` from the repo root:

```sh
cd backend
supabase link --project-ref <ref>
supabase db push
supabase functions deploy <name>
```
