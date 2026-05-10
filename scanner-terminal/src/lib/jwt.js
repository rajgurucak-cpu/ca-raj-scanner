import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

export function sign(payload) {
  return jwt.sign(payload, SECRET(), { algorithm: 'HS256', expiresIn: '30d' });
}

export function verify(token) {
  try {
    return jwt.verify(token, SECRET());
  } catch (e) {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  let token = m ? m[1] : null;
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const decoded = verify(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });
  req.user = decoded;
  next();
}

export function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const decoded = verify(m[1]);
    if (decoded) req.user = decoded;
  }
  next();
}
