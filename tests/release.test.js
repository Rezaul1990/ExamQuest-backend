const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { inspectStorage } = require('../src/scripts/releasePreflight');
const { Book, Chapter, QuestionPaper, ExamAttempt, ExamSubmission } = require('../src/modules/exam/exam.models');
const { User } = require('../src/modules/auth/auth.models');
const { registerSchema } = require('../src/modules/auth/auth.validation');
const { startupError } = require('../src/db/startupError');

test('startup diagnostics distinguish connection, casing and index failures without leaking raw data', () => {
  const secret = 'mongodb://private:password@host/db duplicate personal@example.test';
  for (const [error, expected] of [
    [{ code: 13297, message: secret }, 'DATABASE_NAME_CASE_MISMATCH'],
    [{ name: 'MongoServerError', message: 'db already exists with different case' }, 'DATABASE_NAME_CASE_MISMATCH'],
    [{ code: 11000, message: secret }, 'DATABASE_DUPLICATE_INDEX_VALUES'],
    [{ code: 'EXAM_STORAGE_NOT_READY', message: secret }, 'EXAM_STORAGE_NOT_READY'],
    [{ name: 'MongooseServerSelectionError', message: secret }, 'DATABASE_CONNECTION_FAILED'],
    [{ message: secret }, 'EXAM_STORAGE_INITIALIZATION_FAILED'],
  ]) {
    const output = startupError(error, 'exam storage');
    assert.ok(output.startsWith(expected));
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes('password')); assert.ok(!output.includes('@'));
  }
});

test('registration rejects missing academic identity and normalizes only supported legacy groups', () => {
  const input = { name: 'Student', email: 'student@example.test', phone: '01234567890', password: 'TestPassword123!', educationLevel: 'HSC', className: 'HSC', group: 'Science', academicYear: 2026, parent: { name: 'Parent', phone: '01234567890', relation: 'Guardian' } };
  assert.equal(registerSchema.safeParse(input).success, true);
  for (const field of ['className', 'group', 'academicYear']) {
    const missing = { ...input }; delete missing[field];
    assert.equal(registerSchema.safeParse(missing).success, false, field);
  }
  for (const group of ['', 'Other', 'ADMIN']) assert.equal(registerSchema.safeParse({ ...input, group }).success, false);
  assert.equal(registerSchema.parse({ ...input, group: 'Arts' }).group, 'Humanities');
  assert.equal(registerSchema.parse({ ...input, group: 'Commerce' }).group, 'BusinessStudies');
});

async function until(read, message) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

test('release preflight is read-only; actual server boots indexes and processes offline expiry', { timeout: 25000 }, async () => {
  const name = 'examquest_release_test_' + randomUUID().replaceAll('-', '');
  const uri = 'mongodb://127.0.0.1:27017/' + name;
  let child;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 4000 });
  try {
    const before = await mongoose.connection.db.listCollections().toArray();
    assert.equal((await inspectStorage(mongoose.connection.db)).ready, false);
    assert.deepEqual(await mongoose.connection.db.listCollections().toArray(), before);
    // Deliberate disposable conflict: report only counts, never identities or fixes.
    await ExamSubmission.collection.insertMany([{ memberUserId: 'test', dayKey: 'test' }, { memberUserId: 'test', dayKey: 'test' }]);
    assert.equal((await inspectStorage(mongoose.connection.db)).checks[0].duplicateGroups, 1);
    child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], { cwd: os.tmpdir(), env: { ...process.env, MONGODB_URI: uri, PORT: '0', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let failedOutput = ''; child.stdout.on('data', (chunk) => { failedOutput += chunk; });
    child.stderr.on('data', () => {});
    await until(() => child.exitCode !== null, 'unsafe storage startup must exit');
    assert.equal(child.exitCode, 1);
    assert.ok(!failedOutput.includes('ExamQuest API running'), 'unsafe storage must never open the HTTP listener');
    await ExamSubmission.collection.deleteMany({});
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
    assert.equal((await inspectStorage(mongoose.connection.db)).ready, true);
    const member = await User.create({ name: 'Release test', email: randomUUID() + '@example.test', passwordHash: 'unused', role: 'MEMBER', accountStatus: 'active', className: 'HSC', group: 'Science', academicYear: 2026 });
    const book = await Book.create({ title: 'Physics', subject: 'Physics', className: 'HSC', group: 'Science', createdByUserId: member._id });
    const chapter = await Chapter.create({ bookId: book._id, title: 'Vector', createdByUserId: member._id });
    const questionId = new mongoose.Types.ObjectId();
    const paper = await QuestionPaper.create({ title: 'Offline timer', bookId: book._id, chapterIds: [chapter._id], eligibleGroups: ['Science'], durationMinutes: 1, totalMarks: 1, passMark: 1, status: 'published', snapshotVersion: 1, academicContext: { className: 'HSC', subject: 'Physics', bookTitle: book.title }, questions: [{ questionId, marks: 1 }], questionSnapshots: [{ questionId, text: 'Vector?', options: ['A','B','C','D'].map((key) => ({ key, text: key })), difficulty: 'easy', marks: 1 }], answerKey: [{ questionId, correctOption: 'A' }], createdByUserId: member._id });
    const attempt = await ExamAttempt.create({ memberUserId: member._id, questionPaperId: paper._id, status: 'in_progress', startedAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000), paperSnapshotVersion: 1, total: 1, answers: [{ questionId, selectedOption: 'A' }] });
    child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], { cwd: os.tmpdir(), env: { ...process.env, MONGODB_URI: uri, PORT: '0', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', () => {});
    await until(() => output.includes('ExamQuest API running'), 'actual server must listen');
    await until(() => ExamSubmission.exists({ attemptId: attempt._id }), 'startup worker must submit without any client request');
    assert.equal((await ExamSubmission.findOne({ attemptId: attempt._id })).score, 1);
    assert.equal(await ExamSubmission.countDocuments({ memberUserId: member._id }), 1);
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise((resolve) => child.once('exit', resolve));
      child.kill(); await closed;
    }
    if (mongoose.connection.name !== name || !name.startsWith('examquest_release_test_')) throw Error('Cleanup guard failed');
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
  }
});
