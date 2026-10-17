const { createHash } = require("node:crypto");
const { Book, Chapter, Question } = require("./exam.models");
const { scopedBooks } = require("./exam.scope");
const { normalizeAcademicGroup } = require("../academic/academic.constants");
const HEADERS = ["book", "chapter", "question", "optionA", "optionB", "optionC", "optionD", "correctOption", "explanation", "difficulty", "subject", "className", "group"];
const normalize = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const key = (values) => JSON.stringify(values.map(normalize));
const questionIdentity = (bookId, chapterId, text) => createHash("sha256").update(key([String(bookId), String(chapterId), text])).digest("hex");
const optionsKey = (data) => key([data.optionA, data.optionB, data.optionC, data.optionD]);
const bookKey = (data) => key([data.title || data.book, data.subject, data.className, normalizeAcademicGroup(data.group)]);
const questionOptions = (question) => Object.fromEntries(question.options.map((option) => [`option${option.key}`, option.text]));

function parseCsv(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  if (text.length > 500000) return { rows: [], errors: ["CSV exceeds 500000 characters"] };
  const rows = [], errors = [];
  let row = [], field = "", state = "start";
  function pushField() { row.push(field); field = ""; state = "start"; }
  function pushRow() { pushField(); if (row.some((cell) => cell.trim())) rows.push(row); row = []; }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (state === "quoted") {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else state = "closed";
      } else field += ch;
    } else if (ch === ",") pushField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRow();
    } else if (ch === '"' && state === "start") state = "quoted";
    else {
      if (ch === '"' || state === "closed") errors.push(`Malformed quote at CSV record ${rows.length + 1}`);
      field += ch; state = "plain";
    }
  }
  if (state === "quoted") errors.push("Malformed CSV: unclosed quoted field");
  if (field || row.length || state !== "start") pushRow();
  return { rows, errors: [...new Set(errors)] };
}

function summarize(preview) {
  preview.validRows = preview.errors.length ? [] : preview.rows.filter((row) => !row.errors.length).map((row) => row.data);
  preview.validCount = preview.validRows.length;
  preview.invalidCount = preview.rows.filter((row) => row.errors.length).length;
  preview.duplicateCount = preview.rows.filter((row) => row.duplicate).length;
  return preview;
}

function validateRecords(parsed, rowNumbers) {
  const errors = [...parsed.errors];
  const [headers = [], ...records] = parsed.rows;
  if (headers.length !== HEADERS.length || HEADERS.some((header, i) => headers[i] !== header)) errors.push(`CSV header must exactly match: ${HEADERS.join(",")}`);
  if (rowNumbers && rowNumbers.length !== records.length) errors.push("Row numbers must match CSV data records");
  if (!records.length) errors.push("CSV requires at least one data row");
  if (records.length > 50) errors.push("CSV supports a maximum of 50 data rows");
  const seen = new Map();
  const rows = records.map((cells, i) => {
    const data = Object.fromEntries(HEADERS.map((header, j) => [header, String(cells[j] || "").trim()]));
    const rowNumber = rowNumbers?.[i] ?? i + 2;
    const rowErrors = [];
    if (cells.length !== HEADERS.length) rowErrors.push(`Expected 13 columns but found ${cells.length}`);
    data.correctOption = data.correctOption.toUpperCase();
    data.difficulty = (data.difficulty || "medium").toLowerCase();
    const group = normalizeAcademicGroup(data.group);
    if (data.group && !group) rowErrors.push("group must be Science, Humanities or BusinessStudies");
    if (group) data.group = group;
    const limits = { book: [2,160], chapter: [1,160], question: [4,2000], optionA: [1,500], optionB: [1,500], optionC: [1,500], optionD: [1,500], explanation: [0,2000], subject: [1,120], className: [1,120], group: [1,120] };
    for (const [name, [min, max]] of Object.entries(limits)) {
      if (data[name].length < min) rowErrors.push(`${name} requires at least ${min} characters`);
      if (data[name].length > max) rowErrors.push(`${name} exceeds ${max} characters`);
    }
    if (!["A","B","C","D"].includes(data.correctOption)) rowErrors.push("correctOption must be A, B, C or D");
    if (!["easy","medium","hard"].includes(data.difficulty)) rowErrors.push("difficulty must be easy, medium or hard");
    const duplicateKey = key([bookKey(data), data.chapter, data.question, optionsKey(data)]);
    const duplicate = seen.has(duplicateKey);
    if (duplicate) rowErrors.push(`Duplicate of CSV row ${seen.get(duplicateKey)}`);
    else if (!rowErrors.length) seen.set(duplicateKey, rowNumber);
    return { rowNumber, data, errors: rowErrors, duplicate };
  });
  return summarize({ rows, errors });
}

async function checkDatabase(preview, actor) {
  if (preview.errors.length) return { preview, references: new Map() };
  // Match normalized labels in memory, including legacy aliases; never invent taxonomy.
  const books = await Book.find({ status: { $ne: "archived" }, ...scopedBooks(actor) });
  const bookMap = new Map();
  for (const book of books) {
    const groups = new Set((book.eligibleGroups?.length ? book.eligibleGroups : [book.group]).map(normalizeAcademicGroup).filter(Boolean));
    for (const group of groups) {
      const k = bookKey({ title: book.title, subject: book.subject, className: book.className, group });
      bookMap.set(k, [...(bookMap.get(k) || []), book]);
    }
  }
  const relevantIds = new Set(preview.rows.flatMap((row) => (bookMap.get(bookKey(row.data)) || []).map((book) => String(book._id))));
  const relevantBooks = books.filter((book) => relevantIds.has(String(book._id)));
  const chapters = relevantBooks.length ? await Chapter.find({ bookId: { $in: relevantBooks.map((book) => book._id) }, status: { $ne: "archived" } }) : [];
  const questions = chapters.length ? await Question.find({ chapterId: { $in: chapters.map((chapter) => chapter._id) } }) : [];
  const references = new Map();
  for (const row of preview.rows) {
    if (row.errors.length && !row.duplicate) continue;
    const matches = bookMap.get(bookKey(row.data)) || [];
    if (matches.length !== 1) { row.errors.push(matches.length ? "Academic book mapping is ambiguous; contact an administrator" : "Unknown book/subject/class/group mapping; create the book first"); continue; }
    const book = matches[0];
    const chapterMatches = chapters.filter((chapter) => String(chapter.bookId) === String(book._id) && normalize(chapter.title) === normalize(row.data.chapter));
    if (chapterMatches.length !== 1) { row.errors.push("Unknown or ambiguous chapter for this book; create or correct the chapter first"); continue; }
    const chapter = chapterMatches[0];
    references.set(row.rowNumber, { book, chapter });
    const sameText = questions.filter((q) => String(q.chapterId) === String(chapter._id) && normalize(q.text) === normalize(row.data.question));
    const exact = sameText.find((q) => optionsKey(questionOptions(q)) === optionsKey(row.data));
    if (exact) { row.duplicate = true; row.existingQuestionId = String(exact._id); row.errors.push("Question already exists in the question bank"); }
    else if (sameText.length) row.errors.push("Question text exists with different options; review the bank question (not an exact duplicate)");
  }
  return { preview: summarize(preview), references };
}

async function previewImport(csvText, rowNumbers, actor) {
  return (await checkDatabase(validateRecords(parseCsv(csvText), rowNumbers), actor)).preview;
}

async function commitImport(rows, actorId, rowNumbers, actor) {
  const { preview, references } = await checkDatabase(validateRecords({ rows: [HEADERS, ...rows.map((row) => HEADERS.map((header) => row[header] || ""))], errors: [] }, rowNumbers), actor);
  const questions = [], skippedRows = [];
  // Await the sparse unique identity index before accepting concurrent writes.
  await Question.init();
  if (!preview.errors.length) for (const row of preview.rows) {
    if (row.duplicate) { skippedRows.push({ rowNumber: row.rowNumber, data: row.data, reason: row.errors.join("; ") }); continue; }
    if (row.errors.length) continue;
    const { book, chapter } = references.get(row.rowNumber);
    const data = row.data;
    const identityKey = questionIdentity(book._id, chapter._id, data.question);
    try {
      const question = await Question.create({
        bookId: book._id, chapterId: chapter._id, identityKey, text: data.question,
        options: ["A","B","C","D"].map((k) => ({ key: k, text: data[`option${k}`] })),
        correctOption: data.correctOption, explanation: data.explanation, difficulty: data.difficulty,
        status: "active", createdByUserId: actorId,
      });
      questions.push({ reviewStatus: question.reviewStatus, revision: question.__v || 0, id: String(question._id), bookId: String(book._id), chapterId: String(chapter._id), text: question.text, options: question.options, correctOption: question.correctOption, explanation: question.explanation, difficulty: question.difficulty, status: question.status });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await Question.findOne({ $or: [{ identityKey }, { bookId: book._id, chapterId: chapter._id, text: data.question }] });
      if (!existing) throw error;
      if (optionsKey(questionOptions(existing)) === optionsKey(data)) {
        row.duplicate = true; row.existingQuestionId = String(existing._id); row.errors.push("Concurrent import: question already exists");
        skippedRows.push({ rowNumber: row.rowNumber, data, reason: "Concurrent duplicate skipped" });
      } else row.errors.push("Concurrent question text conflict with different options; review required");
    }
  }
  return {
    importedCount: questions.length, skippedDuplicateCount: skippedRows.length,
    invalidCount: preview.rows.filter((row) => row.errors.length && !row.duplicate).length,
    rows: preview.rows, errors: preview.errors, skippedRows, questions,
    summary: preview.errors.length ? preview.errors.join("; ") : `${questions.length} imported, ${skippedRows.length} duplicate skipped, ${preview.rows.filter((row) => row.errors.length && !row.duplicate).length} invalid.`,
  };
}
module.exports = { HEADERS, normalize, questionIdentity, parseCsv, validateRecords, previewImport, commitImport };
