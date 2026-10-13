const mongoose = require("mongoose");
const { Book, Chapter, Question, QuestionPaper, ExamAttempt } = require("./exam.models");

const IMPORT_COLUMNS = ["book", "chapter", "question", "optionA", "optionB", "optionC", "optionD", "correctOption"];

function toId(value) {
  return new mongoose.Types.ObjectId(value);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOption(value) {
  return normalizeText(value).toUpperCase();
}

function serializeBook(book) {
  return {
    id: book._id.toString(),
    title: book.title,
    subject: book.subject,
    className: book.className,
    group: book.group,
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
    bookId: question.bookId.toString(),
    chapterId: question.chapterId.toString(),
    text: question.text,
    options: question.options,
    explanation: question.explanation,
    difficulty: question.difficulty,
    status: question.status,
  };
  if (includeCorrect) data.correctOption = question.correctOption;
  return data;
}

function serializePaper(paper, questionCount) {
  return {
    id: paper._id.toString(),
    title: paper.title,
    bookId: paper.bookId.toString(),
    chapterIds: (paper.chapterIds || []).map((id) => id.toString()),
    durationMinutes: paper.durationMinutes,
    totalMarks: paper.totalMarks,
    questionCount: questionCount ?? paper.questions.length,
    status: paper.status,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
  };
}

function serializeAttempt(attempt, paper, questions = []) {
  return {
    id: attempt._id.toString(),
    questionPaperId: attempt.questionPaperId.toString(),
    paperTitle: paper?.title,
    answers: attempt.answers.map((answer) => ({
      questionId: answer.questionId.toString(),
      selectedOption: answer.selectedOption,
      correctOption: answer.correctOption,
      isCorrect: answer.isCorrect,
      marksAwarded: answer.marksAwarded,
    })),
    questions,
    score: attempt.score,
    total: attempt.total,
    percentage: attempt.percentage,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
  };
}

async function ensureBookAndChapter(bookId, chapterId) {
  const [book, chapter] = await Promise.all([Book.findById(bookId), Chapter.findById(chapterId)]);
  if (!book) return { error: "BOOK_NOT_FOUND" };
  if (!chapter || chapter.bookId.toString() !== bookId.toString()) return { error: "CHAPTER_NOT_FOUND" };
  return { book, chapter };
}

async function listBooks({ memberOnly = false } = {}) {
  const query = memberOnly ? { status: "published" } : {};
  const books = await Book.find(query).sort({ subject: 1, title: 1 }).limit(300);
  return books.map(serializeBook);
}

async function createBook(payload, actorId) {
  const book = await Book.create({ ...payload, createdByUserId: actorId });
  return serializeBook(book);
}

async function updateBook(id, payload) {
  const book = await Book.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  return book ? serializeBook(book) : null;
}

async function listChapters(bookId, { memberOnly = false } = {}) {
  const query = { bookId };
  if (memberOnly) query.status = "published";
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
    text: payload.text,
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
    createdByUserId: actorId,
  };
}

async function listQuestions({ bookId, chapterId }) {
  const query = {};
  if (bookId) query.bookId = bookId;
  if (chapterId) query.chapterId = chapterId;
  const questions = await Question.find(query).select("+correctOption").sort({ createdAt: -1 }).limit(500);
  return questions.map((question) => serializeQuestion(question, true));
}

async function createQuestion(payload, actorId) {
  const refs = await ensureBookAndChapter(payload.bookId, payload.chapterId);
  if (refs.error) return refs;
  const question = await Question.create(buildQuestionPayload(payload, actorId));
  return { question: serializeQuestion(question, true) };
}

async function updateQuestion(id, payload) {
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
  const update = { ...payload };
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
  const question = await Question.findByIdAndUpdate(id, update, { new: true, runValidators: true }).select("+correctOption");
  return question ? serializeQuestion(question, true) : null;
}

function parseCsv(csvText) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => normalizeText(cell))) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some((cell) => normalizeText(cell))) rows.push(row);
  return rows;
}

function previewImport(csvText) {
  const parsed = parseCsv(csvText);
  if (!parsed.length) return { rows: [], validRows: [], invalidCount: 0, validCount: 0 };
  const headers = parsed[0].map((header) => normalizeText(header));
  const records = parsed.slice(1).map((cells, index) => {
    const source = {};
    headers.forEach((header, columnIndex) => {
      source[header] = normalizeText(cells[columnIndex] || "");
    });
    const normalized = {
      book: source.book,
      chapter: source.chapter,
      question: source.question,
      optionA: source.optionA,
      optionB: source.optionB,
      optionC: source.optionC,
      optionD: source.optionD,
      correctOption: normalizeOption(source.correctOption),
      explanation: source.explanation || "",
      difficulty: (source.difficulty || "medium").toLowerCase(),
      subject: source.subject || source.book || "",
      className: source.className || "",
      group: source.group || "",
    };
    const errors = [];
    IMPORT_COLUMNS.forEach((column) => {
      if (!normalized[column]) errors.push(`${column} is required`);
    });
    if (!["A", "B", "C", "D"].includes(normalized.correctOption)) errors.push("correctOption must be A, B, C or D");
    if (!["easy", "medium", "hard"].includes(normalized.difficulty)) errors.push("difficulty must be easy, medium or hard");
    return { rowNumber: index + 2, data: normalized, errors };
  });
  return {
    rows: records,
    validRows: records.filter((row) => !row.errors.length).map((row) => row.data),
    validCount: records.filter((row) => !row.errors.length).length,
    invalidCount: records.filter((row) => row.errors.length).length,
  };
}

async function commitImport(rows, actorId) {
  const savedQuestions = [];
  for (const row of rows) {
    const book = await Book.findOneAndUpdate(
      { title: row.book, subject: row.subject || row.book, className: row.className || undefined, group: row.group || undefined },
      { $setOnInsert: { createdByUserId: actorId, status: "published" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const chapter = await Chapter.findOneAndUpdate(
      { bookId: book._id, title: row.chapter },
      { $setOnInsert: { createdByUserId: actorId, status: "published" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const payload = buildQuestionPayload({ ...row, bookId: book._id.toString(), chapterId: chapter._id.toString() }, actorId);
    const question = await Question.findOneAndUpdate(
      { bookId: book._id, chapterId: chapter._id, text: row.question },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select("+correctOption");
    savedQuestions.push(serializeQuestion(question, true));
  }
  return savedQuestions;
}

async function listQuestionPapers(filters = {}, { memberOnly = false } = {}) {
  const query = {};
  if (filters.bookId) query.bookId = filters.bookId;
  if (filters.chapterId) query.chapterIds = filters.chapterId;
  if (memberOnly) query.status = "published";
  const papers = await QuestionPaper.find(query).sort({ createdAt: -1 }).limit(300);
  return papers.map((paper) => serializePaper(paper));
}

async function createQuestionPaper(payload, actorId) {
  const questions = await Question.find({ _id: { $in: payload.questionIds.map(toId) }, status: "active" });
  if (questions.length !== payload.questionIds.length) return { error: "QUESTION_SELECTION_INVALID" };
  if (questions.some((question) => question.bookId.toString() !== payload.bookId)) return { error: "QUESTION_BOOK_MISMATCH" };
  const paper = await QuestionPaper.create({
    title: payload.title,
    bookId: payload.bookId,
    chapterIds: payload.chapterIds?.length ? payload.chapterIds : [...new Set(questions.map((question) => question.chapterId.toString()))],
    durationMinutes: payload.durationMinutes,
    totalMarks: payload.totalMarks,
    questions: payload.questionIds.map((questionId) => ({ questionId, marks: Math.max(1, payload.totalMarks / payload.questionIds.length) })),
    status: payload.status,
    createdByUserId: actorId,
  });
  return { paper: serializePaper(paper) };
}

async function updateQuestionPaper(id, payload) {
  const update = { ...payload };
  if (payload.questionIds) {
    const paper = await QuestionPaper.findById(id);
    if (!paper && !payload.bookId) return null;
    const bookId = payload.bookId || paper.bookId.toString();
    const questions = await Question.find({ _id: { $in: payload.questionIds.map(toId) }, status: "active" });
    if (questions.length !== payload.questionIds.length) return { error: "QUESTION_SELECTION_INVALID" };
    if (questions.some((question) => question.bookId.toString() !== bookId)) return { error: "QUESTION_BOOK_MISMATCH" };
    update.questions = payload.questionIds.map((questionId) => ({ questionId, marks: Math.max(1, (payload.totalMarks || paper.totalMarks) / payload.questionIds.length) }));
    update.chapterIds = payload.chapterIds?.length ? payload.chapterIds : [...new Set(questions.map((question) => question.chapterId.toString()))];
    delete update.questionIds;
  }
  const paper = await QuestionPaper.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  return paper ? serializePaper(paper) : null;
}

async function startAttempt(paperId, memberUserId) {
  const paper = await QuestionPaper.findOne({ _id: paperId, status: "published" });
  if (!paper) return { error: "QUESTION_PAPER_NOT_FOUND" };
  const existing = await ExamAttempt.findOne({ memberUserId, questionPaperId: paper._id, status: "in_progress" });
  const attempt = existing || (await ExamAttempt.create({ memberUserId, questionPaperId: paper._id, total: paper.totalMarks }));
  const questions = await Question.find({ _id: { $in: paper.questions.map((item) => item.questionId) }, status: "active" });
  return {
    attempt: serializeAttempt(
      attempt,
      paper,
      paper.questions
        .map((paperQuestion) => questions.find((question) => question._id.toString() === paperQuestion.questionId.toString()))
        .filter(Boolean)
        .map((question) => serializeQuestion(question, false))
    ),
    paper: serializePaper(paper),
  };
}

async function submitAttempt(attemptId, memberUserId, answerRows) {
  const attempt = await ExamAttempt.findOne({ _id: attemptId, memberUserId });
  if (!attempt) return { error: "ATTEMPT_NOT_FOUND" };
  if (attempt.status === "submitted") return { error: "ATTEMPT_ALREADY_SUBMITTED" };
  const paper = await QuestionPaper.findById(attempt.questionPaperId);
  if (!paper) return { error: "QUESTION_PAPER_NOT_FOUND" };
  const questions = await Question.find({ _id: { $in: paper.questions.map((item) => item.questionId) } }).select("+correctOption");
  const answerMap = new Map(answerRows.map((answer) => [answer.questionId, answer.selectedOption]));
  let score = 0;
  const answers = paper.questions.map((paperQuestion) => {
    const question = questions.find((item) => item._id.toString() === paperQuestion.questionId.toString());
    const selectedOption = answerMap.get(paperQuestion.questionId.toString());
    const isCorrect = !!question && selectedOption === question.correctOption;
    const marksAwarded = isCorrect ? paperQuestion.marks : 0;
    score += marksAwarded;
    return {
      questionId: paperQuestion.questionId,
      selectedOption,
      correctOption: question?.correctOption,
      isCorrect,
      marksAwarded,
    };
  });
  attempt.answers = answers;
  attempt.score = score;
  attempt.total = paper.totalMarks;
  attempt.percentage = paper.totalMarks ? Math.round((score / paper.totalMarks) * 10000) / 100 : 0;
  attempt.status = "submitted";
  attempt.submittedAt = new Date();
  await attempt.save();
  return { attempt: serializeAttempt(attempt, paper) };
}

async function listAttempts(memberUserId) {
  const attempts = await ExamAttempt.find({ memberUserId }).sort({ createdAt: -1 }).limit(100);
  const paperIds = [...new Set(attempts.map((attempt) => attempt.questionPaperId.toString()))];
  const papers = await QuestionPaper.find({ _id: { $in: paperIds.map(toId) } });
  return attempts.map((attempt) => serializeAttempt(attempt, papers.find((paper) => paper._id.toString() === attempt.questionPaperId.toString())));
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
  previewImport,
  commitImport,
  listQuestionPapers,
  createQuestionPaper,
  updateQuestionPaper,
  startAttempt,
  submitAttempt,
  listAttempts,
};
