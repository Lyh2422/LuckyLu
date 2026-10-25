import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const dataDir = resolve(process.env.DATA_DIR || './data');
const db = openDatabase(resolve(dataDir, 'lulu.sqlite'));
const app = createApp({
  db,
  distDir: resolve('dist'),
  secureCookie: process.env.COOKIE_SECURE === '1',
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS || 30)),
  trustProxy: process.env.TRUST_PROXY === '1',
  signupCode: process.env.SIGNUP_CODE || ''
});

app.listen(port, host, () => {
  console.log(`Lucky Lu 已启动：http://${host}:${port}`);
});
