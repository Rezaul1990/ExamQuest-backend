const mongoose = require("mongoose");

const STATUS = ["draft", "published", "archived"];
const QUESTION_STATUS = ["active", "inactive"];
const DIFFICULTY = ["easy", "medium", "hard"];
const OPTIONS = ["A", "B", "C", "D"];

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    className: { type: String, trim: true, index: true },
    group: { type: String, trim: true, index: true },
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

const paperQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    marks: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false }
);

const questionPaperSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true, index: true },
    chapterIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chapter", index: true }],
    durationMinutes: { type: Number, required: true, min: 1, max: 300 },
    totalMarks: { type: Number, required: true, min: 1 },
    passMark: { type: Number, required: true, min: 1 },
    questions: { type: [paperQuestionSchema], required: true },
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
    score: { type: Number, default: 0 },
    total: { type: Number, required: true },
    percentage: { type: Number, default: 0 },
    status: { type: String, enum: ["in_progress", "submitted"], default: "in_progress", index: true },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

examAttemptSchema.index({ memberUserId: 1, questionPaperId: 1, status: 1 });

module.exports = {
  Book: mongoose.model("Book", bookSchema),
  Chapter: mongoose.model("Chapter", chapterSchema),
  Question: mongoose.model("Question", questionSchema),
  QuestionPaper: mongoose.model("QuestionPaper", questionPaperSchema),
  ExamAttempt: mongoose.model("ExamAttempt", examAttemptSchema),
  EXAM_OPTIONS: OPTIONS,
};
