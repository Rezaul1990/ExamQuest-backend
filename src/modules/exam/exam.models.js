const mongoose = require("mongoose");

const STATUS = ["draft", "published", "archived"];
const QUESTION_STATUS = ["active", "inactive"];
const DIFFICULTY = ["easy", "medium", "hard"];
const OPTIONS = ["A", "B", "C", "D"];
const GROUPS = ["Science", "Humanities", "BusinessStudies"];

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    className: { type: String, trim: true, index: true },
    group: { type: String, enum: GROUPS, index: true },
    eligibleGroups: [{ type: String, enum: GROUPS }],
    status: { type: String, enum: STATUS, default: "published", index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

bookSchema.index({ title: 1, subject: 1, className: 1, group: 1 }, { unique: true });

const chapterSchema = new mongoose.Schema(
  {
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true, index: true },
    title: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    status: { type: String, enum: STATUS, default: "published", index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

chapterSchema.index({ bookId: 1, title: 1 }, { unique: true });

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, enum: OPTIONS, required: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true, index: true },
    chapterId: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", required: true, index: true },
    text: { type: String, required: true, trim: true },
    identityKey: { type: String },
    reviewStatus: { type: String, enum: ["draft", "reviewed", "approved"], default: "draft" },
    options: { type: [optionSchema], required: true },
    correctOption: { type: String, enum: OPTIONS, required: true, select: false },
    explanation: { type: String, trim: true },
    difficulty: { type: String, enum: DIFFICULTY, default: "medium", index: true },
    status: { type: String, enum: QUESTION_STATUS, default: "active", index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

questionSchema.index({ bookId: 1, chapterId: 1, text: 1 }, { unique: true });
questionSchema.index({ identityKey: 1 }, { unique: true, sparse: true });

const paperQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    marks: { type: Number, required: true, min: 0.001, default: 1 },
  },
  { _id: false }
);

const snapshotSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  text: { type: String, required: true },
  options: [optionSchema],
  difficulty: String,
  chapterId: mongoose.Schema.Types.ObjectId,
  marks: Number,
}, { _id: false });
const answerKeySchema = new mongoose.Schema({ questionId: mongoose.Schema.Types.ObjectId, correctOption: String, explanation: String }, { _id: false });

const questionPaperSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true, index: true },
    chapterIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chapter", index: true }],
    eligibleGroups: [{ type: String, enum: GROUPS, index: true }],
    durationMinutes: { type: Number, required: true, min: 1, max: 300 },
    totalMarks: { type: Number, required: true, min: 1 },
    passMark: { type: Number, required: true, min: 1 },
    questions: { type: [paperQuestionSchema], required: true },
    reviewStatus: { type: String, enum: ["draft", "reviewed", "approved"], default: "draft" },
    snapshotVersion: Number,
    reviewDigest: { type: String, select: false },
    questionSnapshots: { type: [snapshotSchema], default: undefined },
    answerKey: { type: [answerKeySchema], select: false, default: undefined },
    academicContext: { className: String, subject: String, bookTitle: String },
    originalTitle: String,
    resultsReleaseScheduledAt: Date,
    availableFrom: { type: Date, index: true },
    availableUntil: { type: Date, index: true },
    status: { type: String, enum: STATUS, default: "draft", index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

questionPaperSchema.index({ bookId: 1, title: 1 }, { unique: true });

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    selectedOption: { type: String, enum: OPTIONS },
    correctOption: { type: String, enum: OPTIONS },
    isCorrect: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: 0 },
  },
  { _id: false }
);

const examAttemptSchema = new mongoose.Schema(
  {
    memberUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    questionPaperId: { type: mongoose.Schema.Types.ObjectId, ref: "QuestionPaper", required: true, index: true },
    answers: [answerSchema],
    paperSnapshotVersion: Number,
    presentation: { type: [{ _id: false, questionId: { type: mongoose.Schema.Types.ObjectId, required: true }, optionKeys: [{ type: String, enum: OPTIONS }] }], default: undefined },
    activeKey: String,
    expiresAt: { type: Date, index: true },
    answerRevision: { type: Number, default: 0 },
    reviewQuestionIds: [{ type: mongoose.Schema.Types.ObjectId }],
    submissionMode: { type: String, enum: ["manual", "timer_expired"] },
    expiryReason: String,
    score: { type: Number, default: 0 },
    total: { type: Number, required: true },
    percentage: { type: Number, default: 0 },
    status: { type: String, enum: ["in_progress", "submitted", "expired"], default: "in_progress", index: true },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

examAttemptSchema.index({ memberUserId: 1, questionPaperId: 1, status: 1 });
examAttemptSchema.index({ activeKey: 1 }, { unique: true, sparse: true, name: 'unique_active_attempt' });

// Authoritative successful submission AND quota are one atomic persisted document.
const submissionSchema = new mongoose.Schema({
  memberUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
  questionPaperId: { type: mongoose.Schema.Types.ObjectId, required: true },
  attemptId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dayKey: { type: String, required: true },
  paperTitle: String,
  academicContext: { className: String, eligibleGroups: [String] },
  answers: [answerSchema], score: Number, total: Number, percentage: Number,
  startedAt: Date, expiresAt: Date, submittedAt: { type: Date, required: true },
  submissionMode: { type: String, enum: ['manual','timer_expired'], required: true },
  paperSnapshotVersion: Number,
}, { timestamps: true });
submissionSchema.index({ memberUserId: 1, dayKey: 1 }, { unique: true, name: 'one_submission_per_dhaka_day' });
submissionSchema.index({ memberUserId: 1, questionPaperId: 1 }, { unique: true, name: 'one_submission_per_paper' });
submissionSchema.index({ attemptId: 1 }, { unique: true, name: 'idempotent_attempt_submission' });

module.exports = {
  Book: mongoose.model("Book", bookSchema),
  Chapter: mongoose.model("Chapter", chapterSchema),
  Question: mongoose.model("Question", questionSchema),
  QuestionPaper: mongoose.model("QuestionPaper", questionPaperSchema),
  ExamAttempt: mongoose.model("ExamAttempt", examAttemptSchema),
  ExamSubmission: mongoose.model("ExamSubmission", submissionSchema),
  EXAM_OPTIONS: OPTIONS,
};
