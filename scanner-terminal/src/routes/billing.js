import express from 'express';
import { db, getActiveSubscription } from '../../db.js';
import { authMiddleware } from '../lib/jwt.js';
import * as razorpay from '../lib/razorpay.js';
import { activateSubscription } from './webhook.js';

const router = express.Router();

const PLANS = ['monthly', 'yearly', 'lifetime'];

router.post('/create-order', authMiddleware, async (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  const amount = razorpay.PLAN_AMOUNTS[plan];
  let order;
  try {
    order = await razorpay.createOrder({ amount, plan, userId: req.user.uid });
  } catch (err) {
    console.error('[billing] order error', err.message);
    return res.status(502).json({ error: 'Failed to create order', detail: err.message });
  }
  db.prepare(
    `INSERT INTO payments (user_id, razorpay_order_id, amount, plan, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(req.user.uid, order.id, amount, plan, Date.now());
  res.json({
    order_id: order.id,
    amount,
    currency: 'INR',
    key_id: process.env.RAZORPAY_KEY_ID || null,
    plan,
    devMode: !!order.devMode,
  });
});

// Dev-only instant subscription activation. Disabled in production.
router.post('/dev-activate', authMiddleware, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Disabled in production' });
  }
  const { plan } = req.body || {};
  if (!PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  // Mark any pending payment for this user/plan captured for paper trail.
  const pending = db
    .prepare(`SELECT * FROM payments WHERE user_id = ? AND plan = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`)
    .get(req.user.uid, plan);
  if (pending) {
    db.prepare(`UPDATE payments SET status = 'dev-captured' WHERE id = ?`).run(pending.id);
  }
  activateSubscription(req.user.uid, plan, pending ? pending.razorpay_order_id : 'dev_order_' + Date.now(), 'dev_pay_' + Date.now());
  const sub = getActiveSubscription(req.user.uid);
  res.json({ ok: true, subscription: sub, devMode: true });
});

export default router;
