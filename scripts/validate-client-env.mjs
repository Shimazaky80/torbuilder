import { loadEnv } from 'vite';

const fileEnv = loadEnv('production', process.cwd(), 'VITE_');
const env = { ...fileEnv, ...process.env };
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_APP_URL'];
const missing = required.filter((name) => !String(env[name] || '').trim());

if (missing.length) {
  console.error(`Missing required client build variable(s): ${missing.join(', ')}`);
  console.error('Set them in the root .env file or the deployment environment.');
  process.exit(1);
}

for (const name of ['VITE_SUPABASE_URL', 'VITE_APP_URL']) {
  let url;
  try {
    url = new URL(env[name]);
  } catch {
    console.error(`${name} must be a valid absolute URL.`);
    process.exit(1);
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    console.error(`${name} must use HTTP or HTTPS.`);
    process.exit(1);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    console.error(`${name} must be an origin without a path, query, or fragment.`);
    process.exit(1);
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    console.error(`${name} must use HTTPS except for a local development URL.`);
    process.exit(1);
  }
}

const unsafeNames = Object.keys(env).filter((name) => (
  /^VITE_.*(?:SERVICE_ROLE|SERVICE_KEY|SECRET|PRIVATE_KEY|PASSWORD)/i.test(name)
));
if (unsafeNames.length) {
  console.error(`Do not expose secret values through Vite variables: ${unsafeNames.join(', ')}`);
  process.exit(1);
}

const key = String(env.VITE_SUPABASE_ANON_KEY);
if (/^sb_secret_/i.test(key)) {
  console.error('VITE_SUPABASE_ANON_KEY must be a public anon/publishable key, not an sb_secret key.');
  process.exit(1);
}
const jwtPayload = key.split('.')[1];
if (jwtPayload) {
  try {
    if (JSON.parse(Buffer.from(jwtPayload, 'base64url').toString('utf8')).role === 'service_role') {
      console.error('VITE_SUPABASE_ANON_KEY must not contain a service_role JWT.');
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('VITE_SUPABASE_ANON_KEY contains an invalid JWT payload.');
      process.exit(1);
    }
    throw error;
  }
}

console.log('Client build environment is configured; no service-role key detected.');
