import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PROFILE } from './state.js';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      active_space_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      logs_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(space_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
  `);
  return db;
}

export function createAccount(db, { username, passwordHash, displayName }) {
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const userResult = db.prepare('INSERT INTO users(username,password_hash,display_name,created_at) VALUES(?,?,?,?)').run(username, passwordHash, displayName, now);
    const userId = Number(userResult.lastInsertRowid);
    const spaceResult = db.prepare('INSERT INTO spaces(owner_user_id,name,profile_json,logs_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(userId, `${displayName}的周期`, JSON.stringify({ ...DEFAULT_PROFILE, nickname: displayName }), '{}', now, now);
    const spaceId = Number(spaceResult.lastInsertRowid);
    db.prepare('INSERT INTO memberships(space_id,user_id,role,created_at) VALUES(?,?,?,?)').run(spaceId, userId, 'owner', now);
    db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
    db.exec('COMMIT');
    return { userId, spaceId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function userContext(db, userId) {
  const user = db.prepare('SELECT id,username,display_name AS displayName,active_space_id AS activeSpaceId FROM users WHERE id=?').get(userId);
  if (!user) return null;
  const spaces = db.prepare(`
    SELECT s.id,s.name,s.owner_user_id AS ownerUserId,m.role,s.updated_at AS updatedAt
    FROM memberships m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=? ORDER BY s.created_at
  `).all(userId).map(row => ({ ...row, canEdit: row.role === 'owner' || row.role === 'editor' }));
  if (!spaces.some(space => space.id === user.activeSpaceId) && spaces[0]) {
    user.activeSpaceId = spaces[0].id;
    db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(user.activeSpaceId, userId);
  }
  const activeSpace = spaces.find(space => space.id === user.activeSpaceId) || null;
  return { user, spaces, activeSpace };
}

export function getSpaceState(db, userId, spaceId) {
  return db.prepare(`
    SELECT s.id,s.name,s.revision,s.profile_json AS profileJson,s.logs_json AS logsJson,m.role,
           s.owner_user_id AS ownerUserId,s.updated_at AS updatedAt
    FROM memberships m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=? AND s.id=?
  `).get(userId, spaceId);
}
