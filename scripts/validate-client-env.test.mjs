import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(root, 'scripts', 'validate-client-env.mjs');
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_'))
);
const validEnv = {
  VITE_SUPABASE_URL: 'https://staging.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test_key',
  VITE_APP_URL: 'https://staging.torbuilder.com'
};

const runValidator = (overrides = {}) => spawnSync(
  process.execPath,
  [validator],
  {
    cwd: root,
    env: { ...inheritedEnv, ...validEnv, ...overrides },
    encoding: 'utf8'
  }
);

assert.equal(runValidator().status, 0, 'accepts valid HTTPS client configuration');
assert.notEqual(runValidator({ VITE_APP_URL: '' }).status, 0, 'requires an app origin');
assert.notEqual(
  runValidator({ VITE_SUPABASE_URL: 'http://remote.example' }).status,
  0,
  'rejects insecure remote Supabase URLs'
);
assert.notEqual(
  runValidator({ VITE_SUPABASE_SERVICE_KEY: 'test-secret' }).status,
  0,
  'rejects secret-named Vite variables'
);
assert.notEqual(
  runValidator({
    VITE_SUPABASE_ANON_KEY: `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`
  }).status,
  0,
  'rejects a service-role JWT in the public key field'
);

console.log('Client build environment validation tests passed.');
