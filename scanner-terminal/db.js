import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'scanner.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      created_at INTEGER,
      is_admin INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS otp_codes (
      phone TEXT PRIMARY KEY,
      code TEXT,
      expires_at INTEGER,
      attempts INTEGER DEFAULT 0,
      last_sent_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      plan TEXT,
      status TEXT,
      started_at INTEGER,
      expires_at INTEGER,
      razorpay_payment_id TEXT,
      razorpay_order_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id, status);
    CREATE TABLE IF NOT EXISTS scanners (
      id TEXT PRIMARY KEY,
      name TEXT,
      url TEXT,
      tier TEXT,
      cat TEXT,
      bias TEXT,
      descr TEXT,
      live INTEGER DEFAULT 0,
      webhook_secret TEXT,
      created_at INTEGER,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS scan_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanner_id TEXT,
      symbol TEXT,
      trigger_price REAL,
      triggered_at INTEGER,
      raw_payload TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_scanner_time ON scan_alerts(scanner_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS telegram_configs (
      user_id INTEGER PRIMARY KEY,
      bot_token TEXT,
      chat_id TEXT,
      enabled INTEGER DEFAULT 1,
      scanner_filters TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      amount INTEGER,
      plan TEXT,
      status TEXT,
      created_at INTEGER
    );
  `);
}

export function getActiveSubscription(userId) {
  const now = Date.now();
  return db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ? AND status = 'active'
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, now);
}
