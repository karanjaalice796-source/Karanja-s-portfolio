const crypto = require('node:crypto');

const callbackPath = '/payments/mpesa/callback/';
const phonePattern = /^254[17]\d{8}$/;

function rejectedRequest(message) {
  const error = new Error(message);
  error.code = 'MPESA_REJECTED';
  return error;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  return phonePattern.test(normalized) ? normalized : null;
}

function createMpesaClient({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const environment = env.MPESA_ENVIRONMENT || 'sandbox';
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('MPESA_ENVIRONMENT must be sandbox or production.');
  }
  const host = environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  const callbackToken = env.MPESA_CALLBACK_TOKEN || '';
  const callbackUrl = env.MPESA_CALLBACK_URL || '';
  let cachedAccessToken = null;
  let accessTokenExpiresAt = 0;

  function isConfigured() {
    if (!env.MPESA_CONSUMER_KEY || !env.MPESA_CONSUMER_SECRET || !env.MPESA_PASSKEY
      || !/^\d{5,6}$/.test(env.MPESA_SHORT_CODE || '')
      || !/^[a-f0-9]{64}$/.test(callbackToken)) return false;
    try {
      const url = new URL(callbackUrl);
      return url.protocol === 'https:'
        && !url.username && !url.password && !url.search && !url.hash
        && url.pathname === `${callbackPath}${callbackToken}`;
    } catch {
      return false;
    }
  }

  function timestamp() {
    return now().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  }

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('M-Pesa could not be reached. The payment may still be processing.');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('M-Pesa returned an invalid response.');
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw rejectedRequest('M-Pesa rejected the request. Check the Sandbox configuration and try again.');
      }
      throw new Error('M-Pesa could not confirm the request. It may still be processing.');
    }
    return payload;
  }

  async function accessToken() {
    if (cachedAccessToken && Date.now() < accessTokenExpiresAt) return cachedAccessToken;
    const credentials = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const payload = await requestJson(`${host}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
    });
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new Error('M-Pesa did not provide an access token.');
    }
    const expiresIn = Number(payload.expires_in) || 3599;
    cachedAccessToken = payload.access_token;
    accessTokenExpiresAt = Date.now() + Math.max(0, expiresIn - 60) * 1000;
    return cachedAccessToken;
  }

  async function post(path, body) {
    return requestJson(`${host}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async function initiateStkPush({ phone, amount, accountReference, description }) {
    if (!isConfigured()) throw new Error('M-Pesa Sandbox is not fully configured.');
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('M-Pesa ticket prices must be whole KES amounts.');
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) throw new Error('Enter a valid Kenyan mobile number, such as 0712345678.');
    const time = timestamp();
    const password = Buffer.from(`${env.MPESA_SHORT_CODE}${env.MPESA_PASSKEY}${time}`).toString('base64');
    const payload = await post('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: env.MPESA_SHORT_CODE,
      Password: password,
      Timestamp: time,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: normalizedPhone,
      PartyB: env.MPESA_SHORT_CODE,
      PhoneNumber: normalizedPhone,
      CallBackURL: callbackUrl,
      AccountReference: String(accountReference).slice(0, 12),
      TransactionDesc: String(description).slice(0, 13),
    });
    if (String(payload.ResponseCode) !== '0'
      || typeof payload.CheckoutRequestID !== 'string'
      || typeof payload.MerchantRequestID !== 'string') {
      throw rejectedRequest('M-Pesa did not accept the payment request.');
    }
    return {
      checkoutRequestId: payload.CheckoutRequestID,
      merchantRequestId: payload.MerchantRequestID,
      customerMessage: typeof payload.CustomerMessage === 'string' ? payload.CustomerMessage : '',
    };
  }

  async function queryStkPush(checkoutRequestId) {
    if (!isConfigured()) throw new Error('M-Pesa Sandbox is not fully configured.');
    if (typeof checkoutRequestId !== 'string' || !checkoutRequestId) {
      throw new Error('The M-Pesa checkout request is missing.');
    }
    const time = timestamp();
    const password = Buffer.from(`${env.MPESA_SHORT_CODE}${env.MPESA_PASSKEY}${time}`).toString('base64');
    return post('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: env.MPESA_SHORT_CODE,
      Password: password,
      Timestamp: time,
      CheckoutRequestID: checkoutRequestId,
    });
  }

  function callbackTokenMatches(candidate) {
    if (!isConfigured() || typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate)) return false;
    return crypto.timingSafeEqual(Buffer.from(callbackToken, 'hex'), Buffer.from(candidate, 'hex'));
  }

  return { isConfigured, callbackTokenMatches, initiateStkPush, queryStkPush };
}

module.exports = { createMpesaClient, normalizePhone };
