import express from 'express';
import { resolve } from 'node:path';
import { createAccount, getSpaceState, userContext } from './database.js';
import { hashPassword, httpError, makeToken, normalizeUsername, parseCookies, tokenHash, validateRegistration, verifyPassword } from './security.js';
import { sanitizeState } from './state.js';

const SESSION_COOKIE = 'lulu_tide_session';

export function createApp({ db, distDir = resolve('dist'), secureCookie = false, sessionDays = 30, trustProxy = false, signupCode = '' } = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb', type: 'application/json' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    next();
  });

  const attempts = new Map();
  function authRateLimit(req, _res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter(time => now - time < 15 * 60_000);
    if (recent.length >= 20) return next(httpError(429, '尝试次数过多，请稍后再试'));
    recent.push(now);
    attempts.set(key, recent);
    next();
  }

  function setSession(res, userId) {
    const token = makeToken();
    const now = new Date();
    const expires = new Date(now.getTime() + sessionDays * 86400_000);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run(tokenHash(token), userId, expires.toISOString(), now.toISOString());
    const flags = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${sessionDays * 86400}`];
    if (secureCookie) flags.push('Secure');
    res.setHeader('Set-Cookie', flags.join('; '));
  }

  function clearSession(req, res) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? '; Secure' : ''}`);
  }

  function requireAuth(req, _res, next) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next(httpError(401, '请先登录'));
    const row = db.prepare('SELECT user_id AS userId FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(token), new Date().toISOString());
    if (!row) return next(httpError(401, '登录已过期，请重新登录'));
    req.userId = row.userId;
    next();
  }

  function activeState(req) {
    const context = userContext(db, req.userId);
    if (!context?.activeSpace) throw httpError(403, '没有可访问的数据空间');
    const row = getSpaceState(db, req.userId, context.activeSpace.id);
    return { context, row };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lulu-tide', time: new Date().toISOString() }));

  app.post('/api/auth/register', authRateLimit, async (req, res, next) => {
    try {
      const input = validateRegistration(req.body || {});
      if (signupCode && tokenHash(req.body?.signupCode || '') !== tokenHash(signupCode)) throw httpError(403, '部署访问码不正确');
      const passwordHash = await hashPassword(input.password);
      let account;
      try {
        account = createAccount(db, { username: input.username, passwordHash, displayName: input.displayName });
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw httpError(409, '这个账号已经被使用');
        throw error;
      }
      setSession(res, account.userId);
      res.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', authRateLimit, async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password || '');
      const user = db.prepare('SELECT id,password_hash AS passwordHash FROM users WHERE username=?').get(username);
      if (!user || !(await verifyPassword(password, user.passwordHash))) throw httpError(401, '账号或密码不正确');
      setSession(res, user.id);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res, next) => {
    try {
      const context = userContext(db, req.userId);
      if (!context) throw httpError(401, '账号不存在');
      const { password_hash: _password, ...user } = context.user;
      res.json({ user, spaces: context.spaces, activeSpace: context.activeSpace });
    } catch (error) { next(error); }
  });

  app.get('/api/state', requireAuth, (req, res, next) => {
    try {
      const { row } = activeState(req);
      res.json({
        profile: JSON.parse(row.profileJson), logs: JSON.parse(row.logsJson), revision: row.revision,
        space: { id: row.id, name: row.name, role: row.role, canEdit: row.role === 'owner' || row.role === 'editor', updatedAt: row.updatedAt }
      });
    } catch (error) { next(error); }
  });

  app.put('/api/state', requireAuth, (req, res, next) => {
    try {
      const { row } = activeState(req);
      if (row.role !== 'owner' && row.role !== 'editor') throw httpError(403, '当前空间为只读，不能修改记录');
      const revision = Number(req.body?.revision);
      if (!Number.isInteger(revision) || revision !== row.revision) {
        return res.status(409).json({ error: '数据已在另一台设备更新，请刷新后重试', code: 'REVISION_CONFLICT' });
      }
      const clean = sanitizeState(req.body);
      const now = new Date().toISOString();
      const result = db.prepare(`UPDATE spaces SET profile_json=?,logs_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
        .run(JSON.stringify(clean.profile), JSON.stringify(clean.logs), now, row.id, revision);
      if (!result.changes) return res.status(409).json({ error: '数据已在另一台设备更新，请刷新后重试', code: 'REVISION_CONFLICT' });
      res.json({ ...clean, revision: revision + 1, updatedAt: now });
    } catch (error) { next(error); }
  });

  app.get('/api/members', requireAuth, (req, res, next) => {
    try {
      const { row } = activeState(req);
      if (row.role !== 'owner') throw httpError(403, '只有记录所有者可以查看共享成员');
      const members = db.prepare(`
        SELECT u.id,u.display_name AS displayName,u.username,m.role,m.created_at AS joinedAt
        FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.created_at
      `).all(row.id);
      res.json({ members });
    } catch (error) { next(error); }
  });

  app.post('/api/invites', requireAuth, authRateLimit, (req, res, next) => {
    try {
      const { row } = activeState(req);
      if (row.role !== 'owner') throw httpError(403, '只有记录所有者可以邀请共享');
      const role = req.body?.role === 'editor' ? 'editor' : 'viewer';
      const code = makeToken(18);
      const now = new Date();
      const expires = new Date(now.getTime() + 7 * 86400_000);
      db.prepare('DELETE FROM invites WHERE expires_at<=? OR used_at IS NOT NULL').run(now.toISOString());
      db.prepare('INSERT INTO invites(space_id,code_hash,role,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)')
        .run(row.id, tokenHash(code), role, expires.toISOString(), req.userId, now.toISOString());
      res.status(201).json({ code, role, expiresAt: expires.toISOString() });
    } catch (error) { next(error); }
  });

  app.post('/api/invites/accept', requireAuth, authRateLimit, (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim();
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      let invite;
      try {
        invite = db.prepare('SELECT * FROM invites WHERE code_hash=? AND used_at IS NULL AND expires_at>?').get(tokenHash(code), now);
        if (!invite) throw httpError(404, '邀请无效或已经过期');
        const claimed = db.prepare('UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL').run(now, invite.id);
        if (!claimed.changes) throw httpError(404, '邀请已经被使用');
        const existing = db.prepare('SELECT role FROM memberships WHERE space_id=? AND user_id=?').get(invite.space_id, req.userId);
        if (!existing) db.prepare('INSERT INTO memberships(space_id,user_id,role,created_at) VALUES(?,?,?,?)').run(invite.space_id, req.userId, invite.role, now);
        db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(invite.space_id, req.userId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/api/spaces/:id/activate', requireAuth, (req, res, next) => {
    try {
      const spaceId = Number(req.params.id);
      const membership = db.prepare('SELECT 1 FROM memberships WHERE space_id=? AND user_id=?').get(spaceId, req.userId);
      if (!membership) throw httpError(404, '找不到这个数据空间');
      db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, req.userId);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.delete('/api/members/:id', requireAuth, (req, res, next) => {
    try {
      const { row } = activeState(req);
      if (row.role !== 'owner') throw httpError(403, '只有记录所有者可以移除成员');
      const memberId = Number(req.params.id);
      if (memberId === req.userId) throw httpError(400, '不能移除记录所有者');
      db.prepare('DELETE FROM memberships WHERE space_id=? AND user_id=? AND role<>?').run(row.id, memberId, 'owner');
      const fallback = db.prepare('SELECT space_id AS spaceId FROM memberships WHERE user_id=? ORDER BY created_at LIMIT 1').get(memberId);
      db.prepare('UPDATE users SET active_space_id=? WHERE id=? AND active_space_id=?').run(fallback?.spaceId || null, memberId, row.id);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.use(express.static(distDir, { etag: true, maxAge: '1h', setHeaders(res, file) {
    if (file.endsWith('index.html') || file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }}));

  app.use('/api', (_req, _res, next) => next(httpError(404, '接口不存在')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(distDir, 'index.html')));
  app.use((error, _req, res, _next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? '服务器暂时出错，请稍后再试' : error.message });
  });
  return app;
}
