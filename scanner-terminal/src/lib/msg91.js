// MSG91 OTP adapter. In dev mode (MSG91_AUTH_KEY missing) we just log the OTP.

export function isDevMode() {
  return !process.env.MSG91_AUTH_KEY;
}

export async function sendOtp(phone, code) {
  if (isDevMode()) {
    console.log(`[msg91:dev] OTP for ${phone} → ${code}`);
    return { ok: true, dev: true };
  }
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  const senderId = process.env.MSG91_SENDER_ID || 'CARAJX';
  // MSG91 OTP API: https://control.msg91.com/api/v5/otp
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('template_id', templateId || '');
  url.searchParams.set('mobile', '91' + phone);
  url.searchParams.set('otp', code);
  url.searchParams.set('sender', senderId);
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, response: json };
  } catch (err) {
    console.error('[msg91] send error', err.message);
    return { ok: false, error: err.message };
  }
}
