import express from 'express';
import { db } from '../../db.js';
import { publishAlert } from '../lib/sse.js';
import { sendMessage, formatAlert } from '../lib/telegram.js';
import { verifyWebhookSignature } from '../lib/razorpay.js';

const router = express.Router();

// CHARTINK WEBHOOK
// Accepts both query secret and JSON body forms.
router.post('/chartink/:scannerId', express.json({ limit: '256kb' }), async (req, res) => {
  const { scannerId } = req.params;
  const secret = req.query.secret;
  const scanner = db.prepare('SELECT * FROM scanners WHERE id = ?').get(scannerId);
  if (!scanner) return res.status(404).json({ error: 'Scanner not found' });
  if (!secret || secret !== scanner.webhook_secret) {
    return res.status(401).json({ error: 'Bad secret' });
  }
  const body = req.body || {};
  const stocks = String(body.stocks || '').split(',').map((s) => s.trim()).filter(Boolean);
  const prices = String(body.trigger_prices || '').split(',').map((s) => parseFloat(s.trim()));
  const triggeredAtRaw = body.triggered_at || '';
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO scan_alerts (scanner_id, symbol, trigger_price, triggered_at, raw_payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const raw = JSON.stringify(body);
  const inserted = [];
  const tx = db.transaction(() => {
    stocks.forEach((symbol, i) => {
      const price = Number.isFinite(prices[i]) ? prices[i] : null;
      const info = insert.run(scanner.id, symbol, price, parseTriggeredAt(triggeredAtRaw), raw, now);
      inserted.push({ id: info.lastInsertRowid, symbol, trigger_price: price, triggered_at: now, scanner_id: scanner.id });
    });
  });
  tx();

  // Broadcast each alert via SSE.
  for (const a of inserted) publishAlert(scanner, a);

  // Forward to Telegram configs.
  forwardToTelegram(scanner, inserted).catch((e) => console.error('[telegram] forward error', e.message));

  res.json({ ok: true, count: inserted.length });
});

function parseTriggeredAt(s) {
  // Chartink sends e.g. "2:34 pm" — interpret in IST as today.
  if (!s) return Date.now();
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return Date.now();
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  const now = new Date();
  // Build IST today at hh:mm.
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000);
  ist.setUTCHours(hh, mm, 0, 0);
  // Convert back to absolute ms.
  return ist.getTime() - (5.5 * 60 - now.getTimezoneOffset()) * 60_000;
}

async function forwardToTelegram(scanner, alerts) {
  const configs = db
    .prepare(
      `SELECT tc.*, u.id as uid FROM telegram_configs tc JOIN users u ON u.id = tc.user_id WHERE tc.enabled = 1 AND tc.bot_token IS NOT NULL AND tc.chat_id IS NOT NULL`,
    )
    .all();
  if (!configs.length) return;
  for (const cfg of configs) {
    let filters = [];
    try {
      filters = cfg.scanner_filters ? JSON.parse(cfg.scanner_filters) : [];
    } catch (e) {
      filters = [];
    }
    if (Array.isArray(filters) && filters.length && !filters.includes(scanner.id)) continue;
    // Free users only get free-tier scanners.
    const sub = db
      .prepare(
        `SELECT 1 FROM subscriptions WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(cfg.user_id, Date.now());
    if (scanner.tier === 'pro' && !sub) continue;
    for (const alert of alerts) {
      sendMessage(cfg.bot_token, cfg.chat_id, formatAlert(scanner, alert)).catch(() => {});
    }
  }
}

// RAZORPAY WEBHOOK — needs raw body for HMAC verification.
router.post('/razorpay', express.raw({ type: '*/*', limit: '512kb' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.body; // Buffer
  const rawStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[razorpay] webhook hit but no secret configured');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  if (!verifyWebhookSignature(rawStr, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let event;
  try {
    event = JSON.parse(rawStr);
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const payment = event?.payload?.payment?.entity || {};
    const orderId = payment.order_id || event?.payload?.order?.entity?.id;
    const paymentId = payment.id;
    const pay = db.prepare('SELECT * FROM payments WHERE razorpay_order_id = ?').get(orderId);
    if (pay) {
      db.prepare('UPDATE payments SET status = ?, razorpay_payment_id = ? WHERE id = ?').run('captured', paymentId, pay.id);
      activateSubscription(pay.user_id, pay.plan, orderId, paymentId);
    }
  }
  res.json({ ok: true });
});

export function activateSubscription(userId, plan, orderId, paymentId) {
  const now = Date.now();
  let expires = null;
  if (plan === 'monthly') expires = now + 30 * 24 * 60 * 60 * 1000;
  else if (plan === 'yearly') expires = now + 365 * 24 * 60 * 60 * 1000;
  else if (plan === 'lifetime') expires = null;
  // Mark previous active subs as superseded.
  db.prepare(`UPDATE subscriptions SET status = 'superseded' WHERE user_id = ? AND status = 'active'`).run(userId);
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, expires_at, razorpay_order_id, razorpay_payment_id)
     VALUES (?, ?, 'active', ?, ?, ?, ?)`,
  ).run(userId, plan, now, expires, orderId || null, paymentId || null);
}

export default router;
