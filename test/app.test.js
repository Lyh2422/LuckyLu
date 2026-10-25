import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

let server;
let baseUrl;
const db = openDatabase(':memory:');

before(async () => {
  const app = createApp({ db, secureCookie: false });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
});

function client() {
  let cookie = '';
  return async (path, options = {}) => {
    const response = await fetch(baseUrl + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) }
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };
}

test('账号、同步、邀请和权限形成完整闭环', async () => {
  const owner = client();
  const viewer = client();

  let result = await owner('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'owner_01', password: 'a-secure-password', displayName: '潞潞' }) });
  assert.equal(result.response.status, 201);

  result = await owner('/api/state');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.space.role, 'owner');
  assert.equal(result.body.revision, 0);

  const nextState = {
    revision: 0,
    profile: { nickname: '潞潞', cycleLength: 29, periodLength: 5, reminder: true, reminderDays: 4 },
    logs: { '2026-10-19': { period: true, flow: '中等', painLevel: 2, symptoms: ['痛经', '水肿'], mood: '平静', sleep: '不错', note: '早点休息' } }
  };
  result = await owner('/api/state', { method: 'PUT', body: JSON.stringify(nextState) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.revision, 1);
  assert.equal(result.body.logs['2026-10-19'].painLevel, 2);
  assert.equal(result.body.profile.reminderDays, 4);

  const stale = await owner('/api/state', { method: 'PUT', body: JSON.stringify(nextState) });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'REVISION_CONFLICT');

  result = await owner('/api/invites', { method: 'POST', body: JSON.stringify({ role: 'viewer' }) });
  assert.equal(result.response.status, 201);
  const inviteCode = result.body.code;

  result = await viewer('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'viewer_01', password: 'another-secure-password', displayName: '陪伴者' }) });
  assert.equal(result.response.status, 201);
  result = await viewer('/api/invites/accept', { method: 'POST', body: JSON.stringify({ code: inviteCode }) });
  assert.equal(result.response.status, 200);

  result = await viewer('/api/state');
  assert.equal(result.body.space.role, 'viewer');
  assert.equal(result.body.logs['2026-10-19'].note, '早点休息');
  assert.equal(result.body.logs['2026-10-19'].sleep, '不错');

  result = await viewer('/api/state', { method: 'PUT', body: JSON.stringify({ ...nextState, revision: 1 }) });
  assert.equal(result.response.status, 403);
});

test('输入验证拒绝弱密码和非法健康记录', async () => {
  const visitor = client();
  let result = await visitor('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'weak_user', password: '123', displayName: '测试' }) });
  assert.equal(result.response.status, 400);

  await visitor('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'safe_user', password: 'long-enough-password', displayName: '测试' }) });
  result = await visitor('/api/state', { method: 'PUT', body: JSON.stringify({ revision: 0, profile: {}, logs: { tomorrow: { note: 'bad' } } }) });
  assert.equal(result.response.status, 400);
});
