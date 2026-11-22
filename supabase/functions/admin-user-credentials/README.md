# admin-user-credentials

Edge Function for admin-initiated credential changes. It accepts:

```json
{ "action": "reset_password", "userId": "<auth user id>", "password": "new-password" }
```

or:

```json
{ "action": "change_email", "userId": "<auth user id>", "email": "new@address.com" }
```

It verifies the caller's JWT, requires `write` on the `users` module via
`user_module_access`, and then applies these rules:

- A platform admin may manage anyone, including their own account.
- A tenant admin may manage only users in their own company and never a platform admin.
- Changing your own account through this function is allowed; signed-in users can
  also change their own password/email directly from **Account credentials** in the sidebar.

Email changes are applied with `email_confirm: true`, so the person can sign in with
the new address immediately.

## Deploy

Link the project once, then deploy the function:

```sh
supabase link --project-ref <project-ref>
supabase functions deploy admin-user-credentials
```

Do **not** deploy with `--no-verify-jwt`; the function verifies the caller's JWT itself
and PostgREST needs that JWT to resolve `auth.uid()` for the access RPC.

## Secrets

Hosted Supabase projects provide `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) to functions automatically.
If your project does not provide the service key, set it explicitly:

```sh
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Never put the service role key in `VITE_*` variables or any frontend code. The browser
helper (`src/lib/adminCredentials.js`) sends only the signed-in user's access token and
the public anon key.

The project must have the RBAC migration that creates `public.user_module_access` (see
`supabase/migrations/20261257_role_based_access_control.sql`) and the `profiles`
columns `company_id`, `user_role` and `is_super_admin`.
