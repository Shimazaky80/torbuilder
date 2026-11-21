# TourBuilder

TourBuilder is a browser-based itinerary and tour operations application for travel companies. It connects to Supabase for authentication and data storage; the frontend is a static React application.

## What it includes

- Itinerary building, quotations, booking status and consultant access controls
- A supplier and service library with seasonal pricing
- Reusable packages and scheduled series departures
- Client, supplier and guide-team management
- Invoicing, receipts and finance reporting
- Partner portal, tariffs and partner quotations
- Company settings, analytics and platform administration

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- A Supabase project

## Local setup

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Create a `.env` file in the repository root with the Supabase project URL and public client key:

   ```dotenv
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<supabase-public-anon-key>
   ```

   The frontend uses these values at build time. The anon key is intended for browser use; database access must be protected by the project's authentication and Row Level Security policies.

3. Apply the required, reviewed database migrations from `supabase/migrations/` using your approved Supabase migration workflow. Apply migrations in filename order and validate them against a non-production project before production.

   **Never use `supabase/schema.sql` to deploy to staging or production.** It is a destructive development reset script: it drops core tables with `CASCADE` and can permanently delete data. Production schema changes must use reviewed, incremental migrations.

4. Start the development server:

   ```sh
   npm run dev
   ```

## Common commands

```sh
npm run lint
npm run build
npm run preview
npm run audit:schema
npm run test:schema-audit
```

The project also has focused `test:*` scripts in `package.json`, including pricing, package, finance, room allocation, series departure and access-control tests.

`npm run audit:schema` performs a read-only comparison of migration-declared columns and the fields requested by the library against the live PostgREST schema cache. It requires `VITE_SUPABASE_URL` and preferably `SUPABASE_SERVICE_KEY` in the root `.env`; it can fall back to `VITE_SUPABASE_ANON_KEY`. The service-role key is for local auditing only: never prefix it with `VITE_`, commit it, or expose it to the browser. The audit checks columns, not every database policy or behavior, and does not replace migration review or staging validation.

## Production frontend deployment

Build the static site with `npm run build` and publish the generated `dist/` directory to a static web host. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's build environment, and configure SPA/history fallback to `index.html` so direct links to application routes work. Do not put database service-role credentials in frontend build variables.

The GitHub Actions workflow verifies dependency installation and the production build on pushes to `main` and pull requests targeting `main`; it does not deploy the site.

## Database change safety

- Treat each file in `supabase/migrations/` as an incremental change; review the SQL and its data impact before applying it.
- Test pending migrations against a staging or disposable database and keep a verified backup before production changes.
- Do not run `supabase/schema.sql` against any database that contains data you need to keep.
- Run `npm run audit:schema` after applying migrations to check the live column cache.
