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

2. Copy `.env.example` to `.env` and set your development/staging Supabase project URL and public client key:

   ```dotenv
   VITE_SUPABASE_URL=https://<development-project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<development-public-anon-or-publishable-key>
   VITE_APP_URL=http://localhost:5173
   ```

   The frontend uses these values at build time. The anon/publishable key is intended for browser use; database access must be protected by the project's authentication and Row Level Security policies. `.env*` files are ignored by Git except for the safe `.env.example` template.

3. Apply the required, reviewed database migrations from `supabase/migrations/` using your approved Supabase migration workflow. Apply migrations in filename order and validate them against a non-production project before production.

   **Never use `supabase/schema.sql` to deploy to staging or production.** It is a destructive development reset script: it drops core tables with `CASCADE` and can permanently delete data. Production schema changes must use reviewed, incremental migrations.

4. Start the development server:

   ```sh
   npm run dev
   ```

## Common commands

```sh
npm run lint
npm test
npm run build
npm run preview
npm run audit:schema
npm run test:schema-audit
```

`npm test` discovers and runs every focused `test:*` script, including schema-audit parser, pricing, package, finance, room allocation, Series departure, and access-control tests. Individual tests can also be run with their corresponding `npm run test:*` script.

`npm run audit:schema` performs a read-only comparison of migration-declared columns and the fields requested by the library against the live PostgREST schema cache. It requires `VITE_SUPABASE_URL` and preferably `SUPABASE_SERVICE_KEY` in the root `.env`; it can fall back to `VITE_SUPABASE_ANON_KEY`. The service-role key is for local auditing only: never prefix it with `VITE_`, commit it, or expose it to the browser. The audit checks columns, not every database policy or behavior, and does not replace migration review or staging validation.

## Staging and production environments

Use separate Supabase projects and separate Cloudflare Pages build environments. The chosen launch setup is a Free Supabase project for staging and a separate Pro project for production before storing real customer data.

| Cloudflare Pages environment | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `VITE_APP_URL` |
| --- | --- | --- |
| Preview (staging) | Staging Supabase project's URL and public anon/publishable key | `https://staging.torbuilder.com` |
| Production | Production Supabase project's URL and public anon/publishable key | `https://torbuilder.com` |

Set all three variables for both Preview and Production in the Pages project settings. `VITE_APP_URL` is the canonical site origin used for password-reset, account-confirmation, and invitation links; it must match the domain users should return to. Do not configure production variables on Preview builds or staging credentials on Production builds.

In each Supabase project's Authentication URL Configuration, set its Site URL to that environment's `VITE_APP_URL`. Add only that environment's origin to its Redirect URLs (for example `https://staging.torbuilder.com/**` in staging and `https://torbuilder.com/**` in production). Add `http://localhost:5173/**` only to a development/staging project's allow-list when local testing needs it; do not allow arbitrary preview domains in production.

Use Resend for transactional authentication emails. Verify a sending domain and its email-authentication DNS records in Resend, configure the resulting SMTP credentials in each Supabase project's Auth SMTP settings, then test confirmation, password-reset, and invitation emails end to end. Supabase project creation and SMTP/DNS configuration are dashboard/provider steps; this repository does not perform them.

`npm run build` runs a prebuild configuration check. It requires the Supabase URL, public anon/publishable key, and app URL; it rejects insecure non-local URLs and obvious service-role/secret key configurations. CI supplies non-functional build-only placeholders. Never use these placeholders in a deployed build, and never put `SUPABASE_SERVICE_KEY` or any `VITE_*` secret in Cloudflare Pages variables.

## Production frontend deployment

Build the static site with `npm run build` and publish the generated `dist/` directory to a static web host. Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_APP_URL` in the host's build environment, and configure SPA/history fallback to `index.html` so direct links to application routes work. Do not put database service-role credentials in frontend build variables.

The GitHub Actions workflow installs dependencies, runs lint and all tests, and verifies the production build on pushes to `main` and pull requests targeting `main`; it does not deploy the site.

## Database change safety

- Treat each file in `supabase/migrations/` as an incremental change; review the SQL and its data impact before applying it.
- Test pending migrations against a staging or disposable database and keep a verified backup before production changes.
- Do not run `supabase/schema.sql` against any database that contains data you need to keep.
- Run `npm run audit:schema` after applying migrations to check the live column cache.
