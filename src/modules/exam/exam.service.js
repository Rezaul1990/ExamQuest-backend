const { Book, Chapter, Question, QuestionPaper } = require("./exam.models");
const memberExams = require("./exam.member");
const { startAttempt, submitAttempt, listAttempts } = memberExams;
const { normalizeAcademicGroup, normalizeClassName } = require("../academic/academic.constants");

const { serializePaper, createQuestionPaper, updateQuestionPaper, deleteQuestionPaper, freezeLegacyQuestionReferences, groupsFor } = require("./exam.authoring");
const { scopedBooks, allowedBookIds } = require("./exam.scope");
const { audit } = require("../auth/auth.audit");
const { previewImport, commitImport, questionIdentity } = require("./exam.import");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compactValue(value) {
  const text = normalizeText(value);
  return text || undefined;
}

function serializeBook(book) {
  return {
    id: book._id.toString(),
    title: book.title,
    subject: book.subject,
    className: book.className,
    group: book.group,
    eligibleGroups: groupsFor(book),
    status: book.status,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

function serializeChapter(chapter) {
  return {
    id: chapter._id.toString(),
    bookId: chapter.bookId.toString(),
    title: chapter.title,
    order: chapter.order,
    status: chapter.status,
  };
}

function serializeQuestion(question, includeCorrect = false) {
  const data = {
    id: question._id.toString(),
    revision: question.__v ?? 0,
    bookId: question.bookId.toString(),
    chapterId: question.chapterId.toString(),
    text: question.text,
    options: question.options,
    explanation: includeCorrect ? question.explanation : undefined,
    reviewStatus: question.$isDefault?.("reviewStatus") ? "approved" : (question.reviewStatus || "approved"),
    difficulty: question.difficulty,
    status: question.status,
  };
  if (includeCorrect) data.correctOption = question.correctOption;
  return data;
}

async function ensureBookAndChapter(bookId, chapterId) {
  const [book, chapter] = await Promise.all([Book.findById(bookId), Chapter.findById(chapterId)]);
  if (!book) return { error: "BOOK_NOT_FOUND" };
  if (!chapter || chapter.bookId.toString() !== bookId.toString()) return { error: "CHAPTER_NOT_FOUND" };
  return { book, chapter };
}

async function listBooks({ memberOnly = false, actor } = {}) {
  let query = scopedBooks(actor);
  let eligiblePapers = [];
  if (memberOnly) { eligiblePapers = await memberExams.listMemberPapers({ memberUserId: actor?._id }); query = { _id: { $in: eligiblePapers.map((paper) => paper.bookId) }, status: "published" }; }
  const books = await Book.find(query).sort({ subject: 1, title: 1 }).limit(300);
  return books.map((book) => { const dto = serializeBook(book); if (!memberOnly) return dto; const paper = eligiblePapers.find((entry) => entry.bookId === String(book._id)); return { ...dto, className: paper?.className, subject: paper?.subject || dto.subject, eligibleGroups: [...new Set(eligiblePapers.filter((entry) => entry.bookId === String(book._id)).flatMap((entry) => entry.eligibleGroups))] }; });
}

async function createBook(payload, actorId) {
  const book = await Book.create({ ...payload, className: compactValue(normalizeClassName(payload.className)), group: compactValue(normalizeAcademicGroup(payload.group)), createdByUserId: actorId });
  return serializeBook(book);
}

async function updateBook(id, payload) {
  const update = { ...payload };
  if (Object.prototype.hasOwnProperty.call(update, "className")) update.className = compactValue(normalizeClassName(update.className));
  if (Object.prototype.hasOwnProperty.call(update, "group")) update.group = compactValue(normalizeAcademicGroup(update.group));
  const book = await Book.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  return book ? serializeBook(book) : null;
}

async function listChapters(bookId, { memberOnly = false, actor } = {}) {
  const query = { bookId };
  if (memberOnly) { const papers = await memberExams.listMemberPapers({ memberUserId: actor?._id, bookId }); query._id = { $in: [...new Set(papers.flatMap((paper) => paper.chapterIds))] }; }
  const chapters = await Chapter.find(query).sort({ order: 1, title: 1 }).limit(300);
  return chapters.map(serializeChapter);
}

async function createChapter(payload, actorId) {
  const book = await Book.findById(payload.bookId);
  if (!book) return { error: "BOOK_NOT_FOUND" };
  const chapter = await Chapter.create({ ...payload, createdByUserId: actorId });
  return { chapter: serializeChapter(chapter) };
}

async function updateChapter(id, payload) {
  const chapter = await Chapter.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  return chapter ? serializeChapter(chapter) : null;
}

function buildQuestionPayload(payload, actorId) {
  return {
    bookId: payload.bookId,
    chapterId: payload.chapterId,
    text: payload.text || payload.question,
    identityKey: questionIdentity(payload.bookId, payload.chapterId, payload.text || payload.question),
    options: [
      { key: "A", text: payload.optionA },
      { key: "B", text: payload.optionB },
      { key: "C", text: payload.optionC },
      { key: "D", text: payload.optionD },
    ],
    correctOption: payload.correctOption,
    explanation: payload.explanation || "",
    difficulty: payload.difficulty || "medium",
    status: payload.status || "active",
    reviewStatus: "draft",
    createdByUserId: actorId,
  };
}

async function listQuestions({ bookId, chapterId, q, difficulty, status, reviewStatus, page = 1, limit = 500 }, actor) {
  const query = {};
  if (bookId) query.bookId = bookId;
  if (chapterId) query.chapterId = chapterId;
  if (q) query.text = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (difficulty) query.difficulty = difficulty;
  if (status) query.status = status;
  if (reviewStatus === 'approved') query.$or = [{ reviewStatus: 'approved' }, { reviewStatus: { $exists: false } }];
  else if (reviewStatus) query.reviewStatus = reviewStatus;
  if (allowedBookIds(actor)) query.bookId = bookId ? { $eq: bookId, $in: allowedBookIds(actor) } : { $in: allowedBookIds(actor) };
  const questions = await Question.find(query).select("+correctOption").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
  const usage = await require('./exam.bank').usageCounts(questions.map((question) => question._id));
  return questions.map((question) => ({ ...serializeQuestion(question, true), paperCount: usage.get(String(question._id)) || 0 }));
}

async function createQuestion(payload, actorId) {
  const refs = await ensureBookAndChapter(payload.bookId, payload.chapterId);
  if (refs.error) return refs;
  const question = await Question.create(buildQuestionPayload(payload, actorId));
  await audit('QUESTION_CREATED', { actorUserId: actorId, metadata: { questionId: String(question._id), bookId: String(question.bookId) } });
  return { question: serializeQuestion(question, true) };
}

async function updateQuestion(id, payload, actorId) {
  const currentVersion = await Question.findById(id).select('__v');
  if (!currentVersion) return null;
  if (payload.revision !== undefined && payload.revision !== (currentVersion.__v || 0)) return { error: 'QUESTION_CHANGED_RELOAD' };
  const frozen = await freezeLegacyQuestionReferences(id);
  if (frozen.error) return frozen;
  if ((payload.bookId || payload.chapterId) && !(payload.bookId && payload.chapterId)) {
    const current = await Question.findById(id);
    if (!current) return null;
    payload.bookId = payload.bookId || current.bookId.toString();
    payload.chapterId = payload.chapterId || current.chapterId.toString();
  }
  if (payload.bookId && payload.chapterId) {
    const refs = await ensureBookAndChapter(payload.bookId, payload.chapterId);
    if (refs.error) return refs;
  }
  const update = { ...payload, reviewStatus: "draft" };
  delete update.revision;
  if (payload.optionA || payload.optionB || payload.optionC || payload.optionD) {
    const current = await Question.findById(id).select("+correctOption");
    if (!current) return null;
    update.options = [
      { key: "A", text: payload.optionA || current.options.find((option) => option.key === "A")?.text },
      { key: "B", text: payload.optionB || current.options.find((option) => option.key === "B")?.text },
      { key: "C", text: payload.optionC || current.options.find((option) => option.key === "C")?.text },
      { key: "D", text: payload.optionD || current.options.find((option) => option.key === "D")?.text },
    ];
    delete update.optionA;
    delete update.optionB;
    delete update.optionC;
    delete update.optionD;
  }
  const identitySource = await Question.findById(id);
  if (!identitySource) return null;
  update.identityKey = questionIdentity(update.bookId || identitySource.bookId, update.chapterId || identitySource.chapterId, update.text || identitySource.text);
  const question = await Question.findOneAndUpdate({ _id: id, __v: currentVersion.__v ?? 0 }, { $set: update, $inc: { __v: 1 } }, { new: true, runValidators: true }).select("+correctOption");
  if (!question) return { error: 'QUESTION_CHANGED_RELOAD' };
  if (question) await audit('QUESTION_EDITED', { actorUserId: actorId, metadata: { questionId: id, revision: question.__v } });
  return question ? serializeQuestion(question, true) : null;
}

async function deleteQuestion(id) {
  const question = await Question.findById(id);
  if (!question) return null;
  const linkedPaper = await QuestionPaper.findOne({ "questions.questionId": question._id, status: { $ne: "archived" } }).select("_id title status questions bookId chapterIds durationMinutes totalMarks passMark availableFrom availableUntil createdAt updatedAt");
  if (linkedPaper) {
    return { error: "QUESTION_IN_USE", questionPaper: serializePaper(linkedPaper) };
  }
  const frozen = await freezeLegacyQuestionReferences(id);
  if (frozen.error) return frozen;
  await Question.deleteOne({ _id: question._id });
  return { deletedQuestionId: question._id.toString() };
}

async function listQuestionPapers(filters = {}, { memberOnly = false, actor } = {}) {
  if (memberOnly) return memberExams.listMemberPapers(filters);
  const query = {};
  if (filters.bookId) query.bookId = filters.bookId;
  if (filters.chapterId) query.chapterIds = filters.chapterId;
  if (!filters.includeArchived) query.status = { $ne: 'archived' };
  if (allowedBookIds(actor)) query.bookId = filters.bookId ? { $eq: filters.bookId, $in: allowedBookIds(actor) } : { $in: allowedBookIds(actor) };
  const papers = await QuestionPaper.find(query).sort({ createdAt: -1 }).limit(300);
  const books = await Book.find({ _id: { $in: papers.map((paper) => paper.bookId) } });
  return papers.map((paper) => serializePaper(paper, undefined, books.find((book) => String(book._id) === String(paper.bookId))));
}

module.exports = {
  serializeBook,
  serializeChapter,
  serializeQuestion,
  serializePaper,
  listBooks,
  createBook,
  updateBook,
  listChapters,
  createChapter,
  updateChapter,
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  previewImport,
  commitImport,
  listQuestionPapers,
  createQuestionPaper,
  updateQuestionPaper,
  deleteQuestionPaper,
  startAttempt,
  submitAttempt,
  listAttempts,
};
