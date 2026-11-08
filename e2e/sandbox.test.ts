import assert from 'node:assert/strict';
import test from 'node:test';

// Opt-in connectivity smoke only. The mock demo suite owns unattended checkout/dispute coverage.
const enabled = process.env.PAYFLOW_E2E_SANDBOX === '1';
const credentialsPresent = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
test('opt-in PayPal sandbox OAuth connectivity (no purchase or capture)', {
  skip: !enabled ? 'Set PAYFLOW_E2E_SANDBOX=1 to opt in' : !credentialsPresent ? 'Sandbox credentials are absent' : false,
}, async () => {
  // Pin the host; never accept an env override or redirect to another PayPal environment.
  const authorization = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Basic ${authorization}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  // Never include upstream response bodies, headers, tokens, or credentials in assertions/logs.
  assert.equal(response.status, 200, 'Sandbox OAuth request must succeed');
  const body = await response.json();
  assert.equal(typeof body.access_token === 'string' && body.access_token.length > 0, true, 'Sandbox returns an access token');
  assert.equal(body.token_type?.toLowerCase() === 'bearer', true, 'Sandbox uses bearer tokens');
});
