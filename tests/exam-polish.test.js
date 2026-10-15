const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { Book, Chapter, Question, QuestionPaper, ExamAttempt, ExamSubmission } = require('../src/modules/exam/exam.models');
const { User, AuthSession } = require('../src/modules/auth/auth.models');
const { issueAccessToken } = require('../src/modules/auth/auth.tokens');
const service = require('../src/modules/exam/exam.service');
const { createPresentation, presentQuestions } = require('../src/modules/exam/exam.presentation');

test('Phase 5 bank management, analytics and persisted exam presentation', async (t) => {
  const dbName = 'examquest_polish_test_' + randomUUID().replaceAll('-', '');
  await mongoose.connect('mongodb://127.0.0.1:27017/' + dbName, { serverSelectionTimeoutMS: 4000 });
  let server;
  try {
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    async function identity(role, extra = {}) {
      const user = await User.create({ name: 'Polish Test', email: randomUUID() + '@example.test', passwordHash: 'unused', role, accountStatus: 'active', className: 'HSC', group: 'Science', academicYear: 2026, ...extra });
      const session = await AuthSession.create({ userId: user._id, sessionId: randomUUID(), tokenFamilyId: randomUUID(), refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600000) });
      return { user, token: issueAccessToken(user, session) };
    }
    const admin = await identity('ADMIN'), member = await identity('MEMBER');
    const book = await Book.create({ title: 'Physics', subject: 'Physics', className: 'HSC', group: 'Science', createdByUserId: admin.user._id });
    const chapter = await Chapter.create({ title: 'Vectors', bookId: book._id, createdByUserId: admin.user._id });
    const other = await Book.create({ title: 'Biology', subject: 'Biology', className: 'HSC', group: 'Science', createdByUserId: admin.user._id });
    const staff = await identity('STAFF', { permissions: ['QUESTION_MANAGE', 'CONTENT_READ', 'RESULTS_VIEW_ALL'], bookIds: [book._id] });
    const payload = (text, extra = {}) => ({ bookId: String(book._id), chapterId: String(chapter._id), text, optionA: 'Force', optionB: 'Mass', optionC: 'Time', optionD: 'Temperature', correctOption: 'A', difficulty: 'easy', ...extra });
    const q1 = (await service.createQuestion(payload('Vector (quantity)?'), admin.user._id)).question;
    const q2 = (await service.createQuestion(payload('Scalar quantity?', { difficulty: 'hard' }), admin.user._id)).question;
    await Question.updateMany({}, { $set: { reviewStatus: 'approved' } });
    const paper = await QuestionPaper.create({ title: 'Frozen polish paper', bookId: book._id, chapterIds: [chapter._id], eligibleGroups: ['Science'], durationMinutes: 20, totalMarks: 2, passMark: 1, status: 'published', snapshotVersion: 1, academicContext: { className: 'HSC', subject: 'Physics', bookTitle: 'Physics' }, questions: [q1, q2].map((q) => ({ questionId: q.id, marks: 1 })), questionSnapshots: [q1, q2].map((q) => ({ questionId: q.id, text: q.text, options: q.options, difficulty: q.difficulty, marks: 1 })), answerKey: [q1, q2].map((q) => ({ questionId: q.id, correctOption: 'A', explanation: 'PRIVATE' })), createdByUserId: admin.user._id });
    server = require('../src/app').listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/v1/exams';
    async function request(route, who = admin, body, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, ...await response.json() };
    }
    await t.test('literal search, dependent filters, review/status, bounded pagination and staff scope', async () => {
      const literal = await request('/admin/questions?bookId=' + book._id + '&q=' + encodeURIComponent('(quantity)?'));
      assert.equal(literal.data.questions.length, 1); assert.equal(literal.data.questions[0].paperCount, 1);
      const filtered = await request('/admin/questions?difficulty=hard&reviewStatus=approved&status=active&limit=1&page=1', staff);
      assert.equal(filtered.data.questions[0].id, q2.id);
      assert.equal((await request('/admin/questions?limit=1&page=2', staff)).data.questions.length, 1);
      assert.equal((await request('/admin/questions?bookId=' + other._id, staff)).status, 403);
      assert.equal((await request('/admin/questions?difficulty=invalid')).status, 400);
      assert.equal((await request('/admin/questions?limit=999999')).status, 400);
      assert.equal((await request('/admin/questions', member)).status, 403);
    });
    let active;
    await t.test('question/option permutations persist across save, resume, repeated start; no early keys', async () => {
      const result = await request('/question-papers/' + paper._id + '/start', member, {});
      assert.equal(result.status, 201, JSON.stringify(result)); active = result.data.attempt;
      const stored = await ExamAttempt.findById(active.id);
      assert.equal(stored.presentation.length, 2);
      assert.deepEqual(active.questions.map((q) => q.id).sort(), [q1.id, q2.id].sort());
      active.questions.forEach((q) => { assert.deepEqual(q.options.map((o) => o.key).sort(), ['A', 'B', 'C', 'D']); assert.deepEqual(q.options.map((o) => o.label), ['A', 'B', 'C', 'D']); });
      assert.ok(!JSON.stringify(active).includes('PRIVATE')); assert.ok(!JSON.stringify(active).includes('correctOption'));
      const answers = [{ questionId: q1.id, selectedOption: 'A' }];
      assert.equal((await request('/attempts/' + active.id + '/answers', member, { answers, revision: 0 }, 'PUT')).status, 200);
      const resumed = (await request('/attempts/' + active.id, member)).data.attempt;
      assert.deepEqual(resumed.questions, active.questions); assert.equal(resumed.answers[0].selectedOption, 'A');
      assert.equal((await request('/attempts/' + active.id + '/answers', member, { answers: [], revision: 0 }, 'PUT')).status, 409);
      assert.deepEqual((await request('/question-papers/' + paper._id + '/start', member, {})).data.attempt.questions, active.questions);
      assert.equal((await request('/status', member)).data.used, 0);
    });
    await t.test('legacy attempts preserve original question and option order without backfill', async () => {
      const legacy = await identity('MEMBER');
      const attempt = await ExamAttempt.create({ memberUserId: legacy.user._id, questionPaperId: paper._id, total: 2, expiresAt: new Date(Date.now() + 600000) });
      const resumed = (await request('/attempts/' + attempt._id, legacy)).data.attempt;
      assert.deepEqual(resumed.questions.map((q) => q.id), [q1.id, q2.id]);
      assert.deepEqual(resumed.questions[0].options.map((o) => o.key), ['A', 'B', 'C', 'D']);
      assert.equal((await ExamAttempt.findById(attempt._id)).presentation, undefined);
    });
    await t.test('editing resets review with revision conflict protection and leaves published snapshots intact', async () => {
      const before = (await request('/admin/questions?bookId=' + book._id)).data.questions.find((q) => q.id === q1.id);
      const update = { text: 'Edited bank question', correctOption: 'D', difficulty: 'hard', status: 'inactive', revision: before.revision };
      const edited = await request('/admin/questions/' + q1.id, staff, update, 'PATCH');
      assert.equal(edited.status, 200, JSON.stringify(edited)); assert.equal(edited.data.question.reviewStatus, 'draft');
      assert.equal((await request('/admin/questions/' + q1.id, staff, update, 'PATCH')).status, 409);
      const snapshot = await QuestionPaper.findById(paper._id).select('+answerKey');
      assert.equal(snapshot.questionSnapshots[0].text, 'Vector (quantity)?'); assert.equal(snapshot.answerKey[0].correctOption, 'A');
      const reviewed = await request('/admin/questions/' + q1.id + '/review', staff, { reviewStatus: 'reviewed', revision: edited.data.question.revision });
      assert.equal(reviewed.status, 200);
      assert.equal((await request('/admin/questions/' + q1.id + '/review', staff, { reviewStatus: 'approved', revision: reviewed.data.question.revision })).status, 200);
    });
    await t.test('canonical option identities grade correctly after shuffle and future bank edit', async () => {
      const result = await request('/attempts/' + active.id + '/submit', member, { answers: [{ questionId: q1.id, selectedOption: 'A' }] });
      assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.attempt.score, 1);
      assert.equal((await request('/status', member)).data.used, 1);
      assert.equal((await request('/question-papers?bookId=' + book._id, member)).data.questionPapers.length, 0);
    });
    await t.test('admin analytics deduplicates accepted/projected results, includes unanswered and legacy, exposes no member data', async () => {
      const legacy = await identity('MEMBER');
      await ExamAttempt.create({ memberUserId: legacy.user._id, questionPaperId: paper._id, total: 2, status: 'submitted', submittedAt: new Date(), answers: [{ questionId: q1.id, selectedOption: 'B', correctOption: 'A', isCorrect: false }, { questionId: q2.id, selectedOption: 'A', correctOption: 'A', isCorrect: true }] });
      const response = await request('/admin/question-analytics?bookId=' + book._id);
      assert.equal(response.status, 200, JSON.stringify(response));
      const first = response.data.analytics.find((q) => q.questionId === q1.id), second = response.data.analytics.find((q) => q.questionId === q2.id);
      assert.equal(first.submissions, 2); assert.equal(first.correct, 1); assert.equal(first.correctnessPercent, 50);
      assert.equal(second.submissions, 2); assert.equal(second.answered, 1); assert.equal(second.correct, 1);
      assert.ok(!JSON.stringify(response.data).includes(String(member.user._id))); assert.ok(!JSON.stringify(response.data).includes('answers'));
      assert.equal((await request('/admin/question-analytics', staff)).status, 403);
      assert.equal((await request('/admin/question-analytics', member)).status, 403);
      assert.equal(await ExamSubmission.countDocuments({}), 1);
    });
    await t.test('presentation helper always retains every canonical question and option exactly once', () => {
      for (let i = 0; i < 50; i++) {
        const layout = createPresentation(paper), questions = presentQuestions(paper, { presentation: layout });
        assert.equal(new Set(questions.map((q) => q.id)).size, 2);
        questions.forEach((q) => assert.equal(new Set(q.options.map((o) => o.key)).size, 4));
      }
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.name !== dbName || !/^examquest_polish_test_[a-f\d]+$/.test(dbName)) throw Error('Disposable cleanup guard failed');
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
  }
});
