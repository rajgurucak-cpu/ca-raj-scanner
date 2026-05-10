import express from 'express';
import { authMiddleware } from '../lib/jwt.js';
import { addClient } from '../lib/sse.js';
import { getActiveSubscription } from '../../db.js';

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sub = getActiveSubscription(req.user.uid);
  const isPro = !!sub;

  res.write(`event: hello\ndata: ${JSON.stringify({ uid: req.user.uid, isPro })}\n\n`);

  const remove = addClient(req.user.uid, res, { isPro });
  const ping = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch (e) {
      // ignore
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    remove();
    try {
      res.end();
    } catch (e) {
      // ignore
    }
  });
});

export default router;
