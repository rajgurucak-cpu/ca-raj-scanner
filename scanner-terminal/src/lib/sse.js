// In-memory SSE bus. Per-user channels indexed by uid.
// For a single-process Node app this is fine. Replace with Redis pub/sub when scaling.

const clients = new Map(); // uid -> Set of res objects with metadata

export function addClient(uid, res, meta = {}) {
  if (!clients.has(uid)) clients.set(uid, new Set());
  const entry = { res, meta };
  clients.get(uid).add(entry);
  return () => {
    const set = clients.get(uid);
    if (set) {
      set.delete(entry);
      if (set.size === 0) clients.delete(uid);
    }
  };
}

export function broadcast(filterFn, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [uid, set] of clients.entries()) {
    for (const entry of set) {
      try {
        if (filterFn(entry.meta, uid)) entry.res.write(payload);
      } catch (e) {
        // ignore broken pipe etc.
      }
    }
  }
}

export function publishAlert(scanner, alert) {
  broadcast(
    (meta) => {
      // meta: { isPro }
      // Pro scanners only go to pro users; free scanners go to everyone.
      if (scanner.tier === 'pro' && !meta.isPro) return false;
      return true;
    },
    'alert',
    { scanner_id: scanner.id, ...alert },
  );
}

export function clientCount() {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}
