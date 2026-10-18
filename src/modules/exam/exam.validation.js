const { z } = require("zod");
const { normalizeAcademicGroup } = require("../academic/academic.constants");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const status = z.enum(["draft", "published", "archived"]);
const activeStatus = z.enum(["active", "inactive"]);
const optionKey = z.enum(["A", "B", "C", "D"]);
const difficulty = z.enum(["easy", "medium", "hard"]);
const academicGroup = z.string().trim().transform(normalizeAcademicGroup).refine(Boolean, "Select a valid academic group");

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(120).optional()
);

const bookSchema = z.object({
  title: z.string().trim().min(2).max(160),
  subject: z.string().trim().min(2).max(120),
  className: optionalText,
  group: academicGroup.optional(),
  eligibleGroups: z.array(academicGroup).min(1).max(3).optional(),
  status: status.default("published"),
});

const bookUpdateSchema = bookSchema.partial().refine((data) => Object.keys(data).length > 0, "At least one field is required");

const chapterSchema = z.object({
  bookId: objectId,
  title: z.string().trim().min(1).max(160),
  order: z.coerce.number().int().min(0).max(999).default(0),
  status: status.default("published"),
});

const chapterUpdateSchema = chapterSchema
  .omit({ bookId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, "At least one field is required");

const questionSchema = z.object({
  bookId: objectId,
  chapterId: objectId,
  text: z.string().trim().min(4).max(2000),
  optionA: z.string().trim().min(1).max(500),
  optionB: z.string().trim().min(1).max(500),
  optionC: z.string().trim().min(1).max(500),
  optionD: z.string().trim().min(1).max(500),
  correctOption: optionKey,
  explanation: z.string().trim().max(2000).optional().or(z.literal("")),
  difficulty: difficulty.default("medium"),
  status: activeStatus.default("active"),
});

const questionUpdateSchema = questionSchema.partial().extend({ revision: z.number().int().min(0).optional() }).strict().refine((data) => Object.keys(data).some((key) => key !== 'revision'), "At least one field is required");

const bankQuerySchema = z.object({
  bookId: objectId.optional(), chapterId: objectId.optional(),
  q: z.string().trim().max(120).optional(), difficulty: difficulty.optional(),
  status: activeStatus.optional(), reviewStatus: z.enum(['draft', 'reviewed', 'approved']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(500),
}).strict();

const rowNumbers = z.array(z.number().int().min(2).max(1000000)).min(1).max(50).refine((values) => new Set(values).size === values.length, "Row numbers must be unique").optional();
const importPreviewSchema = z.object({
  csvText: z.string().min(1).max(500000),
  rowNumbers,
});

// Structural request validation only: semantic row issues belong in the receipt.
const importCell = z.string().max(500000).default("");
const importCommitSchema = z.object({
  rowNumbers,
  rows: z.array(z.object({
    book: importCell, chapter: importCell, question: importCell,
    optionA: importCell, optionB: importCell, optionC: importCell, optionD: importCell,
    correctOption: importCell, explanation: importCell, difficulty: importCell,
    subject: importCell, className: importCell, group: importCell,
  })).min(1).max(50),
}).refine((data) => !data.rowNumbers || data.rowNumbers.length === data.rows.length, "Row numbers must match rows");

const questionPaperBaseSchema = z.object({
  title: z.string().trim().min(2).max(180),
  bookId: objectId,
  chapterIds: z.array(objectId).default([]),
  eligibleGroups: z.array(academicGroup).min(1).max(3),
  revision: z.number().int().min(0).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(300),
  totalMarks: z.coerce.number().int().min(1).max(1000),
  passMark: z.coerce.number().int().min(1).max(1000),
  questionIds: z.array(objectId).min(1).max(200),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  status: status.default("draft"),
});

const availabilityWindowIsValid = (data) => !data.availableFrom || !data.availableUntil || data.availableUntil > data.availableFrom;
const availabilityWindowMessage = {
  path: ["availableUntil"],
  message: "availableUntil must be after availableFrom",
};

const questionPaperSchema = questionPaperBaseSchema.refine(availabilityWindowIsValid, availabilityWindowMessage);
const questionPaperUpdateSchema = questionPaperBaseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, "At least one field is required")
  .refine(availabilityWindowIsValid, availabilityWindowMessage);
const publishSchema = z.object({
  revision: z.number().int().min(0).optional(),
  status: z.enum(["draft", "published", "archived"]),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
}).refine((data) => !data.availableFrom || !data.availableUntil || data.availableUntil > data.availableFrom, {
  path: ["availableUntil"],
  message: "availableUntil must be after availableFrom",
});
const generateSchema = z.object({
  bookId: objectId, chapterIds: z.array(objectId).min(1).max(200).refine((ids) => new Set(ids).size === ids.length),
  eligibleGroups: z.array(academicGroup).min(1).max(3), count: z.number().int().min(1).max(200),
  difficulty: difficulty.optional(), preferFresh: z.boolean().default(true),
});
const paperReviewSchema = z.object({ reviewStatus: z.enum(["reviewed", "approved"]), revision: z.number().int().min(0) });
const questionReviewSchema = z.object({ reviewStatus: z.enum(["reviewed", "approved"]), revision: z.number().int().min(0) });
const answerList = z.array(z.object({ questionId: objectId, selectedOption: optionKey }).strict()).max(200);
const submitAttemptSchema = z.object({ answers: answerList.default([]), reason: z.enum(['manual','timer_expired']).default('manual') }).strict();
const saveAnswersSchema = z.object({ answers: answerList, revision: z.number().int().min(0), reviewQuestionIds: z.array(objectId).max(200).refine((ids) => new Set(ids).size === ids.length).optional() }).strict();

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        success: false,
        error: "VALIDATION_ERROR",
        details: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    req.validatedBody = result.data;
    return next();
  };
}

module.exports = {
  bankQuerySchema,
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
  submitAttemptSchema, saveAnswersSchema,
  generateSchema, paperReviewSchema, questionReviewSchema,
};
