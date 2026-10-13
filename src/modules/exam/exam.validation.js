const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const status = z.enum(["draft", "published", "archived"]);
const activeStatus = z.enum(["active", "inactive"]);
const optionKey = z.enum(["A", "B", "C", "D"]);
const difficulty = z.enum(["easy", "medium", "hard"]);

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(120).optional()
);

const bookSchema = z.object({
  title: z.string().trim().min(2).max(160),
  subject: z.string().trim().min(2).max(120),
  className: optionalText,
  group: optionalText,
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

const questionUpdateSchema = questionSchema.partial().refine((data) => Object.keys(data).length > 0, "At least one field is required");

const importPreviewSchema = z.object({
  csvText: z.string().min(1).max(500000),
});

const importCommitSchema = z.object({
  rows: z.array(
    z.object({
      book: z.string().trim().min(2).max(160),
      chapter: z.string().trim().min(1).max(160),
      question: z.string().trim().min(4).max(2000),
      optionA: z.string().trim().min(1).max(500),
      optionB: z.string().trim().min(1).max(500),
      optionC: z.string().trim().min(1).max(500),
      optionD: z.string().trim().min(1).max(500),
      correctOption: optionKey,
      explanation: z.string().trim().max(2000).optional().or(z.literal("")),
      difficulty: difficulty.default("medium"),
      subject: z.string().trim().max(120).optional().or(z.literal("")),
      className: z.string().trim().max(120).optional().or(z.literal("")),
      group: z.string().trim().max(120).optional().or(z.literal("")),
    })
  ).min(1).max(1000),
});

const questionPaperBaseSchema = z.object({
  title: z.string().trim().min(2).max(180),
  bookId: objectId,
  chapterIds: z.array(objectId).default([]),
  durationMinutes: z.coerce.number().int().min(1).max(300),
  totalMarks: z.coerce.number().int().min(1).max(1000),
  questionIds: z.array(objectId).min(1).max(200),
  availableFrom: z.coerce.date().optional(),
  availableUntil: z.coerce.date().optional(),
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
  status: z.enum(["draft", "published", "archived"]),
  availableFrom: z.coerce.date().optional(),
  availableUntil: z.coerce.date().optional(),
}).refine((data) => !data.availableFrom || !data.availableUntil || data.availableUntil > data.availableFrom, {
  path: ["availableUntil"],
  message: "availableUntil must be after availableFrom",
});
const submitAttemptSchema = z.object({
  answers: z.array(z.object({ questionId: objectId, selectedOption: optionKey })).default([]),
});

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
};
