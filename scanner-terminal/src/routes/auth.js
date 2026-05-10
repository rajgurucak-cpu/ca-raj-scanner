import express from 'express';
import { db, getActiveSubscription } from '../../db.js';
import { sign, authMiddleware } from '../lib/jwt.js';
import * as msg91 from '../lib/msg91.js';

const router = express.Router();

const RATE_LIMIT_MS = 30_000;
const OTP_TTL_MS = 5 * 60 * 1000;

function isValidPhone(phone) {
  return typeof phone === 'string' && /^[6-9]\d{9}$/.test(phone);
}

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/send-otp', async (req, res) => {
  const { phone } = req.body || {};
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });
  }
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone);
  if (existing && existing.last_sent_at && now - existing.last_sent_at < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - existing.last_sent_at)) / 1000);
    return res.status(429).json({ error: `Wait ${wait}s before requesting another OTP` });
  }
  const code = genOtp();
  const expires = now + OTP_TTL_MS;
  db.prepare(
    `INSERT INTO otp_codes (phone, code, expires_at, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0, last_sent_at = excluded.last_sent_at`,
  ).run(phone, code, expires, now);

  const result = await msg91.sendOtp(phone, code);

  const body = { success: true };
  if (msg91.isDevMode() && process.env.NODE_ENV !== 'production') {
    body.devOtp = code;
    body.devMode = true;
  }
  if (!result.ok && !msg91.isDevMode()) {
    return res.status(502).json({ error: 'Failed to send OTP', detail: result });
  }
  res.json(body);
});

router.post('/verify-otp', (req, res) => {
  const { phone, code } = req.body || {};
  if (!isValidPhone(phone) || !/^\d{6}$/.test(String(code || ''))) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone);
  if (!row) return res.status(400).json({ error: 'Request a new OTP' });
  if (row.expires_at < Date.now()) return res.status(400).json({ error: 'OTP expired' });
  if (row.attempts >= 5) return res.status(429).json({ error: 'Too many attempts. Request a new OTP.' });
  if (row.code !== String(code)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    return res.status(400).json({ error: 'Invalid OTP' });
  }
  // Success — delete OTP, upsert user.
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const info = db.prepare('INSERT INTO users (phone, created_at, is_admin) VALUES (?, ?, 0)').run(phone, Date.now());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }
  const subscription = getActiveSubscription(user.id) || null;
  const token = sign({ uid: user.id, phone: user.phone, isAdmin: !!user.is_admin });
  res.json({
    token,
    user: { id: user.id, phone: user.phone, created_at: user.created_at, is_admin: !!user.is_admin },
    subscription,
  });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, phone, created_at, is_admin FROM users WHERE id = ?').get(req.user.uid);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const subscription = getActiveSubscription(user.id) || null;
  res.json({ user: { ...user, is_admin: !!user.is_admin }, subscription });
});

export default router;
