const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { User, AuthSession, SecurityToken, StaffInvite } = require('../src/modules/auth/auth.models');
const { hashPassword, verifyPassword, hashToken } = require('../src/modules/auth/auth.crypto');
const { issueAccessToken } = require('../src/modules/auth/auth.tokens');

test('profile and password security for all roles on disposable MongoDB', async (t) => {
  const dbName = 'examquest_profile_test_' + randomUUID().replaceAll('-', '');
  await mongoose.connect('mongodb://127.0.0.1:27017/' + dbName);
  let server;
  try {
    // No test request may send real mail, even if the host has SMTP configured.
    const mailer = require('../src/modules/auth/auth.mailer');
    const originalSend = mailer.sendMail;
    mailer.sendMail = async () => {};
    const app = require('../src/app');
    mailer.sendMail = originalSend;
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
    await t.test('registration SSC/HSC/group/year contract canonicalizes new users and preserves older records', async () => {
      const legacy = await User.create({ name: 'Older Member', email: 'legacy-register@example.test', passwordHash: await hashPassword('LegacyPassword123!'), role: 'MEMBER', accountStatus: 'active', className: ' hsc ', group: 'Science', academicYear: 2001 });
      const before = JSON.stringify(await User.findById(legacy._id).lean());
      const body = { name: 'Student Test', email: 'register@example.test', phone: '01700000000', password: 'RegisterPassword123!', confirmPassword: 'RegisterPassword123!', educationLevel: 'SSC', className: 'SSC', group: 'Science', academicYear: 2026, parent: { name: 'Guardian Test', phone: '01700000001', email: '', relation: 'Guardian' } };
      let i = 0;
      for (const level of ['SSC', 'HSC']) for (const [alias, canonical] of [['Science', 'Science'], ['Arts', 'Humanities'], ['Commerce', 'BusinessStudies']]) {
        const email = `registration-${i}@example.test`, year = i === 0 ? 2000 : i === 5 ? 2100 : '2026'; i++;
        const created = await request('/register', null, { ...body, email: email.toUpperCase(), educationLevel: ` ${level.toLowerCase()} `, className: ` ${level.toLowerCase()} `, group: alias, academicYear: year });
        assert.equal(created.status, 201); assert.equal(created.data.user.role, 'MEMBER'); assert.equal(created.data.user.educationLevel, level);
        assert.equal(created.data.user.className, level); assert.equal(created.data.user.group, canonical); assert.equal(created.data.user.academicYear, Number(year));
        assert.equal(created.data.user.email, email); assert.equal(created.data.user.emailVerified, true); assert.equal(created.data.user.accountStatus, 'active');
        assert.equal(created.data.user.passwordHash, undefined);
        const persisted = await User.findOne({ email }); assert.equal(persisted.group, canonical);
      }
      const custom = await request('/register', null, { ...body, email: 'custom-register@example.test', className: ' Class 10 ' });
      assert.equal(custom.status, 201); assert.equal(custom.data.user.className, 'Class 10');
      assert.equal((await request('/register', null, { ...body, email: 'custom-register@example.test' })).error, 'EMAIL_ALREADY_REGISTERED');
      for (const patch of [{ educationLevel: 'BSC' }, { educationLevel: 'HSC', className: 'SSC' }, { group: 'Unknown' }, { group: '' }, { academicYear: 1999 }, { academicYear: 2101 }, { academicYear: 2026.5 }, { academicYear: '2e3' }, { academicYear: [2026] }, { academicYear: '' }, { academicYear: null }, { parent: { ...body.parent, name: '' } }, { parent: { ...body.parent, relation: 'Uncle' } }, { confirmPassword: 'MismatchPassword123!' }, { role: 'ADMIN' }]) {
        const response = await request('/register', null, { ...body, ...patch }); assert.equal(response.status, 422); assert.equal(response.error, 'VALIDATION_ERROR');
      }
      assert.equal(await User.countDocuments({ email: body.email }), 0);
      assert.equal(JSON.stringify(await User.findById(legacy._id).lean()), before);
    });
    await t.test('login privacy, recovery, expired/used token and invite activation retain public auth contracts', async () => {
      const email = 'member@example.test';
      const bad = await request('/login', null, { email, password: 'WrongPassword123!' });
      const missing = await request('/login', null, { email: 'missing@example.test', password: 'WrongPassword123!' });
      assert.deepEqual(bad, missing); assert.equal(bad.error, 'INVALID_CREDENTIALS');
      const logged = await request('/login', null, { email, password: 'UpdatedPassword456!' });
      assert.equal(logged.status, 200); assert.ok(logged.data.accessToken); assert.ok(!logged.data.user.passwordHash);
      const known = await request('/forgot-password', null, { email });
      const unknown = await request('/forgot-password', null, { email: 'missing@example.test' });
      assert.deepEqual(known, unknown); assert.equal(known.status, 200); assert.ok(!JSON.stringify(known).includes('token'));
      assert.equal((await request('/forgot-password', null, { email: 'invalid' })).status, 422);
      const member = await User.findOne({ email });
      const token = 'test-only-reset-token-' + randomUUID();
      await SecurityToken.create({ userId: member._id, purpose: 'password_reset', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000) });
      assert.equal((await request('/reset-password', null, { token, password: 'short' })).status, 422);
      assert.equal((await request('/reset-password', null, { token, password: 'RecoveredPassword789!' })).status, 200);
      assert.equal((await request('/me', logged.data.accessToken)).status, 401);
      assert.equal((await request('/reset-password', null, { token, password: 'RecoveredPassword789!' })).error, 'INVALID_OR_EXPIRED_TOKEN');
      assert.equal((await request('/login', null, { email, password: 'RecoveredPassword789!' })).status, 200);
      const expired = 'test-only-expired-token-' + randomUUID();
      await SecurityToken.create({ userId: member._id, purpose: 'password_reset', tokenHash: hashToken(expired), expiresAt: new Date(Date.now() - 1000) });
      assert.equal((await request('/reset-password', null, { token: expired, password: 'RecoveredPassword789!' })).error, 'INVALID_OR_EXPIRED_TOKEN');
      assert.equal((await request('/verify-email', null, { token: expired })).error, 'INVALID_OR_EXPIRED_TOKEN');
      const verification = 'test-only-verification-' + randomUUID();
      await SecurityToken.create({ userId: member._id, purpose: 'email_verification', tokenHash: hashToken(verification), expiresAt: new Date(Date.now() + 60000) });
      const verified = await request('/verify-email', null, { token: verification });
      assert.equal(verified.status, 200); assert.equal(verified.data.user.emailVerified, true); assert.equal(verified.data.accessToken, undefined);
      const staff = await User.create({ name: 'Invited Staff', email: 'invited@example.test', role: 'STAFF', accountStatus: 'invited', passwordHash: await hashPassword('TemporaryPassword123!') });
      const invite = 'test-only-invitation-' + randomUUID();
      await StaffInvite.create({ staffUserId: staff._id, name: staff.name, email: staff.email, invitedByUserId: (await User.findOne({ role: 'ADMIN' }))._id, tokenHash: hashToken(invite), expiresAt: new Date(Date.now() + 60000) });
      assert.equal((await request('/staff-invite/accept', null, { token: 'x'.repeat(32), password: 'AcceptedPassword123!' })).error, 'INVALID_OR_EXPIRED_INVITE');
      const accepted = await request('/staff-invite/accept', null, { token: invite, password: 'AcceptedPassword123!' });
      assert.equal(accepted.status, 200); assert.equal(accepted.data.user.accountStatus, 'active'); assert.equal(accepted.data.accessToken, undefined);
      assert.equal((await request('/staff-invite/accept', null, { token: invite, password: 'AcceptedPassword123!' })).error, 'INVALID_OR_EXPIRED_INVITE');
      assert.equal((await request('/login', null, { email: staff.email, password: 'AcceptedPassword123!' })).status, 200);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.name !== dbName || !dbName.startsWith('examquest_profile_test_')) throw Error('Cleanup guard failed');
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
  }
});

test('mailer never logs recipient/body/token and sanitizes SMTP failures', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const logs = [], sent = [];
  const build = (smtp, fail = false) => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'console', fs.readFileSync(path.join(__dirname, '../src/modules/auth/auth.mailer.js'), 'utf8'))((name) => {
      if (name === '../../config/env') return { appDeepLinkScheme: 'examquest', smtp };
      if (name === 'nodemailer') return { createTransport: () => ({ sendMail: async (message) => { if (fail) throw Error('private SMTP token'); sent.push(message); } }) };
      throw Error('Unexpected dependency');
    }, module, module.exports, { warn: (...args) => logs.push(args.join(' ')), log: (...args) => logs.push(args.join(' ')) });
    return module.exports;
  };
  const message = { to: 'private@example.test', subject: 'Private subject', text: 'examquest://reset-password?token=private-token' };
  await build({}).sendMail(message);
  assert.equal(logs.length, 1); assert.ok(!logs.join().includes('private')); assert.ok(!logs.join().includes(message.subject));
  await build({ host: 'test', user: 'test', pass: 'test' }).sendMail(message); assert.equal(sent[0].text, message.text);
  await assert.rejects(build({ host: 'test', user: 'test', pass: 'test' }, true).sendMail(message), (error) => error.code === 'MAIL_DELIVERY_FAILED' && error.statusCode === 503 && !error.message.includes('private'));
});

test('recovery SMTP failure returns same generic result without logging mail details', async () => {
  const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
  const file = path.join(__dirname, '../src/modules/auth/auth.service.js'), localRequire = createRequire(file);
  const logs = []; let exists = true;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', fs.readFileSync(file, 'utf8'))((name) => {
    if (name === './auth.models') return { User: { findOne: async () => exists ? { _id: 'fixture', email: 'private@example.test' } : null }, SecurityToken: { create: async () => {} } };
    if (name === './auth.mailer') return { buildLink: () => 'private-link', sendMail: async () => { const error = Error('private SMTP failure'); error.code = 'MAIL_DELIVERY_FAILED'; throw error; } };
    return localRequire(name);
  }, module, module.exports, { warn: (value) => logs.push(value) });
  const known = await module.exports.forgotPassword('private@example.test'); exists = false;
  assert.equal(await module.exports.forgotPassword('missing@example.test'), known);
  assert.equal(logs.length, 1); assert.ok(!logs.join().includes('private'));
});
