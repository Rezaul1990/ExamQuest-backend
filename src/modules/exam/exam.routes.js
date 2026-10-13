const express = require("express");
const { authenticate, authorizePermissions } = require("../../middleware/authenticate");
const { PERMISSIONS } = require("../auth/auth.constants");
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
  submitAttemptSchema,
} = require("./exam.validation");

const router = express.Router();

router.use(authenticate);

router.get("/admin/books", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listAdminBooks);
router.post("/admin/books", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(bookSchema), controller.createBook);
router.patch("/admin/books/:id", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(bookUpdateSchema), controller.updateBook);
router.get("/admin/books/:bookId/chapters", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listAdminChapters);
router.post("/admin/chapters", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(chapterSchema), controller.createChapter);
router.patch("/admin/chapters/:id", authorizePermissions(PERMISSIONS.CONTENT_MANAGE), validate(chapterUpdateSchema), controller.updateChapter);
router.get("/admin/questions", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), controller.listAdminQuestions);
router.post("/admin/questions", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(questionSchema), controller.createQuestion);
router.patch("/admin/questions/:id", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(questionUpdateSchema), controller.updateQuestion);
router.post("/admin/questions/import/preview", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(importPreviewSchema), controller.previewImport);
router.post("/admin/questions/import/commit", authorizePermissions(PERMISSIONS.QUESTION_MANAGE), validate(importCommitSchema), controller.commitImport);
router.get("/admin/question-papers", authorizePermissions(PERMISSIONS.EXAM_MANAGE), controller.listAdminQuestionPapers);
router.post("/admin/question-papers", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(questionPaperSchema), controller.createQuestionPaper);
router.patch("/admin/question-papers/:id", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(questionPaperUpdateSchema), controller.updateQuestionPaper);
router.post("/admin/question-papers/:id/status", authorizePermissions(PERMISSIONS.EXAM_MANAGE), validate(publishSchema), controller.updateQuestionPaperStatus);

router.get("/books", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listMemberBooks);
router.get("/books/:bookId/chapters", authorizePermissions(PERMISSIONS.CONTENT_READ), controller.listMemberChapters);
router.get("/question-papers", authorizePermissions(PERMISSIONS.EXAM_TAKE), controller.listMemberQuestionPapers);
router.post("/question-papers/:id/start", authorizePermissions(PERMISSIONS.EXAM_TAKE), controller.startAttempt);
router.post("/attempts/:id/submit", authorizePermissions(PERMISSIONS.EXAM_TAKE), validate(submitAttemptSchema), controller.submitAttempt);
router.get("/attempts", authorizePermissions(PERMISSIONS.RESULTS_VIEW_OWN), controller.listAttempts);

module.exports = router;
