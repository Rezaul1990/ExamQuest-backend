const mongoose = require('mongoose');
const { randomInt, createHash } = require('node:crypto');
const { Book, Chapter, Question, QuestionPaper, ExamAttempt } = require('./exam.models');
const { audit } = require('../auth/auth.audit');
const { normalizeAcademicGroup } = require('../academic/academic.constants');
const { canAccessBook } = require('./exam.scope');
const actorId = (actor) => actor?._id || actor;
const groupsFor = (book) => [...new Set((book.eligibleGroups?.length ? book.eligibleGroups : [book.group]).map(normalizeAcademicGroup).filter(Boolean))];
const approvedQuery = { $or: [{ reviewStatus: 'approved' }, { reviewStatus: { $exists: false } }] };
const approved = (question) => question.reviewStatus === 'approved' || question.$isDefault('reviewStatus');

function serializePaper(paper, questionCount, book) {
  const context = paper.snapshotVersion ? paper.academicContext : book;
  return {
    id: String(paper._id), title: paper.originalTitle || paper.title, bookId: String(paper.bookId),
    subject: context?.subject, className: context?.className, group: book?.group,
    eligibleGroups: paper.eligibleGroups?.length ? paper.eligibleGroups : groupsFor(book || {}),
    chapterIds: (paper.chapterIds || []).map(String), durationMinutes: paper.durationMinutes,
    totalMarks: paper.totalMarks, passMark: paper.passMark ?? Math.ceil(paper.totalMarks * 0.4),
    questionCount: questionCount ?? paper.questions.length, availableFrom: paper.availableFrom, availableUntil: paper.availableUntil,
    status: paper.status, reviewStatus: paper.reviewStatus || 'draft', snapshotVersion: paper.snapshotVersion,
    revision: paper.__v ?? 0, availabilityStatus: paper.status === 'published' && paper.availableFrom > new Date() ? 'scheduled' : paper.status,
    createdAt: paper.createdAt, updatedAt: paper.updatedAt,
  };
}

async function validateSelection(payload, actor) {
  const book = await Book.findById(payload.bookId);
  if (!book || book.status === 'archived') return { error: 'BOOK_NOT_FOUND' };
  if (!canAccessBook(actor, book._id)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  if (!book.className || !groupsFor(book).length) return { error: 'BOOK_ACADEMIC_MAPPING_REQUIRED' };
  const eligibleGroups = [...new Set((payload.eligibleGroups || []).map(normalizeAcademicGroup).filter(Boolean))];
  if (!eligibleGroups.length || eligibleGroups.some((group) => !groupsFor(book).includes(group))) return { error: 'PAPER_GROUP_MAPPING_INVALID' };
  if (payload.passMark > payload.totalMarks) return { error: 'PASS_MARK_EXCEEDS_TOTAL' };
  if (payload.availableFrom && payload.availableUntil && new Date(payload.availableUntil) <= new Date(payload.availableFrom)) return { error: 'INVALID_AVAILABILITY_WINDOW' };
  const ids = payload.questionIds || [];
  if (!ids.length || new Set(ids.map(String)).size !== ids.length) return { error: 'QUESTION_SELECTION_INVALID' };
  const questions = await Question.find({ _id: { $in: ids }, status: 'active' }).select('+correctOption');
  if (questions.length !== ids.length) return { error: 'QUESTION_SELECTION_INVALID' };
  if (questions.some((q) => String(q.bookId) !== String(book._id))) return { error: 'QUESTION_BOOK_MISMATCH' };
  if (questions.some((q) => !approved(q))) return { error: 'QUESTION_APPROVAL_REQUIRED' };
  const chapterIds = payload.chapterIds?.length ? payload.chapterIds.map(String) : [...new Set(questions.map((q) => String(q.chapterId)))];
  if (new Set(chapterIds).size !== chapterIds.length) return { error: 'CHAPTER_SELECTION_INVALID' };
  const chapters = await Chapter.find({ _id: { $in: chapterIds }, bookId: book._id, status: { $ne: 'archived' } });
  if (chapters.length !== chapterIds.length || questions.some((q) => !chapterIds.includes(String(q.chapterId)))) return { error: 'QUESTION_CHAPTER_MISMATCH' };
  return { book, chapterIds, eligibleGroups, questions: ids.map((id) => questions.find((q) => String(q._id) === String(id))) };
}

function selectionDigest(selection) {
  return createHash('sha256').update(JSON.stringify({ className: selection.book.className, subject: selection.book.subject, groups: selection.eligibleGroups, questions: selection.questions.map((q) => ({ id: String(q._id), text: q.text, options: q.options.map((o) => ({ key: o.key, text: o.text })), correctOption: q.correctOption, explanation: q.explanation, difficulty: q.difficulty, revision: q.__v })) })).digest('hex');
}

function snapshots(questions, totalMarks, book) {
  return {
    snapshotVersion: 1,
    academicContext: { className: book.className, subject: book.subject, bookTitle: book.title },
    questionSnapshots: questions.map((q) => ({ questionId: q._id, text: q.text, options: q.options.map((option) => ({ key: option.key, text: option.text })), difficulty: q.difficulty, marks: totalMarks / questions.length })),
    answerKey: questions.map((q) => ({ questionId: q._id, correctOption: q.correctOption, explanation: q.explanation || '' })),
  };
}

async function paperWrite(promise) {
  try { return await promise; } catch (error) {
    if (error.code === 11000) return { error: 'PAPER_TITLE_ALREADY_EXISTS' };
    throw error;
  }
}

async function createQuestionPaper(payload, actor) {
  if (payload.status && payload.status !== 'draft') return { error: 'PAPER_REVIEW_REQUIRED' };
  const selection = await validateSelection(payload, actor);
  if (selection.error) return selection;
  const paper = await paperWrite(QuestionPaper.create({
    title: payload.title, bookId: payload.bookId, chapterIds: selection.chapterIds, eligibleGroups: selection.eligibleGroups,
    durationMinutes: payload.durationMinutes, totalMarks: payload.totalMarks, passMark: payload.passMark,
    availableFrom: payload.availableFrom, availableUntil: payload.availableUntil,
    questions: selection.questions.map((q) => ({ questionId: q._id, marks: payload.totalMarks / selection.questions.length })),
    status: 'draft', reviewStatus: 'draft', createdByUserId: actorId(actor),
  }));
  if (paper.error) return paper;
  await audit('PAPER_CREATED', { actorUserId: actorId(actor), metadata: { paperId: String(paper._id), bookId: String(paper.bookId) } });
  return { paper: serializePaper(paper, undefined, selection.book) };
}

async function updateQuestionPaper(id, payload, actor) {
  const current = await QuestionPaper.findById(id).select('+reviewDigest');
  if (!current) return null;
  if (!canAccessBook(actor, current.bookId)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  if (current.status === 'archived') return { error: 'PAPER_ARCHIVED' };
  if (payload.status === 'archived') { const result = await deleteQuestionPaper(id, actor); return result?.error ? result : result?.questionPaper; }
  const statusOnly = Object.keys(payload).every((key) => ['status','revision'].includes(key));
  if (current.snapshotVersion || current.status === 'published') {
    if (statusOnly && payload.status === 'published') return serializePaper(current, undefined, await Book.findById(current.bookId));
    return { error: 'PUBLISHED_PAPER_IMMUTABLE' };
  }
  if (payload.revision !== undefined && payload.revision !== current.__v) return { error: 'PAPER_CHANGED_RELOAD' };
  const merged = { ...current.toObject(), ...payload, bookId: String(payload.bookId || current.bookId), questionIds: payload.questionIds || current.questions.map((q) => String(q.questionId)) };
  const selection = await validateSelection(merged, actor);
  if (selection.error) return selection;
  let update;
  if (statusOnly && payload.status === 'published') {
    if (current.reviewStatus !== 'approved') return { error: 'PAPER_REVIEW_REQUIRED' };
    if (current.reviewDigest !== selectionDigest(selection)) return { error: 'PAPER_CONTENT_CHANGED_REVIEW_REQUIRED' };
    update = { status: 'published', ...snapshots(selection.questions, current.totalMarks, selection.book) };
  } else {
    if (payload.status && payload.status !== 'draft') return { error: 'PAPER_REVIEW_REQUIRED' };
    update = {
      title: merged.title, bookId: merged.bookId, chapterIds: selection.chapterIds, eligibleGroups: selection.eligibleGroups,
      durationMinutes: merged.durationMinutes, totalMarks: merged.totalMarks, passMark: merged.passMark,
      availableFrom: merged.availableFrom, availableUntil: merged.availableUntil, reviewStatus: 'draft', reviewDigest: null,
      questions: selection.questions.map((q) => ({ questionId: q._id, marks: merged.totalMarks / selection.questions.length })),
    };
  }
  const paper = await paperWrite(QuestionPaper.findOneAndUpdate({ _id: id, __v: current.__v, status: 'draft' }, { $set: update, $inc: { __v: 1 } }, { new: true, runValidators: true }));
  if (paper?.error) return paper;
  if (!paper) return { error: 'PAPER_CHANGED_RELOAD' };
  await audit(update.status === 'published' ? 'PAPER_PUBLISHED' : 'PAPER_EDITED', { actorUserId: actorId(actor), metadata: { paperId: id, revision: paper.__v } });
  return serializePaper(paper, undefined, selection.book);
}

async function reviewPaper(id, reviewStatus, revision, actor) {
  const paper = await QuestionPaper.findById(id).select('+reviewDigest');
  if (!paper) return { error: 'QUESTION_PAPER_NOT_FOUND' };
  if (!canAccessBook(actor, paper.bookId)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  if (paper.status !== 'draft' || paper.snapshotVersion) return { error: 'PUBLISHED_PAPER_IMMUTABLE' };
  if (revision !== paper.__v) return { error: 'PAPER_CHANGED_RELOAD' };
  if ((reviewStatus === 'reviewed' && paper.reviewStatus !== 'draft') || (reviewStatus === 'approved' && paper.reviewStatus !== 'reviewed')) return { error: 'INVALID_REVIEW_TRANSITION' };
  const selection = await validateSelection({ ...paper.toObject(), questionIds: paper.questions.map((q) => String(q.questionId)) }, actor);
  if (selection.error) return selection;
  const reviewDigest = selectionDigest(selection);
  if (reviewStatus === 'approved' && paper.reviewDigest !== reviewDigest) return { error: 'PAPER_CONTENT_CHANGED_REVIEW_REQUIRED' };
  const updated = await QuestionPaper.findOneAndUpdate({ _id: id, __v: paper.__v, status: 'draft' }, { $set: { reviewStatus, reviewDigest }, $inc: { __v: 1 } }, { new: true });
  if (!updated) return { error: 'PAPER_CHANGED_RELOAD' };
  await audit('PAPER_' + reviewStatus.toUpperCase(), { actorUserId: actorId(actor), metadata: { paperId: id, revision: updated.__v } });
  return { questionPaper: serializePaper(updated, undefined, selection.book) };
}

async function deleteQuestionPaper(id, actor) {
  const paper = await QuestionPaper.findById(id).select('+reviewDigest');
  if (!paper) return null;
  if (!canAccessBook(actor, paper.bookId)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  const attemptCount = await ExamAttempt.countDocuments({ questionPaperId: id });
  if (paper.status === 'archived') return { deletedMode: 'archived', questionPaper: serializePaper(paper, undefined, await Book.findById(paper.bookId)), attemptCount };
  // Preserve title for history, free the old unique title slot, retain all questions/attempts.
  const archived = await QuestionPaper.findOneAndUpdate({ _id: id, __v: paper.__v }, { $set: { status: 'archived', originalTitle: paper.originalTitle || paper.title, title: `${paper.title} (archived-${paper._id})` }, $inc: { __v: 1 } }, { new: true });
  if (!archived) return { error: 'PAPER_CHANGED_RELOAD' };
  await audit('PAPER_ARCHIVED', { actorUserId: actorId(actor), metadata: { paperId: id, attemptCount } });
  return { deletedMode: 'archived', questionPaper: serializePaper(archived, undefined, await Book.findById(paper.bookId)), attemptCount };
}

async function generateQuestions(payload, actor) {
  const book = await Book.findById(payload.bookId);
  if (!book || !canAccessBook(actor, book._id)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  if (!book.className || !payload.eligibleGroups.length || payload.eligibleGroups.some((group) => !groupsFor(book).includes(group))) return { error: 'PAPER_GROUP_MAPPING_INVALID' };
  const chapters = await Chapter.find({ _id: { $in: payload.chapterIds }, bookId: book._id, status: { $ne: 'archived' } });
  if (chapters.length !== payload.chapterIds.length) return { error: 'CHAPTER_SELECTION_INVALID' };
  const candidates = await Question.find({ bookId: book._id, chapterId: { $in: payload.chapterIds }, status: 'active', ...approvedQuery, ...(payload.difficulty ? { difficulty: payload.difficulty } : {}) });
  const papers = await QuestionPaper.find({ bookId: book._id }).select('questions');
  const usage = new Map();
  papers.forEach((paper) => paper.questions.forEach((q) => usage.set(String(q.questionId), (usage.get(String(q.questionId)) || 0) + 1)));
  // Randomize ties, then optionally favor less-used questions. Reuse is never forbidden.
  for (let i = candidates.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  if (payload.preferFresh) candidates.sort((a,b) => (usage.get(String(a._id)) || 0) - (usage.get(String(b._id)) || 0));
  const selected = candidates.slice(0, payload.count);
  return { questionIds: selected.map((q) => String(q._id)), availableCount: candidates.length, requestedCount: payload.count, shortageCount: Math.max(0, payload.count - candidates.length), reusedCount: selected.filter((q) => usage.has(String(q._id))).length };
}

async function previewPaper(id, actor) {
  const paper = await QuestionPaper.findById(id).select('+reviewDigest');
  if (!paper || !canAccessBook(actor, paper.bookId)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  const book = await Book.findById(paper.bookId);
  let questions, warnings = [];
  if (paper.snapshotVersion) questions = paper.questionSnapshots;
  else {
    const result = await validateSelection({ ...paper.toObject(), questionIds: paper.questions.map((q) => String(q.questionId)) }, actor);
    if (result.error) warnings.push('This draft needs correction before publishing: ' + result.error);
    const bank = await Question.find({ _id: { $in: paper.questions.map((q) => q.questionId) }, bookId: paper.bookId });
    questions = paper.questions.map((item) => {
      const q = bank.find((entry) => String(entry._id) === String(item.questionId));
      return { questionId: item.questionId, text: q?.text || '[Question unavailable — edit this draft]', options: q?.options || [], difficulty: q?.difficulty, marks: item.marks };
    });
  }
  const ids = questions.map((q) => q.questionId);
  const reusedPapers = await QuestionPaper.countDocuments({ _id: { $ne: id }, 'questions.questionId': { $in: ids } });
  if (reusedPapers) warnings.push(`Selected questions also appear in ${reusedPapers} other paper(s). Reuse is allowed.`);
  return { questionPaper: serializePaper(paper, undefined, book), questions: questions.map((q) => ({ id: String(q.questionId), bookId: String(paper.bookId), text: q.text, options: q.options.map((o) => ({ key: o.key, text: o.text })), difficulty: q.difficulty, marks: q.marks })), warnings };
}

// Non-destructive compatibility: freeze legacy published papers on first use.
async function ensurePaperSnapshot(paper) {
  if (paper.snapshotVersion) return paper;
  const questions = await Question.find({ _id: { $in: paper.questions.map((q) => q.questionId) } }).select('+correctOption');
  if (questions.length !== paper.questions.length) return null;
  const ordered = paper.questions.map((item) => questions.find((q) => String(q._id) === String(item.questionId)));
  const book = await Book.findById(paper.bookId);
  if (!book) return null;
  const data = snapshots(ordered, paper.totalMarks, book);
  data.eligibleGroups = paper.eligibleGroups?.length ? paper.eligibleGroups : groupsFor(book);
  // Keep existing marks when freezing legacy grading.
  data.questionSnapshots.forEach((q,i) => { q.marks = paper.questions[i].marks; });
  await QuestionPaper.updateOne({ _id: paper._id, snapshotVersion: { $exists: false } }, { $set: data });
  return QuestionPaper.findById(paper._id).select('+answerKey');
}
module.exports = { serializePaper, createQuestionPaper, updateQuestionPaper, deleteQuestionPaper, reviewPaper, generateQuestions, previewPaper, ensurePaperSnapshot, groupsFor, approvedQuery };

async function reviewQuestion(id, { reviewStatus, revision }, actor) {
  const q = await Question.findById(id);
  if (!q) return { error: 'QUESTION_NOT_FOUND' };
  if (!canAccessBook(actor, q.bookId)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  const previous = q.$isDefault('reviewStatus') ? 'approved' : q.reviewStatus;
  if ((reviewStatus === 'reviewed' && previous !== 'draft') || (reviewStatus === 'approved' && previous !== 'reviewed')) return { error: 'INVALID_REVIEW_TRANSITION' };
  const question = await Question.findOneAndUpdate({ _id: id, __v: revision }, { $set: { reviewStatus }, $inc: { __v: 1 } }, { new: true }).select('+correctOption');
  if (!question) return { error: 'QUESTION_CHANGED_RELOAD' };
  await audit('QUESTION_' + reviewStatus.toUpperCase(), { actorUserId: actorId(actor), metadata: { questionId: id, revision: question.__v } });
  return { question };
}
module.exports.reviewQuestion = reviewQuestion;

async function listCandidates(bookId, actor) {
  if (!mongoose.isValidObjectId(bookId) || !canAccessBook(actor, bookId)) return { error: 'RESOURCE_SCOPE_FORBIDDEN' };
  const questions = await Question.find({ bookId, status: 'active', ...approvedQuery }).sort({ createdAt: -1 }).limit(1000);
  return { questions: questions.map((q) => ({ id: String(q._id), bookId: String(q.bookId), chapterId: String(q.chapterId), text: q.text, options: q.options.map((o) => ({ key: o.key, text: o.text })), difficulty: q.difficulty, status: q.status, reviewStatus: 'approved', revision: q.__v || 0 })), limit: 1000 };
}
module.exports.listCandidates = listCandidates;

async function freezeLegacyQuestionReferences(questionId) {
  const papers = await QuestionPaper.find({ 'questions.questionId': questionId, status: { $in: ['published','archived'] }, snapshotVersion: { $exists: false } });
  for (const paper of papers) if (!await ensurePaperSnapshot(paper)) return { error: 'LEGACY_PAPER_SNAPSHOT_REQUIRED' };
  return {};
}
module.exports.freezeLegacyQuestionReferences = freezeLegacyQuestionReferences;
