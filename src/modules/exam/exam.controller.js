const service = require("./exam.service");

function sendMissing(res, code) {
  return res.status(404).json({ success: false, error: code });
}

function sendRuleError(res, code) {
  return res.status(400).json({ success: false, error: code });
}

async function listAdminBooks(req, res, next) {
  try {
    res.json({ success: true, data: { books: await service.listBooks({ actor: req.user }) } });
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
    const parsed = require('./exam.validation').bankQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'INVALID_BANK_FILTERS' });
    res.json({ success: true, data: { questions: await service.listQuestions(parsed.data, req.user) } });
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
    const result = await service.updateQuestion(req.params.id, req.validatedBody, req.user._id);
    if (!result) return sendMissing(res, "QUESTION_NOT_FOUND");
    if (result.error === 'QUESTION_CHANGED_RELOAD') return res.status(409).json({ success: false, error: result.error });
    if (result.error) return sendMissing(res, result.error);
    res.json({ success: true, data: { question: result } });
  } catch (error) {
    next(error);
  }
}

async function deleteQuestion(req, res, next) {
  try {
    const result = await service.deleteQuestion(req.params.id);
    if (!result) return sendMissing(res, "QUESTION_NOT_FOUND");
    if (result.error) return sendRuleError(res, result.error);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function previewImport(req, res, next) {
  try {
    res.json({ success: true, data: await service.previewImport(req.validatedBody.csvText, req.validatedBody.rowNumbers, req.user) });
  } catch (error) {
    next(error);
  }
}

async function commitImport(req, res, next) {
  try {
    const result = await service.commitImport(req.validatedBody.rows, req.user._id, req.validatedBody.rowNumbers, req.user);
    await require('../auth/auth.audit').audit('CSV_IMPORT_COMMITTED', { actorUserId: req.user._id, metadata: { importedCount: result.importedCount, skippedDuplicateCount: result.skippedDuplicateCount, invalidCount: result.invalidCount, questionIds: result.questions.map((question) => question.id) } });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function listAdminQuestionPapers(req, res, next) {
  try {
    res.json({ success: true, data: { questionPapers: await service.listQuestionPapers(req.query, { actor: req.user }) } });
  } catch (error) {
    next(error);
  }
}

async function createQuestionPaper(req, res, next) {
  try {
    const result = await service.createQuestionPaper(req.validatedBody, req.user);
    if (result.error) return sendRuleError(res, result.error);
    res.status(201).json({ success: true, data: { questionPaper: result.paper } });
  } catch (error) {
    next(error);
  }
}

async function updateQuestionPaper(req, res, next) {
  try {
    const result = await service.updateQuestionPaper(req.params.id, req.validatedBody, req.user);
    if (!result) return sendMissing(res, "QUESTION_PAPER_NOT_FOUND");
    if (result.error) return sendRuleError(res, result.error);
    res.json({ success: true, data: { questionPaper: result } });
  } catch (error) {
    next(error);
  }
}

async function updateQuestionPaperStatus(req, res, next) {
  try {
    const result = await service.updateQuestionPaper(req.params.id, req.validatedBody, req.user);
    if (!result) return sendMissing(res, "QUESTION_PAPER_NOT_FOUND");
    if (result.error) return sendRuleError(res, result.error);
    res.json({ success: true, data: { questionPaper: result } });
  } catch (error) {
    next(error);
  }
}

async function deleteQuestionPaper(req, res, next) {
  try {
    const result = await service.deleteQuestionPaper(req.params.id, req.user);
    if (!result) return sendMissing(res, "QUESTION_PAPER_NOT_FOUND");
    if (result.error) return sendRuleError(res, result.error);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function listMemberBooks(req, res, next) {
  try {
    res.json({ success: true, data: { books: await service.listBooks({ memberOnly: true, actor: req.user }) } });
  } catch (error) {
    next(error);
  }
}

async function listMemberChapters(req, res, next) {
  try {
    res.json({ success: true, data: { chapters: await service.listChapters(req.params.bookId, { memberOnly: true, actor: req.user }) } });
  } catch (error) {
    next(error);
  }
}

async function listMemberQuestionPapers(req, res, next) {
  try {
    res.json({ success: true, data: { questionPapers: await service.listQuestionPapers({ ...req.query, memberUserId: req.user._id }, { memberOnly: true }) } });
  } catch (error) {
    next(error);
  }
}

function sendExamError(res, code, extra = {}) {
  const status = ['ATTEMPT_NOT_FOUND','QUESTION_PAPER_NOT_FOUND'].includes(code) ? 404 : ['DAILY_SUBMISSION_LIMIT','EXAM_ALREADY_SUBMITTED','ATTEMPT_CHANGED_RELOAD','ATTEMPT_EXPIRED'].includes(code) ? 409 : ['MEMBER_ACCESS_REQUIRED','MEMBER_PROFILE_INCOMPLETE','QUESTION_PAPER_NOT_ELIGIBLE'].includes(code) ? 403 : 400;
  return res.status(status).json({ success: false, error: code, ...extra });
}
async function startAttempt(req, res, next) { try {
  const result = await service.startAttempt(req.params.id, req.user._id);
  if (result.error) return sendExamError(res, result.error, result.quota ? { quota: result.quota } : {});
  res.status(result.attempt?.status === 'submitted' ? 200 : 201).json({ success: true, data: result });
} catch (error) { next(error); } }
async function submitAttempt(req, res, next) { try {
  const result = await service.submitAttempt(req.params.id, req.user._id, req.validatedBody.answers, { reason: req.validatedBody.reason });
  if (result.error) return sendExamError(res, result.error);
  res.json({ success: true, data: result });
} catch (error) { next(error); } }
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
  deleteQuestion,
  previewImport,
  commitImport,
  listAdminQuestionPapers,
  createQuestionPaper,
  updateQuestionPaper,
  updateQuestionPaperStatus,
  deleteQuestionPaper,
  listMemberBooks,
  listMemberChapters,
  listMemberQuestionPapers,
  startAttempt,
  submitAttempt,
  listAttempts,
};

const authoring = require('./exam.authoring');
async function generateQuestions(req, res, next) { try {
  const result = await authoring.generateQuestions(req.validatedBody, req.user);
  if (result.error) return sendRuleError(res, result.error);
  res.json({ success: true, data: result });
} catch (error) { next(error); } }
async function previewPaper(req, res, next) { try {
  const result = await authoring.previewPaper(req.params.id, req.user);
  if (result.error) return sendRuleError(res, result.error);
  res.json({ success: true, data: result });
} catch (error) { next(error); } }
async function reviewPaper(req, res, next) { try {
  const result = await authoring.reviewPaper(req.params.id, req.validatedBody.reviewStatus, req.validatedBody.revision, req.user);
  if (result.error) return sendRuleError(res, result.error);
  res.json({ success: true, data: result });
} catch (error) { next(error); } }
async function reviewQuestion(req, res, next) { try {
  const result = await authoring.reviewQuestion(req.params.id, req.validatedBody, req.user);
  if (result.error) return sendRuleError(res, result.error);
  res.json({ success: true, data: { question: service.serializeQuestion(result.question, true) } });
} catch (error) { next(error); } }
Object.assign(module.exports, { generateQuestions, previewPaper, reviewPaper, reviewQuestion });

module.exports.listCandidates = async (req, res, next) => { try {
  const result = await authoring.listCandidates(req.query.bookId, req.user);
  if (result.error) return sendRuleError(res, result.error);
  res.json({ success: true, data: result });
} catch (error) { next(error); } };

const memberExams = require('./exam.member');
module.exports.examStatus = async (req,res,next) => { try {
  const result = await memberExams.quotaStatus(req.user._id);
  if (result.error) return sendExamError(res, result.error);
  res.json({success:true,data:result});
} catch(error){next(error);} };
module.exports.getAttempt = async (req,res,next) => { try {
  const result = await memberExams.getAttempt(req.params.id, req.user._id);
  if(result.error)return sendExamError(res,result.error);
  res.json({success:true,data:result});
} catch(error){next(error);} };
module.exports.saveAnswers = async (req,res,next) => { try {
  const result = await memberExams.saveAnswers(req.params.id,req.user._id,req.validatedBody.answers,req.validatedBody.revision);
  if(result.error)return sendExamError(res,result.error);
  res.json({success:true,data:result});
} catch(error){next(error);} };
module.exports.paperDetail = async (req,res,next) => { try {
  const result = await memberExams.paperDetail(req.params.id,req.user._id);
  if(result.error)return sendExamError(res,result.error);
  res.json({success:true,data:result});
} catch(error){next(error);} };
