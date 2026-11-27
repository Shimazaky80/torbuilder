import assert from 'node:assert/strict';
import { appUrl } from '../src/lib/appUrl.js';

assert.equal(
  appUrl('/partner-register?invite=a%20b', {
    origin: 'https://preview.pages.dev',
    baseUrl: 'https://staging.torbuilder.com/'
  }),
  'https://staging.torbuilder.com/partner-register?invite=a%20b'
);
assert.equal(
  appUrl('/reset-password', {
    origin: 'http://localhost:5173',
    baseUrl: ''
  }),
  'http://localhost:5173/reset-password'
);
assert.throws(
  () => appUrl('https://outside.example/login', {
    origin: 'https://torbuilder.com',
    baseUrl: 'https://torbuilder.com'
  }),
  /must stay on the configured application origin/
);

console.log('Application URL tests passed.');
