const { z } = require("zod");
const { normalizeAcademicGroup } = require("../academic/academic.constants");

const email = z.string().email().transform((value) => value.trim().toLowerCase());
const password = z.string().min(10).max(128);
const token = z.string().min(20).max(300);
const academicGroup = z.string().trim().transform(normalizeAcademicGroup).refine(Boolean, "Select a valid academic group");

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    phone: z.string().trim().min(5).max(30),
    password,
    confirmPassword: z.string().min(10).max(128).optional(),
    educationLevel: z.enum(["SSC", "HSC"]),
    className: z.string().trim().min(1).max(80),
    group: academicGroup,
    academicYear: z.coerce.number().int().min(2000).max(2100),
    dateOfBirth: z.coerce.date().optional(),
    parent: z.object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(5).max(30),
      email: email.optional().or(z.literal("")),
      relation: z.enum(["Father", "Mother", "Guardian"]),
    }),
  })
  .strict()
  .refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((data) => data.password.toLowerCase() !== data.email.toLowerCase(), {
    path: ["password"],
    message: "Password must not match email",
  });

const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().max(120).optional(),
  platform: z.string().trim().max(60).optional(),
});

const refreshSchema = z.object({ refreshToken: token });
const tokenSchema = z.object({ token });
const forgotPasswordSchema = z.object({ email });
const resetPasswordSchema = z.object({ token, password });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
const staffInviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
});
const permissionEnum = z.enum([
  "USERS_MANAGE",
  "STAFF_INVITE",
  "CONTENT_READ",
  "CONTENT_MANAGE",
  "QUESTION_MANAGE",
  "EXAM_MANAGE",
  "RESULTS_VIEW_ALL",
  "EXAM_TAKE",
  "RESULTS_VIEW_OWN",
]);
const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  password,
  permissions: z.array(permissionEnum).default([]),
  bookIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(300).default([]),
});
const acceptStaffInviteSchema = z.object({ token, password });
const userStatusSchema = z.object({ accountStatus: z.enum(["active", "suspended"]) });

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
  registerSchema,
  loginSchema,
  refreshSchema,
  tokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  staffInviteSchema,
  staffCreateSchema,
  acceptStaffInviteSchema,
  userStatusSchema,
};

module.exports.staffScopeSchema = z.object({ bookIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(300) });
