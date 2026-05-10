import crypto from 'crypto';

export function isDevMode() {
  return !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET;
}

export const PLAN_AMOUNTS = {
  monthly: 99900, // ₹999
  yearly: 499900, // ₹4999
  lifetime: 2499900, // ₹24999
};

export async function createOrder({ amount, plan, userId }) {
  if (isDevMode()) {
    return {
      id: 'order_dev_' + Date.now(),
      amount,
      currency: 'INR',
      status: 'created',
      devMode: true,
      notes: { plan, userId },
    };
  }
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + auth,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      currency: 'INR',
      receipt: 'rcpt_' + Date.now(),
      notes: { plan, userId: String(userId) },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Razorpay order error ' + res.status + ': ' + text);
  }
  const json = await res.json();
  return { ...json, devMode: false };
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return signature && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
