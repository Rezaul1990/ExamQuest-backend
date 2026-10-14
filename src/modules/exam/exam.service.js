const mongoose = require("mongoose");
const { Book, Chapter, Question, QuestionPaper, ExamAttempt } = require("./exam.models");

const IMPORT_COLUMNS = ["book", "chapter", "question", "optionA", "optionB", "optionC", "optionD", "correctOption"];
const IMPORT_OPTIONAL_COLUMNS = ["explanation", "difficulty", "subject", "className", "group"];
const IMPORT_MAX_ROWS = 50;

function toId(value) {
  return new mongoose.Types.ObjectId(value);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOption(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function compactValue(value) {
  const text = normalizeText(value);
  return text || undefined;
}

function importDuplicateKey(row) {
  return [
    normalizeKey(row.book),
    normalizeKey(row.subject || row.book),
    normalizeKey(row.className),
    normalizeKey(row.group),
    normalizeKey(row.chapter),
    normalizeKey(row.question),
  ].join("|");
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

function serializePaper(paper, questionCount, book) {
  return {
    id: paper._id.toString(),
    title: paper.title,
    bookId: paper.bookId.toString(),
    subject: book?.subject,
    className: book?.className,
    group: book?.group,
    chapterIds: (paper.chapterIds || []).map((id) => id.toString()),
    durationMinutes: paper.durationMinutes,
    totalMarks: paper.totalMarks,
    passMark: paper.passMark ?? Math.ceil(paper.totalMarks * 0.4),
    questionCount: questionCount ?? paper.questions.length,
    availableFrom: paper.availableFrom,
    availableUntil: paper.availableUntil,
    status: paper.status,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
  };
}

function applyAvailablePaperWindow(query) {
  const now = new Date();
  query.$and = [
    { $or: [{ availableFrom: { $exists: false } }, { availableFrom: null }, { availableFrom: { $lte: now } }] },
    { $or: [{ availableUntil: { $exists: false } }, { availableUntil: null }, { availableUntil: { $gte: now } }] },
  ];
  return query;
}

function isPaperOpen(paper) {
  const now = new Date();
  return (!paper.availableFrom || paper.availableFrom <= now) && (!paper.availableUntil || paper.availableUntil >= now);
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
    text: payload.text || payload.question,
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

async function deleteQuestion(id) {
  const question = await Question.findById(id);
  if (!question) return null;
  const linkedPaper = await QuestionPaper.findOne({ "questions.questionId": question._id, status: { $ne: "archived" } }).select("_id title status questions bookId chapterIds durationMinutes totalMarks passMark availableFrom availableUntil createdAt updatedAt");
  if (linkedPaper) {
    return { error: "QUESTION_IN_USE", questionPaper: serializePaper(linkedPaper) };
  }
  await Question.deleteOne({ _id: question._id });
  return { deletedQuestionId: question._id.toString() };
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

function validateImportRecords(parsed) {
  if (!parsed.length) return { rows: [], validRows: [], invalidCount: 0, validCount: 0, duplicateCount: 0, errors: [] };
  const headers = parsed[0].map((header) => normalizeText(header));
  const headerSet = new Set(headers);
  const missingHeaders = [...IMPORT_COLUMNS, ...IMPORT_OPTIONAL_COLUMNS].filter((column) => !headerSet.has(column));
  const seen = new Map();
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
    missingHeaders
      .filter((column) => IMPORT_COLUMNS.includes(column))
      .forEach((column) => errors.push(`${column} column is missing`));
    IMPORT_COLUMNS.forEach((column) => {
      if (!normalized[column]) errors.push(`${column} is required`);
    });
    if (!["A", "B", "C", "D"].includes(normalized.correctOption)) errors.push("correctOption must be A, B, C or D");
    if (!["easy", "medium", "hard"].includes(normalized.difficulty)) errors.push("difficulty must be easy, medium or hard");
    if (index >= IMPORT_MAX_ROWS) errors.push(`Only the first ${IMPORT_MAX_ROWS} questions can be imported at once`);
    const duplicateKey = importDuplicateKey(normalized);
    if (seen.has(duplicateKey)) {
      errors.push(`Duplicate of CSV row ${seen.get(duplicateKey)}`);
    } else {
      seen.set(duplicateKey, index + 2);
    }
    return { rowNumber: index + 2, data: normalized, errors, duplicate: false };
  });
  return {
    rows: records,
    validRows: records.filter((row) => !row.errors.length).map((row) => row.data),
    validCount: records.filter((row) => !row.errors.length).length,
    invalidCount: records.filter((row) => row.errors.length).length,
    duplicateCount: records.filter((row) => row.errors.some((error) => error.startsWith("Duplicate of CSV row"))).length,
    errors: parsed.length - 1 > IMPORT_MAX_ROWS ? [`CSV contains ${parsed.length - 1} rows. Import supports maximum ${IMPORT_MAX_ROWS} questions per file.`] : [],
  };
}

async function markExistingQuestionDuplicates(preview) {
  const validRows = preview.rows.filter((row) => !row.errors.length);
  if (!validRows.length) return preview;
  const bookTitles = [...new Set(validRows.map((row) => row.data.book))];
  const subjects = [...new Set(validRows.map((row) => row.data.subject || row.data.book))];
  const books = await Book.find({ title: { $in: bookTitles }, subject: { $in: subjects } });
  if (!books.length) return preview;

  const bookMap = new Map(
    books.map((book) => [
      [normalizeKey(book.title), normalizeKey(book.subject), normalizeKey(book.className), normalizeKey(book.group)].join("|"),
      book,
    ])
  );
  const chapters = await Chapter.find({ bookId: { $in: books.map((book) => book._id) }, title: { $in: [...new Set(validRows.map((row) => row.data.chapter))] } });
  const chapterMap = new Map(chapters.map((chapter) => [`${chapter.bookId.toString()}|${normalizeKey(chapter.title)}`, chapter]));
  const questions = await Question.find({
    chapterId: { $in: chapters.map((chapter) => chapter._id) },
    text: { $in: [...new Set(validRows.map((row) => row.data.question))] },
  });
  const questionMap = new Map(questions.map((question) => [`${question.chapterId.toString()}|${normalizeKey(question.text)}`, question]));
  const existingKeys = new Set(questionMap.keys());

  preview.rows = preview.rows.map((row) => {
    if (row.errors.length) return row;
    const bookKey = [normalizeKey(row.data.book), normalizeKey(row.data.subject || row.data.book), normalizeKey(row.data.className), normalizeKey(row.data.group)].join("|");
    const book = bookMap.get(bookKey);
    const chapter = book ? chapterMap.get(`${book._id.toString()}|${normalizeKey(row.data.chapter)}`) : null;
    if (chapter && existingKeys.has(`${chapter._id.toString()}|${normalizeKey(row.data.question)}`)) {
      const existingQuestion = questionMap.get(`${chapter._id.toString()}|${normalizeKey(row.data.question)}`);
      return { ...row, duplicate: true, existingQuestionId: existingQuestion?._id.toString(), errors: [...row.errors, "Question already exists in the question bank"] };
    }
    return row;
  });
  preview.validRows = preview.rows.filter((row) => !row.errors.length).map((row) => row.data);
  preview.validCount = preview.validRows.length;
  preview.invalidCount = preview.rows.filter((row) => row.errors.length).length;
  preview.duplicateCount = preview.rows.filter((row) => row.duplicate || row.errors.some((error) => error.startsWith("Duplicate of CSV row"))).length;
  return preview;
}

async function previewImport(csvText) {
  return markExistingQuestionDuplicates(validateImportRecords(parseCsv(csvText)));
}

async function commitImport(rows, actorId) {
  const importHeaders = [...IMPORT_COLUMNS, ...IMPORT_OPTIONAL_COLUMNS];
  const preview = validateImportRecords([
    importHeaders,
    ...rows.map((row) => importHeaders.map((header) => row[header] || "")),
  ]);
  if (preview.invalidCount) {
    return { importedCount: 0, skippedDuplicateCount: 0, invalidCount: preview.invalidCount, rows: preview.rows, questions: [], summary: "Import rejected because one or more rows are invalid." };
  }

  const savedQuestions = [];
  const skippedRows = [];
  const bookCache = new Map();
  const chapterCache = new Map();
  const questionOps = [];
  const questionRefs = [];

  for (const row of preview.validRows) {
    const bookKey = [normalizeKey(row.book), normalizeKey(row.subject || row.book), normalizeKey(row.className), normalizeKey(row.group)].join("|");
    let book = bookCache.get(bookKey);
    if (!book) {
      book = await Book.findOneAndUpdate(
        { title: row.book, subject: row.subject || row.book, className: compactValue(row.className), group: compactValue(row.group) },
        { $setOnInsert: { title: row.book, subject: row.subject || row.book, className: compactValue(row.className), group: compactValue(row.group), createdByUserId: actorId, status: "published" } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      bookCache.set(bookKey, book);
    }
    const chapterKey = `${book._id.toString()}|${normalizeKey(row.chapter)}`;
    let chapter = chapterCache.get(chapterKey);
    if (!chapter) {
      chapter = await Chapter.findOneAndUpdate(
        { bookId: book._id, title: row.chapter },
        { $setOnInsert: { bookId: book._id, title: row.chapter, createdByUserId: actorId, status: "published" } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      chapterCache.set(chapterKey, chapter);
    }

    const existing = await Question.exists({ bookId: book._id, chapterId: chapter._id, text: row.question });
    if (existing) {
      skippedRows.push({ data: row, reason: "Question already exists in the question bank" });
      continue;
    }
    const payload = buildQuestionPayload({ ...row, bookId: book._id.toString(), chapterId: chapter._id.toString() }, actorId);
    questionOps.push({ insertOne: { document: payload } });
    questionRefs.push({ bookId: book._id, chapterId: chapter._id, text: row.question });
  }

  if (questionOps.length) {
    await Question.bulkWrite(questionOps, { ordered: false });
    const inserted = await Question.find({
      $or: questionRefs.map((ref) => ({ bookId: ref.bookId, chapterId: ref.chapterId, text: ref.text })),
    }).select("+correctOption");
    savedQuestions.push(...inserted.map((question) => serializeQuestion(question, true)));
  }

  return {
    importedCount: savedQuestions.length,
    skippedDuplicateCount: skippedRows.length,
    invalidCount: 0,
    rows: preview.rows,
    skippedRows,
    questions: savedQuestions,
    summary: `${savedQuestions.length} imported, ${skippedRows.length} duplicate skipped.`,
  };
}

async function listQuestionPapers(filters = {}, { memberOnly = false } = {}) {
  const query = {};
  if (filters.bookId) query.bookId = filters.bookId;
  if (filters.chapterId) query.chapterIds = filters.chapterId;
  if (memberOnly) {
    query.status = "published";
    applyAvailablePaperWindow(query);
    if (filters.memberUserId) {
      const completedAttempts = await ExamAttempt.find({
        memberUserId: filters.memberUserId,
        status: "submitted",
      }).select("questionPaperId");
      const completedPaperIds = completedAttempts.map((attempt) => attempt.questionPaperId);
      if (completedPaperIds.length) query._id = { $nin: completedPaperIds };
    }
  } else if (!filters.includeArchived) {
    query.status = { $ne: "archived" };
  }
  const papers = await QuestionPaper.find(query).sort({ createdAt: -1 }).limit(300);
  const bookIds = [...new Set(papers.map((paper) => paper.bookId.toString()))];
  const books = await Book.find({ _id: { $in: bookIds.map(toId) } });
  const bookMap = new Map(books.map((book) => [book._id.toString(), book]));
  return papers.map((paper) => serializePaper(paper, undefined, bookMap.get(paper.bookId.toString())));
}

async function createQuestionPaper(payload, actorId) {
  const [book, questions] = await Promise.all([
    Book.findById(payload.bookId),
    Question.find({ _id: { $in: payload.questionIds.map(toId) }, status: "active" }),
  ]);
  if (!book) return { error: "BOOK_NOT_FOUND" };
  if (questions.length !== payload.questionIds.length) return { error: "QUESTION_SELECTION_INVALID" };
  if (questions.some((question) => question.bookId.toString() !== payload.bookId)) return { error: "QUESTION_BOOK_MISMATCH" };
  if (payload.passMark > payload.totalMarks) return { error: "PASS_MARK_EXCEEDS_TOTAL" };
  const paper = await QuestionPaper.create({
    title: payload.title,
    bookId: payload.bookId,
    chapterIds: payload.chapterIds?.length ? payload.chapterIds : [...new Set(questions.map((question) => question.chapterId.toString()))],
    durationMinutes: payload.durationMinutes,
    totalMarks: payload.totalMarks,
    passMark: payload.passMark,
    availableFrom: payload.availableFrom,
    availableUntil: payload.availableUntil,
    questions: payload.questionIds.map((questionId) => ({ questionId, marks: Math.max(1, payload.totalMarks / payload.questionIds.length) })),
    status: payload.status,
    createdByUserId: actorId,
  });
  return { paper: serializePaper(paper, undefined, book) };
}

async function updateQuestionPaper(id, payload) {
  const update = { ...payload };
  const currentPaper = await QuestionPaper.findById(id);
  if (!currentPaper) return null;
  const totalMarks = payload.totalMarks || currentPaper.totalMarks;
  const passMark = payload.passMark || currentPaper.passMark;
  if (passMark > totalMarks) return { error: "PASS_MARK_EXCEEDS_TOTAL" };
  if (payload.questionIds) {
    const bookId = payload.bookId || currentPaper.bookId.toString();
    const questions = await Question.find({ _id: { $in: payload.questionIds.map(toId) }, status: "active" });
    if (questions.length !== payload.questionIds.length) return { error: "QUESTION_SELECTION_INVALID" };
    if (questions.some((question) => question.bookId.toString() !== bookId)) return { error: "QUESTION_BOOK_MISMATCH" };
    update.questions = payload.questionIds.map((questionId) => ({ questionId, marks: Math.max(1, totalMarks / payload.questionIds.length) }));
    update.chapterIds = payload.chapterIds?.length ? payload.chapterIds : [...new Set(questions.map((question) => question.chapterId.toString()))];
    delete update.questionIds;
  }
  const paper = await QuestionPaper.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  if (!paper) return null;
  const book = await Book.findById(paper.bookId);
  return serializePaper(paper, undefined, book);
}

async function deleteQuestionPaper(id) {
  const paper = await QuestionPaper.findById(id);
  if (!paper) return null;
  const attemptCount = await ExamAttempt.countDocuments({ questionPaperId: paper._id });
  if (attemptCount > 0) {
    const archiveSuffix = `archived-${paper._id.toString().slice(-6)}`;
    const archivedTitle = paper.title.includes(archiveSuffix) ? paper.title : `${paper.title} (${archiveSuffix})`;
    const archived = await QuestionPaper.findByIdAndUpdate(
      paper._id,
      { status: "archived", title: archivedTitle, availableUntil: new Date() },
      { new: true, runValidators: true }
    );
    const book = await Book.findById(archived.bookId);
    return { deletedMode: "archived", questionPaper: serializePaper(archived, undefined, book), attemptCount };
  }
  await QuestionPaper.deleteOne({ _id: paper._id });
  return { deletedMode: "deleted", questionPaperId: paper._id.toString(), attemptCount };
}

async function startAttempt(paperId, memberUserId) {
  const paper = await QuestionPaper.findOne({ _id: paperId, status: "published" });
  if (!paper) return { error: "QUESTION_PAPER_NOT_FOUND" };
  if (!isPaperOpen(paper)) return { error: "QUESTION_PAPER_NOT_OPEN" };
  const submitted = await ExamAttempt.exists({ memberUserId, questionPaperId: paper._id, status: "submitted" });
  if (submitted) return { error: "EXAM_ALREADY_SUBMITTED" };
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
