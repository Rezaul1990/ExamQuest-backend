const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { User, AuthSession } = require('../src/modules/auth/auth.models');
const { hashPassword, verifyPassword } = require('../src/modules/auth/auth.crypto');
const { issueAccessToken } = require('../src/modules/auth/auth.tokens');

test('profile and password security for all roles on disposable MongoDB', async (t) => {
  const dbName = 'examquest_profile_test_' + randomUUID().replaceAll('-', '');
  await mongoose.connect('mongodb://127.0.0.1:27017/' + dbName);
  let server;
  try {
    const app = require('../src/app');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/v1/auth';
    const request = async (path, token, body) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, ...await response.json() };
    };
    const tokenFor = async (user) => {
      const session = await AuthSession.create({ userId: user._id, sessionId: randomUUID(), tokenFamilyId: randomUUID(), refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
      return issueAccessToken(user, session);
    };
    assert.equal((await request('/me')).status, 401);
    for (const role of ['MEMBER', 'STAFF', 'ADMIN']) await t.test(role + ': own safe profile, password validation and all-session revocation', async () => {
      const user = await User.create({ name: role + ' Test', email: role.toLowerCase() + '@example.test', role, accountStatus: 'active', passwordHash: await hashPassword('TestPassword123!'), forcePasswordChange: true, ...(role === 'MEMBER' ? { className: 'HSC', group: 'Science', academicYear: 2026, parent: { name: 'Test Guardian', phone: '01700000000', relation: 'Guardian' } } : {}) });
      const first = await tokenFor(user), second = await tokenFor(user);
      const profile = await request('/me', first);
      assert.equal(profile.data.user.id, String(user._id));
      assert.equal(profile.data.user.role, role);
      assert.ok(!('passwordHash' in profile.data.user));
      assert.equal((await request('/change-password', first, { currentPassword: 'TestPassword123!', newPassword: 'short' })).status, 422);
      assert.equal((await request('/change-password', first, { currentPassword: 'WrongPassword123!', newPassword: 'UpdatedPassword456!' })).error, 'INVALID_CURRENT_PASSWORD');
      assert.equal((await request('/me', second)).status, 200);
      assert.equal((await request('/change-password', first, { currentPassword: 'TestPassword123!', newPassword: 'UpdatedPassword456!' })).status, 200);
      assert.equal((await request('/me', first)).status, 401);
      assert.equal((await request('/me', second)).status, 401);
      const updated = await User.findById(user._id).select('+passwordHash');
      assert.equal(updated.forcePasswordChange, false);
      assert.equal(await verifyPassword(updated.passwordHash, 'UpdatedPassword456!'), true);
      assert.equal(await verifyPassword(updated.passwordHash, 'TestPassword123!'), false);
      const next = await tokenFor(updated), other = await tokenFor(updated);
      assert.equal((await request('/logout-all', next, {})).status, 200);
      assert.equal((await request('/me', other)).status, 401);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.name !== dbName || !dbName.startsWith('examquest_profile_test_')) throw Error('Cleanup guard failed');
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
  }
});
