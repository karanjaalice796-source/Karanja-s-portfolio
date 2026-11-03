const assert = require('node:assert/strict');
const test = require('node:test');
const { createMpesaClient, normalizePhone } = require('../mpesa');

const callbackToken = 'a'.repeat(64);
const env = {
  MPESA_ENVIRONMENT: 'sandbox',
  MPESA_CONSUMER_KEY: 'consumer-key',
  MPESA_CONSUMER_SECRET: 'consumer-secret',
  MPESA_PASSKEY: 'passkey',
  MPESA_SHORT_CODE: '174379',
  MPESA_CALLBACK_TOKEN: callbackToken,
  MPESA_CALLBACK_URL: `https://example.test/payments/mpesa/callback/${callbackToken}`,
};

test('normalizes Kenya mobile numbers and rejects invalid input', () => {
  assert.equal(normalizePhone('0712 345 678'), '254712345678');
  assert.equal(normalizePhone('+254 712-345-678'), '254712345678');
  assert.equal(normalizePhone('123'), null);
});

test('enables only a complete HTTPS callback configuration', () => {
  assert.equal(createMpesaClient({ env }).isConfigured(), true);
  assert.equal(createMpesaClient({
    env: { ...env, MPESA_CALLBACK_URL: `http://example.test/payments/mpesa/callback/${callbackToken}` },
  }).isConfigured(), false);
  assert.equal(createMpesaClient({
    env: { ...env, MPESA_CALLBACK_URL: `https://example.test/payments/mpesa/callback/${'b'.repeat(64)}` },
  }).isConfigured(), false);
});

test('initiates and queries a Sandbox payment using cached OAuth credentials', async () => {
  const calls = [];
  const payloads = [
    { access_token: 'sandbox-access-token', expires_in: '3599' },
    { ResponseCode: '0', CheckoutRequestID: 'ws_CO_123', MerchantRequestID: 'mr_123' },
    { ResponseCode: '0', ResultCode: '0' },
  ];
  const client = createMpesaClient({
    env,
    now: () => new Date('2026-11-03T08:00:00.000Z'),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => payloads.shift() };
    },
  });
  const initiated = await client.initiateStkPush({
    phone: '0712345678',
    amount: 1250,
    accountReference: 'EV12',
    description: 'Ticket 12',
  });
  assert.deepEqual(initiated, {
    checkoutRequestId: 'ws_CO_123',
    merchantRequestId: 'mr_123',
    customerMessage: '',
  });
  const query = await client.queryStkPush(initiated.checkoutRequestId);
  assert.equal(String(query.ResultCode), '0');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials');
  assert.equal(calls[1].url, 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
  assert.equal(calls[2].url, 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query');
  assert.equal(JSON.parse(calls[1].options.body).Amount, 1250);
  assert.equal(JSON.parse(calls[1].options.body).PhoneNumber, '254712345678');
  assert.equal(JSON.parse(calls[2].options.body).CheckoutRequestID, 'ws_CO_123');
});

test('does not request a payment for invalid phone numbers or fractional amounts', async () => {
  let calls = 0;
  const client = createMpesaClient({
    env,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Unexpected request');
    },
  });
  await assert.rejects(client.initiateStkPush({
    phone: 'not-a-phone',
    amount: 100,
    accountReference: 'EV1',
    description: 'Ticket',
  }), /valid Kenyan mobile number/);
  await assert.rejects(client.initiateStkPush({
    phone: '0712345678',
    amount: 10.5,
    accountReference: 'EV1',
    description: 'Ticket',
  }), /whole KES amounts/);
  assert.equal(calls, 0);
});
