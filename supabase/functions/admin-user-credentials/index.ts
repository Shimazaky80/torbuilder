import { createClient } from 'npm:@supabase/supabase-js@2';

/* Admin-initiated password resets and email changes.
   The browser sends the caller's JWT; the anon client makes the RPC with that
   JWT so auth.uid() is the caller, and the service client is used only after
   the caller has been authorized. The service key stays on the server. */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

const fail = (error: string, status: number) => json({ success: false, error }, status);

const isPlatform = (profile: { is_super_admin?: boolean; user_role?: string } | null) => (
  profile?.is_super_admin === true || profile?.user_role === 'super_admin'
);

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return fail('Only POST requests are supported.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return fail('Credential service is not configured on this project.', 500);
  }

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) {
    return fail('Sign in again before changing credentials.', 401);
  }

  let body: { action?: string; userId?: string; password?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return fail('The request body must be JSON.', 400);
  }

  const action = body?.action;
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const newPassword = typeof body?.password === 'string' ? body.password : '';
  const newEmail = typeof body?.email === 'string' ? body.email.trim() : '';

  if (action !== 'reset_password' && action !== 'change_email') {
    return fail('Unknown credential action.', 400);
  }
  if (!userId) {
    return fail('No user was selected.', 400);
  }
  if (action === 'reset_password' && newPassword.length < 8) {
    return fail('Use a password of at least 8 characters.', 400);
  }
  if (action === 'change_email' && !validEmail(newEmail)) {
    return fail('Enter a valid email address.', 400);
  }

  // The caller's token is what makes user_module_access answer about the caller.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser(token);
  if (authError || !user) {
    return fail('Your session has expired. Sign in again.', 401);
  }

  const { data: access, error: accessError } = await callerClient.rpc('user_module_access', { p_module: 'users' });
  if (accessError) {
    return fail(`Your access could not be checked: ${accessError.message}`, 403);
  }
  if (access !== 'write') {
    return fail('Your account cannot change users’ credentials.', 403);
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: callerProfile, error: callerError } = await service
    .from('profiles')
    .select('id, company_id, user_role, is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (callerError || !callerProfile) {
    return fail('Your account is not attached to a company.', 403);
  }

  const { data: targetProfile, error: targetError } = await service
    .from('profiles')
    .select('id, company_id, user_role, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  if (targetError || !targetProfile) {
    return fail('That person is not in the user list.', 404);
  }

  if (!isPlatform(callerProfile)) {
    if (isPlatform(targetProfile)) {
      return fail('A platform admin account cannot be changed from here.', 403);
    }
    if (!targetProfile.company_id || targetProfile.company_id !== callerProfile.company_id) {
      return fail('You can only change credentials inside your own company.', 403);
    }
  }

  const { error: updateError } = action === 'reset_password'
    ? await service.auth.admin.updateUserById(userId, { password: newPassword })
    : await service.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
  if (updateError) {
    return fail(updateError.message || 'The credentials could not be updated.', 400);
  }

  return json({ success: true });
});
