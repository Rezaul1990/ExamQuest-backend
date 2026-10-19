const express = require("express");
const controller = require("./auth.controller");
const { authenticate, authorizeRoles } = require("../../middleware/authenticate");
const { authLimiter, loginLimiter, tokenLimiter } = require("../../middleware/rateLimits");
const {
  validate,
  registerSchema,
  loginSchema,
  refreshSchema,
  tokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  acceptStaffInviteSchema,
  academicProfileSchema,
} = require("./auth.validation");

const router = express.Router();

router.post("/register", authLimiter, validate(registerSchema), controller.register);
router.post("/login", loginLimiter, validate(loginSchema), controller.login);
router.post("/refresh", tokenLimiter, validate(refreshSchema), controller.refresh);
router.post("/verify-email", tokenLimiter, validate(tokenSchema), controller.verifyEmail);
router.post("/forgot-password", tokenLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
router.post("/reset-password", tokenLimiter, validate(resetPasswordSchema), controller.resetPassword);
router.post("/staff-invite/accept", tokenLimiter, validate(acceptStaffInviteSchema), controller.acceptStaffInvite);

router.get("/me", authenticate, controller.me);
router.patch('/me/academic-profile', authenticate, authorizeRoles('MEMBER'), authLimiter, validate(academicProfileSchema), controller.updateAcademicProfile);
router.post("/logout", authenticate, controller.logout);
router.post("/logout-all", authenticate, controller.logoutAll);
router.post("/change-password", authenticate, validate(changePasswordSchema), controller.changePassword);

module.exports = router;
