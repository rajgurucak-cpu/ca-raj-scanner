import express from 'express';
import { db } from '../../db.js';
import { authMiddleware } from '../lib/jwt.js';
import { sendMessage } from '../lib/telegram.js';

const router = express.Router();

function maskToken(token) {
  if (!token) return null;
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '••••••' + token.slice(-4);
}

router.get('/config', authMiddleware, (req, res) => {
  const cfg = db.prepare('SELECT * FROM telegram_configs WHERE user_id = ?').get(req.user.uid);
  if (!cfg) return res.json({ config: null });
  let filters = [];
  try {
    filters = cfg.scanner_filters ? JSON.parse(cfg.scanner_filters) : [];
  } catch (e) {
    filters = [];
  }
  res.json({
    config: {
      bot_token_masked: maskToken(cfg.bot_token),
      has_token: !!cfg.bot_token,
      chat_id: cfg.chat_id,
      enabled: !!cfg.enabled,
      scanner_filters: filters,
    },
  });
});

router.post('/config', authMiddleware, (req, res) => {
  const { bot_token, chat_id, enabled, scanner_filters } = req.body || {};
  if (bot_token != null && typeof bot_token !== 'string') return res.status(400).json({ error: 'Invalid bot_token' });
  if (chat_id != null && typeof chat_id !== 'string' && typeof chat_id !== 'number') return res.status(400).json({ error: 'Invalid chat_id' });
  const filtersStr = JSON.stringify(Array.isArray(scanner_filters) ? scanner_filters : []);
  const enabledInt = enabled === false ? 0 : 1;
  // Preserve existing token if not provided.
  const existing = db.prepare('SELECT * FROM telegram_configs WHERE user_id = ?').get(req.user.uid);
  const finalToken = bot_token || (existing ? existing.bot_token : null);
  const finalChat = chat_id != null && chat_id !== '' ? String(chat_id) : (existing ? existing.chat_id : null);
  db.prepare(
    `INSERT INTO telegram_configs (user_id, bot_token, chat_id, enabled, scanner_filters)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET bot_token = excluded.bot_token, chat_id = excluded.chat_id, enabled = excluded.enabled, scanner_filters = excluded.scanner_filters`,
  ).run(req.user.uid, finalToken, finalChat, enabledInt, filtersStr);
  res.json({ ok: true });
});

router.post('/test', authMiddleware, async (req, res) => {
  const cfg = db.prepare('SELECT * FROM telegram_configs WHERE user_id = ?').get(req.user.uid);
  if (!cfg || !cfg.bot_token || !cfg.chat_id) {
    return res.status(400).json({ error: 'Configure bot_token and chat_id first' });
  }
  const result = await sendMessage(
    cfg.bot_token,
    cfg.chat_id,
    '✅ <b>CA RAJ Scanner Terminal</b>\nTest message — your Telegram is wired correctly.',
  );
  if (!result.ok) return res.status(502).json({ error: 'Telegram rejected the message', detail: result });
  res.json({ ok: true });
});

export default router;
