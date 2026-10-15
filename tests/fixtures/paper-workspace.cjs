// Disposable local-only fixture for manual/browser authoring smoke. No .env is loaded.
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { User } = require('../../src/modules/auth/auth.models');
const { Book, Chapter, Question, QuestionPaper } = require('../../src/modules/exam/exam.models');
const { hashPassword } = require('../../src/modules/auth/auth.crypto');
(async () => {
  const dbName = 'examquest_ui_test_' + randomUUID().replaceAll('-', '');
  await mongoose.connect('mongodb://127.0.0.1:27017/' + dbName, { serverSelectionTimeoutMS: 4000 });
  const user = await User.create({ name: 'Demo Admin', email: 'phase3@example.test', passwordHash: await hashPassword('TestPassword123!'), role: 'ADMIN', accountStatus: 'active', emailVerified: true });
  const book = await Book.create({ title: 'Physics 1st Paper', subject: 'Physics', className: 'HSC', group: 'Science', createdByUserId: user._id });
  const chapter = await Chapter.create({ bookId: book._id, title: 'Vector', createdByUserId: user._id });
  for (const [i,text] of ['Which quantity is a vector?', 'Which has direction?', 'Choose the vector quantity.'].entries()) await Question.create({ bookId: book._id, chapterId: chapter._id, text, options: ['Force', 'Mass', 'Time', 'Temperature'].map((text,j) => ({ key: ['A','B','C','D'][j], text })), correctOption: 'A', explanation: 'Private grading explanation', difficulty: i === 2 ? 'medium' : 'easy', reviewStatus: process.argv.includes('--pending') ? 'draft' : 'approved', createdByUserId: user._id });
  if (process.argv.includes('--polish')) {
    await User.create({ name: 'Demo Member', email: 'phase5@example.test', passwordHash: await hashPassword('TestPassword123!'), role: 'MEMBER', accountStatus: 'active', emailVerified: true, className: 'HSC', group: 'Science', academicYear: 2026 });
    const questions = await Question.find({ bookId: book._id }).select('+correctOption');
    await QuestionPaper.create({ title: 'Phase 5 stable shuffle', bookId: book._id, chapterIds: [chapter._id], eligibleGroups: ['Science'], durationMinutes: 20, totalMarks: 3, passMark: 1, status: 'published', snapshotVersion: 1, academicContext: { className: 'HSC', subject: 'Physics', bookTitle: book.title }, questions: questions.map((q) => ({ questionId: q._id, marks: 1 })), questionSnapshots: questions.map((q) => ({ questionId: q._id, text: q.text, options: q.options, difficulty: q.difficulty, marks: 1 })), answerKey: questions.map((q) => ({ questionId: q._id, correctOption: q.correctOption, explanation: q.explanation })), createdByUserId: user._id });
    await require('../../src/modules/exam/exam.member').ensureExamStorage();
  }
  const harness = express(); let stopping = false;
  const server = harness.listen(3006, '127.0.0.1', () => console.log('Disposable Phase 3 API ready at http://127.0.0.1:3006'));
  async function stop() {
    if (stopping) return; stopping = true;
    await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.name !== dbName || !dbName.startsWith('examquest_ui_test_')) throw new Error('Cleanup database guard failed');
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
    console.log('Disposable fixture documents cleaned; server stopped.');
  }
  harness.post('/__fixture/stop', (req,res) => { res.json({ stopping: true }); void stop(); });
  harness.use(require('../../src/app'));
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
