const service = require("./exam.service");

function sendMissing(res, code) {
  return res.status(404).json({ success: false, error: code });
}

function sendRuleError(res, code) {
  return res.status(400).json({ success: false, error: code });
}

async function listAdminBooks(req, res, next) {
  try {
    res.json({ success: true, data: { books: await service.listBooks() } });
  } catch (error) {
    next(error);
  }
}

async function createBook(req, res, next) {
  try {
    res.status(201).json({ success: true, data: { book: await service.createBook(req.validatedBody, req.user._id) } });
  } catch (error) {
    next(error);
  }
}

async function updateBook(req, res, next) {
  try {
    const book = await service.updateBook(req.params.id, req.validatedBody);
    if (!book) return sendMissing(res, "BOOK_NOT_FOUND");
    res.json({ success: true, data: { book } });
  } catch (error) {
    next(error);
  }
}

async function listAdminChapters(req, res, next) {
  try {
    res.json({ success: true, data: { chapters: await service.listChapters(req.params.bookId) } });
  } catch (error) {
    next(error);
  }
}

async function createChapter(req, res, next) {
  try {
    const result = await service.createChapter(req.validatedBody, req.user._id);
    if (result.error) return sendMissing(res, result.error);
    res.status(201).json({ success: true, data: { chapter: result.chapter } });
  } catch (error) {
    next(error);
  }
}

async function updateChapter(req, res, next) {
  try {
    const chapter = await service.updateChapter(req.params.id, req.validatedBody);
    if (!chapter) return sendMissing(res, "CHAPTER_NOT_FOUND");
    res.json({ success: true, data: { chapter } });
  } catch (error) {
    next(error);
  }
}

async function listAdminQuestions(req, res, next) {
  try {
    res.json({ success: true, data: { questions: await service.listQuestions(req.query) } });
  } catch (error) {
    next(error);
  }
}

async function createQuestion(req, res, next) {
  try {
    const result = await service.createQuestion(req.validatedBody, req.user._id);
    if (result.error) return sendMissing(res, result.error);
    res.status(201).json({ success: true, data: { question: result.question } });
  } catch (error) {
    next(error);
  }
}

async function updateQuestion(req, res, next) {
  try {
    const result = await service.updateQuestion(req.params.id, req.validatedBody);
    if (!result) return sendMissing(res, "QUESTION_NOT_FOUND");
    if (result.error) return sendMissing(res, result.error);
    res.json({ success: true, data: { question: result } });
  } catch (error) {
    next(error);
  }
}

async function previewImport(req, res, next) {
  try {
    res.json({ success: true, data: service.previewImport(req.validatedBody.csvText) });
  } catch (error) {
    next(error);
  }
}

async function commitImport(req, res, next) {
  try {
    const questions = await service.commitImport(req.validatedBody.rows, req.user._id);
    res.status(201).json({ success: true, data: { importedCount: questions.length, questions } });
  } catch (error) {
    next(error);
  }
}

async function listAdminQuestionPapers(req, res, next) {
  try {
    res.json({ success: true, data: { questionPapers: await service.listQuestionPapers(req.query) } });
  } catch (error) {
    next(error);
  }
}

async function createQuestionPaper(req, res, next) {
  try {
    const result = await service.createQuestionPaper(req.validatedBody, req.user._id);
    if (result.error) return sendRuleError(res, result.error);
    res.status(201).json({ success: true, data: { questionPaper: result.paper } });
  } catch (error) {
    next(error);
  }
}

async function updateQuestionPaper(req, res, next) {
  try {
    const result = await service.updateQuestionPaper(req.params.id, req.validatedBody);
    if (!result) return sendMissing(res, "QUESTION_PAPER_NOT_FOUND");
    if (result.error) return sendRuleError(res, result.error);
    res.json({ success: true, data: { questionPaper: result } });
  } catch (error) {
    next(error);
  }
}

async function updateQuestionPaperStatus(req, res, next) {
  try {
    const result = await service.updateQuestionPaper(req.params.id, req.validatedBody);
    if (!result) return sendMissing(res, "QUESTION_PAPER_NOT_FOUND");
    res.json({ success: true, data: { questionPaper: result } });
  } catch (error) {
    next(error);
  }
}

async function listMemberBooks(req, res, next) {
  try {
    res.json({ success: true, data: { books: await service.listBooks({ memberOnly: true }) } });
  } catch (error) {
    next(error);
  }
}

async function listMemberChapters(req, res, next) {
  try {
    res.json({ success: true, data: { chapters: await service.listChapters(req.params.bookId, { memberOnly: true }) } });
  } catch (error) {
    next(error);
  }
}

async function listMemberQuestionPapers(req, res, next) {
  try {
    res.json({ success: true, data: { questionPapers: await service.listQuestionPapers(req.query, { memberOnly: true }) } });
  } catch (error) {
    next(error);
  }
}

async function startAttempt(req, res, next) {
  try {
    const result = await service.startAttempt(req.params.id, req.user._id);
    if (result.error) return sendMissing(res, result.error);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function submitAttempt(req, res, next) {
  try {
    const result = await service.submitAttempt(req.params.id, req.user._id, req.validatedBody.answers);
    if (result.error === "ATTEMPT_ALREADY_SUBMITTED") return sendRuleError(res, result.error);
    if (result.error) return sendMissing(res, result.error);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function listAttempts(req, res, next) {
  try {
    res.json({ success: true, data: { attempts: await service.listAttempts(req.user._id) } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listAdminBooks,
  createBook,
  updateBook,
  listAdminChapters,
  createChapter,
  updateChapter,
  listAdminQuestions,
  createQuestion,
  updateQuestion,
  previewImport,
  commitImport,
  listAdminQuestionPapers,
  createQuestionPaper,
  updateQuestionPaper,
  updateQuestionPaperStatus,
  listMemberBooks,
  listMemberChapters,
  listMemberQuestionPapers,
  startAttempt,
  submitAttempt,
  listAttempts,
};
