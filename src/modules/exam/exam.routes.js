const express = require("express");
const { authenticate, authorizePermissions, authorizeRoles } = require("../../middleware/authenticate");
const { PERMISSIONS, ROLES } = require("../auth/auth.constants");
const controller = require("./exam.controller");
const {
  validate,
  bookSchema,
  bookUpdateSchema,
  chapterSchema,
  chapterUpdateSchema,
  questionSchema,
  questionUpdateSchema,
  importPreviewSchema,
  importCommitSchema,
  questionPaperSchema,
  questionPaperUpdateSchema,
  publishSchema,
  submitAttemptSchema, saveAnswersSchema, generateSchema, paperReviewSchema, questionReviewSchema,
} = require("./exam.validation");

const router = express.Router();

router.use(authenticate);
router.use('/admin', authorizeRoles(ROLES.ADMIN, ROLES.STAFF));
router.use("/admin", require("./exam.scope").enforceContentScope);
const learning = require('./exam.learning-controller');
const { authLimiter } = require('../../middleware/rateLimits');
router.get('/admin/student-reports', authorizeRoles(ROLES.ADMIN), learning.reports);
router.patch('/admin/student-reports/:id', authorizeRoles(ROLES.ADMIN), learning.resolve);
router.post('/admin/question-papers/:id/release-results', authorizeRoles(ROLES.ADMIN), learning.release);
router.use('/learning', authorizeRoles(ROLES.MEMBER));
router.get('/learning', learning.overview);
router.get('/learning/discovery', learning.discovery);
router.put('/learning/papers/:id/reminder', learning.reminder);
router.get('/learning/attempts/:id/review', learning.review);
router.put('/learning/attempts/:id/questions/:questionId/bookmark', learning.bookmark);
router.put('/learning/attempts/:id/questions/:questionId/report', authLimiter, learning.report);
router.get('/admin/question-analytics', require('./exam.bank-controller').adminOnly, require('./exam.bank-controller').analytics);

router.get("/admin/books", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listAdminBooks);
router.post("/admin/books", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(bookSchema), controller.createBook);
router.patch("/admin/books/:id", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(bookUpdateSchema), controller.updateBook);
router.get("/admin/books/:bookId/chapters", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listAdminChapters);
router.post("/admin/chapters", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(chapterSchema), controller.createChapter);
router.patch("/admin/chapters/:id", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(chapterUpdateSchema), controller.updateChapter);
router.get("/admin/questions", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), controller.listAdminQuestions);
router.post("/admin/questions", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(questionSchema), controller.createQuestion);
router.patch("/admin/questions/:id", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(questionUpdateSchema), controller.updateQuestion);
router.delete("/admin/questions/:id", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), controller.deleteQuestion);
router.post("/admin/questions/import/preview", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(importPreviewSchema), controller.previewImport);
router.post("/admin/questions/import/commit", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(importCommitSchema), controller.commitImport);
router.get("/admin/question-papers/candidates", authorizePermissions(PERMISSIONS.EXAM_MANAGE), controller.listCandidates);
router.post("/admin/question-papers/generate", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(generateSchema), controller.generateQuestions);
router.get("/admin/question-papers/:id/preview", authorizePermissions(PERMISSIONS.EXAM_MANAGE), controller.previewPaper);
router.post("/admin/question-papers/:id/review", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(paperReviewSchema), controller.reviewPaper);
router.post("/admin/questions/:id/review", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(questionReviewSchema), controller.reviewQuestion);
router.get("/admin/question-papers", authorizePermissions(PERMISSIONS.EXAM_MANAGE), controller.listAdminQuestionPapers);
router.post("/admin/question-papers", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(questionPaperSchema), controller.createQuestionPaper);
router.patch("/admin/question-papers/:id", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(questionPaperUpdateSchema), controller.updateQuestionPaper);
router.post("/admin/question-papers/:id/status", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(publishSchema), controller.updateQuestionPaperStatus);
router.delete("/admin/question-papers/:id", authorizePermissions(PERMISSIONS.EXAM_MANAGE), controller.deleteQuestionPaper);

router.use(['/books','/question-papers','/attempts','/status'], (req,res,next) => req.user.role === 'MEMBER' ? next() : res.status(403).json({success:false,error:'MEMBER_ACCESS_REQUIRED'}));
router.get('/status', authorizePermissions(PERMISSIONS.EXAM_TAKE), controller.examStatus);
router.get('/question-papers/:id', authorizePermissions(PERMISSIONS.EXAM_TAKE), controller.paperDetail);
router.get('/attempts/:id', authorizePermissions(PERMISSIONS.RESULTS_VIEW_OWN), controller.getAttempt);
router.put('/attempts/:id/answers', authorizePermissions(PERMISSIONS.EXAM_TAKE), validate(saveAnswersSchema), controller.saveAnswers);
router.get("/books", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listMemberBooks);
router.get("/books/:bookId/chapters", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listMemberChapters);
router.get("/question-papers", authorizePermissions(PERMISSIONS.EXAM_TAKE), controller.listMemberQuestionPapers);
router.post("/question-papers/:id/start", authorizePermissions(PERMISSIONS.EXAM_TAKE), controller.startAttempt);
router.post("/attempts/:id/submit", authorizePermissions(PERMISSIONS.EXAM_TAKE), validate(submitAttemptSchema), controller.submitAttempt);
router.get("/attempts", authorizePermissions(PERMISSIONS.RESULTS_VIEW_OWN), controller.listAttempts);

module.exports = router;
