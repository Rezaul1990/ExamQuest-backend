const mongoose = require('mongoose');
const { Book, Chapter, QuestionPaper, ExamAttempt, ExamSubmission } = require('./exam.models');
const { LearningBookmark, ExamReminder, QuestionReport } = require('./exam.learning-models');
const { memberRecord } = require('./exam.member');
const { eligibleMember, resultsReleased } = require('./exam.member-rules');
const { serializePaper } = require('./exam.authoring');
const { presentQuestions } = require('./exam.presentation');
const { audit } = require('../auth/auth.audit');

function fail(code, statusCode = 400) { const error = new Error(code); error.code = code; error.statusCode = statusCode; throw error; }
function checkId(value) { if (!mongoose.isValidObjectId(value)) fail('NOT_FOUND', 404); }
async function member(id) { const result = await memberRecord(id); if (result.error) fail(result.error, 403); return result.member; }
async function upsertUnique(model, filter, update) {
  try { return await model.findOneAndUpdate(filter, update, { upsert: true, new: true, runValidators: true }); }
  catch (error) { if (error.code !== 11000) throw error; return model.findOneAndUpdate(filter, update, { new: true, runValidators: true }); }
}
async function ownedResult(memberUserId, attemptId) {
  await member(memberUserId); checkId(attemptId);
  const attempt = await ExamAttempt.findOne({ _id: attemptId, memberUserId });
  const accepted = await ExamSubmission.findOne({ attemptId, memberUserId });
  if (!attempt && !accepted) fail('ATTEMPT_NOT_FOUND', 404);
  const result = accepted || attempt;
  const paper = await QuestionPaper.findById(result.questionPaperId).select('+answerKey');
  const book = paper && await Book.findById(paper.bookId);
  if (!paper) fail('QUESTION_PAPER_NOT_FOUND', 404);
  return { result, attempt, paper, book, submitted: !!accepted || attempt?.status === 'submitted' };
}
function reviewRows(context) {
  const { paper, attempt, result } = context;
  if (!resultsReleased(paper)) return [];
  return presentQuestions(paper, attempt).flatMap((question) => {
    const answer = result.answers.find((a) => String(a.questionId) === question.id);
    const key = paper.answerKey?.find((a) => String(a.questionId) === question.id);
    const snapshot = paper.questionSnapshots.find((q) => String(q.questionId) === question.id);
    if (!answer?.correctOption || !key) return [];
    return [{ ...question, chapterId: snapshot.chapterId ? String(snapshot.chapterId) : null,
      selectedOption: answer.selectedOption, correctOption: answer.correctOption, isCorrect: answer.isCorrect,
      marksAwarded: answer.marksAwarded, explanation: key.explanation || '', paperId: String(paper._id) }];
  });
}
async function resultReview(memberUserId, attemptId) {
  const context = await ownedResult(memberUserId, attemptId);
  if (!context.submitted) fail('RESULT_NOT_SUBMITTED', 409);
  const available = resultsReleased(context.paper);
  const bookmarks = available ? await LearningBookmark.find({ memberUserId, paperId: context.paper._id }) : [];
  return { available, releaseAt: context.paper.availableUntil ? new Date(new Date(context.paper.availableUntil).getTime() + context.paper.durationMinutes * 60000) : null,
    message: available ? 'Review your frozen exam answers.' : 'Answers open after the exam closes and its final attempt time ends. Papers without a closing time need Admin release.',
    questions: reviewRows(context).map((q) => ({ ...q, bookmarked: bookmarks.some((b) => String(b.questionId) === q.id) })) };
}
async function setBookmark(memberUserId, attemptId, questionId, enabled) {
  checkId(questionId);
  const review = await resultReview(memberUserId, attemptId);
  if (!review.available || !review.questions.some((q) => q.id === questionId)) fail('REVIEW_NOT_RELEASED', 403);
  const row = review.questions.find((q) => q.id === questionId);
  const filter = { memberUserId, paperId: row.paperId, questionId };
  if (enabled) await upsertUnique(LearningBookmark, filter, { $setOnInsert: filter });
  else await LearningBookmark.deleteOne(filter);
  return { enabled };
}
async function learningOverview(memberUserId) {
  await member(memberUserId);
  const [accepted, legacy, bookmarks] = await Promise.all([
    ExamSubmission.find({ memberUserId }).sort({ submittedAt: -1 }).limit(200),
    ExamAttempt.find({ memberUserId, status: 'submitted' }).sort({ submittedAt: -1 }).limit(200),
    LearningBookmark.find({ memberUserId }),
  ]);
  const records = [...accepted, ...legacy.filter((r) => !accepted.some((a) => String(a.attemptId) === String(r._id)))]
    .sort((a,b) => new Date(b.submittedAt) - new Date(a.submittedAt)).slice(0,200);
  const papers = await QuestionPaper.find({ _id: { $in: records.map((r) => r.questionPaperId) } }).select('+answerKey');
  const attempts = await ExamAttempt.find({ _id: { $in: records.map((r) => r.attemptId || r._id) } });
  const chapters = await Chapter.find({ _id: { $in: papers.flatMap((p) => (p.questionSnapshots || []).map((q) => q.chapterId).filter(Boolean)) } });
  const progress = new Map(), practice = [], seen = new Set(), trend = [];
  const bookmarkKeys = new Set(bookmarks.map((b) => String(b.paperId) + ':' + String(b.questionId)));
  for (const result of records) {
    const paper = papers.find((p) => String(p._id) === String(result.questionPaperId));
    if (!paper) continue;
    trend.push({ attemptId: String(result.attemptId || result._id), title: result.paperTitle || paper.originalTitle || paper.title, percentage: result.percentage, submittedAt: result.submittedAt || result.updatedAt || result.startedAt });
    // Aggregate performance is available immediately; no per-question key is returned here.
    const resultAnswers = new Map(result.answers.map((answer) => [String(answer.questionId), answer]));
    const questionRows = paper.questionSnapshots?.length ? paper.questionSnapshots : result.answers;
    for (const snapshot of questionRows) {
      const answer = resultAnswers.get(String(snapshot.questionId)) || {};
      const chapterId = snapshot?.chapterId ? String(snapshot.chapterId) : null;
      const groupKey = String(paper.bookId) + ':' + (chapterId || 'legacy');
      const row = progress.get(groupKey) || { id: groupKey, bookTitle: paper.academicContext?.bookTitle || book?.title || 'Book', chapterId,
        chapterTitle: chapters.find((c) => String(c._id) === chapterId)?.title || 'Chapter unavailable (older paper)', total: 0, answered: 0, correct: 0 };
      row.total++; if (answer.selectedOption) row.answered++; if (answer.isCorrect) row.correct++; progress.set(groupKey, row);
    }
    const attempt = attempts.find((a) => String(a._id) === String(result.attemptId || result._id));
    for (const question of reviewRows({ result, paper, attempt })) {
      const identity = question.paperId + ':' + question.id;
      if (seen.has(identity)) continue; seen.add(identity);
      const bookmarked = bookmarkKeys.has(identity);
      if (!question.isCorrect || bookmarked) practice.push({ ...question, attemptId: String(result.attemptId || result._id), bookmarked });
    }
  }
  return { window: 200, submissionCount: trend.length, trend: trend.slice(0,20), practiceTotal: practice.length, practiceLimit: 100,
    chapters: [...progress.values()].map((row) => ({ ...row, accuracy: row.total ? Math.round(row.correct / row.total * 100) : 0 })), practice: practice.slice(0,100) };
}
async function discovery(memberUserId) {
  const user = await member(memberUserId), now = new Date();
  const [papers, reminders, submissions, legacy] = await Promise.all([
    QuestionPaper.find({ status: 'published', $or: [{ availableUntil: { $gte: now } }, { availableUntil: null }] }).sort({ availableFrom: 1, _id: 1 }),
    ExamReminder.find({ memberUserId }), ExamSubmission.distinct('questionPaperId', { memberUserId }),
    ExamAttempt.distinct('questionPaperId', { memberUserId, status: 'submitted' }),
  ]);
  const books = await Book.find({ _id: { $in: papers.map((p) => p.bookId) }, status: 'published' });
  const completed = new Set([...submissions, ...legacy].map(String));
  return { serverNow: now, papers: papers.filter((p) => !completed.has(String(p._id)) && books.some((b) => String(b._id) === String(p.bookId) && eligibleMember(user,p,b)))
    .map((p) => ({ ...serializePaper(p, undefined, books.find((b) => String(b._id) === String(p.bookId))), reminded: reminders.some((r) => String(r.paperId) === String(p._id)), upcoming: !!p.availableFrom && p.availableFrom > now })) };
}
async function setReminder(memberUserId, paperId, enabled) {
  checkId(paperId);
  const filter = { memberUserId, paperId };
  await member(memberUserId);
  if (!enabled) { await ExamReminder.deleteOne(filter); return { enabled: false }; }
  const catalog = await discovery(memberUserId);
  if (!catalog.papers.some((p) => p.id === paperId)) fail('QUESTION_PAPER_NOT_FOUND', 404);
  await upsertUnique(ExamReminder, filter, { $setOnInsert: filter });
  return { enabled: true };
}
async function reportQuestion(memberUserId, attemptId, questionId, body) {
  checkId(questionId);
  const context = await ownedResult(memberUserId, attemptId);
  if (!context.paper.questionSnapshots?.some((q) => String(q.questionId) === questionId)) fail('QUESTION_NOT_FOUND', 404);
  const filter = { memberUserId, attemptId, questionId };
  const report = await upsertUnique(QuestionReport, filter, { $setOnInsert: { ...filter, paperId: context.paper._id, category: body.category, detail: body.detail } });
  return { id: String(report._id), status: report.status };
}
async function releaseResults(actor, paperId) {
  checkId(paperId);
  const paper = await QuestionPaper.findById(paperId);
  if (!paper || !['published','archived'].includes(paper.status)) fail('QUESTION_PAPER_NOT_FOUND', 404);
  if (paper.resultsReleaseScheduledAt) return { released: resultsReleased(paper) };
  if (paper.availableUntil || (paper.availableFrom && paper.availableFrom > new Date())) fail('RESULT_RELEASE_SCHEDULED', 409);
  // Close entry and wait a full attempt duration. No early answer release even
  // when an attempt races closing or an expiry worker has not run yet.
  const closeAt = new Date();
  await QuestionPaper.updateOne({ _id: paperId, availableUntil: null }, { $set: { availableUntil: closeAt, resultsReleaseScheduledAt: closeAt }, $inc: { __v: 1 } });
  await audit('RESULTS_RELEASED', { actorUserId: actor._id, metadata: { paperId } });
  return { released: false };
}
async function listReports({ page, status }) {
  const filter = status === 'all' ? {} : { status };
  const reports = await QuestionReport.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page-1)*20).limit(20);
  const papers = await QuestionPaper.find({ _id: { $in: reports.map((r) => r.paperId) } });
  return { page, total: await QuestionReport.countDocuments(filter), reports: reports.map((r) => {
    const paper = papers.find((p) => String(p._id) === String(r.paperId));
    return { id: String(r._id), category: r.category, detail: r.detail, status: r.status, resolution: r.resolution, createdAt: r.createdAt,
      paperTitle: paper?.originalTitle || paper?.title || 'Unavailable paper', questionId: String(r.questionId),
      questionText: paper?.questionSnapshots?.find((q) => String(q.questionId) === String(r.questionId))?.text || 'Unavailable snapshot' };
  }) };
}
async function resolveReport(actor, id, body) {
  checkId(id);
  const report = await QuestionReport.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { ...body, resolvedByUserId: actor._id } }, { new: true, runValidators: true });
  if (!report) fail('REPORT_CHANGED_RELOAD', 409);
  await audit('QUESTION_REPORT_RESOLVED', { actorUserId: actor._id, metadata: { reportId: id, status: body.status } });
  return { id, status: report.status };
}
module.exports = { resultReview, setBookmark, learningOverview, discovery, setReminder, reportQuestion, releaseResults, listReports, resolveReport };
