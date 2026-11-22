import { supabase } from './supabase';

/* Admin-initiated credential changes go through an Edge Function. The service
   role key never reaches the browser: this helper sends the signed-in user's
   access token, and the function decides whether that user may manage the
   target account. */
const CREDENTIALS_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-user-credentials`;

const callCredentialsFunction = async (payload, fallbackError) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Sign in again before changing credentials.');
  }

  let response;
  try {
    response = await fetch(CREDENTIALS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('The credential service could not be reached. Check your connection and try again.');
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    /* A proxy or an old deployment can answer with HTML; fall back to status. */
  }
  if (!response.ok || result?.success === false) {
    throw new Error(result?.error || (response.status === 404
      ? 'The credential service is not deployed on this project yet.'
      : fallbackError));
  }
  return result;
};

export const resetUserPassword = (userId, password) => callCredentialsFunction(
  { action: 'reset_password', userId, password },
  'The password could not be reset.'
);

export const changeUserEmail = (userId, email) => callCredentialsFunction(
  { action: 'change_email', userId, email },
  'The email address could not be changed.'
);
