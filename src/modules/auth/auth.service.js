const crypto = require("crypto");
const mongoose = require("mongoose");
const { ROLES, ACCOUNT_STATUS } = require("./auth.constants");
const { User, AuthSession, SecurityToken, StaffInvite } = require("./auth.models");
const { normalizeEmail, hashPassword, verifyPassword, generateOpaqueToken, hashToken, addMinutes } = require("./auth.crypto");
const { issueAccessToken, createRefreshTokenRecord } = require("./auth.tokens");
const { buildLink, sendMail } = require("./auth.mailer");
const { audit } = require("./auth.audit");
const { normalizeAcademicGroup, normalizeClassName } = require("../academic/academic.constants");

const genericForgotResponse = "If an account exists for this email, a password reset link has been sent.";

function clientMeta(req) {
  return {
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
  };
}

async function createSession(user, body, req) {
  const refresh = createRefreshTokenRecord();
  const session = await AuthSession.create({
    userId: user._id,
    sessionId: crypto.randomUUID(),
    tokenFamilyId: crypto.randomUUID(),
    refreshTokenHash: refresh.hash,
    expiresAt: refresh.expiresAt,
    deviceName: body.deviceName,
    platform: body.platform,
    ...clientMeta(req),
  });
  return { accessToken: issueAccessToken(user, session), refreshToken: refresh.token, session };
}

async function createSecurityToken(user, purpose, minutes) {
  const raw = generateOpaqueToken();
  await SecurityToken.create({
    userId: user._id,
    purpose,
    tokenHash: hashToken(raw),
    expiresAt: addMinutes(minutes),
  });
  return raw;
}

async function registerMember(body) {
  if (await User.exists({ email: body.email })) {
    const error = new Error("Email already registered");
    error.statusCode = 409;
    error.code = "EMAIL_ALREADY_REGISTERED";
    throw error;
  }
  const user = await User.create({
    name: body.name,
    email: normalizeEmail(body.email),
    phone: body.phone,
    passwordHash: await hashPassword(body.password),
    role: ROLES.MEMBER,
    educationLevel: body.educationLevel,
    className: normalizeClassName(body.className),
    group: normalizeAcademicGroup(body.group),
    academicYear: body.academicYear,
    dateOfBirth: body.dateOfBirth,
    parent: body.parent,
    accountStatus: ACCOUNT_STATUS.ACTIVE,
    emailVerified: true,
    emailVerifiedAt: new Date(),
  });
  return { user };
}

async function verifyEmail(token) {
  const record = await SecurityToken.findOne({
    tokenHash: hashToken(token),
    purpose: "email_verification",
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) {
    const error = new Error("Invalid token");
    error.statusCode = 400;
    error.code = "INVALID_OR_EXPIRED_TOKEN";
    throw error;
  }
  const user = await User.findById(record.userId);
  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  if (user.accountStatus === ACCOUNT_STATUS.PENDING_VERIFICATION) {
    user.accountStatus = ACCOUNT_STATUS.ACTIVE;
  }
  record.usedAt = new Date();
  await Promise.all([user.save(), record.save()]);
  return user;
}

async function login(body, req) {
  const user = await User.findOne({ email: body.email }).select("+passwordHash");
  const passwordMatches = user ? await verifyPassword(user.passwordHash, body.password) : false;
  if (!user || !passwordMatches) {
    await audit("LOGIN_FAILED", { metadata: { email: body.email } });
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
    const error = new Error("Account is not active");
    error.statusCode = 403;
    error.code = "ACCOUNT_NOT_ACTIVE";
    throw error;
  }
  user.lastLoginAt = new Date();
  await user.save();
  const tokens = await createSession(user, body, req);
  await audit("LOGIN_SUCCESS", { actorUserId: user._id, targetUserId: user._id });
  return { user, ...tokens };
}

async function refresh(refreshToken) {
  const incomingHash = hashToken(refreshToken);
  const session = await AuthSession.findOne({
    $or: [{ refreshTokenHash: incomingHash }, { previousRefreshTokenHash: incomingHash }],
  });
  if (!session) {
    const error = new Error("Invalid refresh token");
    error.statusCode = 401;
    error.code = "INVALID_REFRESH_TOKEN";
    throw error;
  }
  if (session.previousRefreshTokenHash === incomingHash || session.revokedAt) {
    await AuthSession.updateMany(
      { tokenFamilyId: session.tokenFamilyId },
      { $set: { revokedAt: new Date(), revokeReason: "refresh_reuse_detected" } }
    );
    await audit("REFRESH_TOKEN_REUSE_DETECTED", { targetUserId: session.userId });
    const error = new Error("Refresh token reuse detected");
    error.statusCode = 401;
    error.code = "REFRESH_REUSE_DETECTED";
    throw error;
  }
  if (session.expiresAt <= new Date()) {
    const error = new Error("Refresh token expired");
    error.statusCode = 401;
    error.code = "REFRESH_EXPIRED";
    throw error;
  }
  const user = await User.findById(session.userId);
  if (!user || user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
    const error = new Error("Account is not active");
    error.statusCode = 403;
    error.code = "ACCOUNT_NOT_ACTIVE";
    throw error;
  }
  const rotated = createRefreshTokenRecord();
  session.previousRefreshTokenHash = session.refreshTokenHash;
  session.refreshTokenHash = rotated.hash;
  session.expiresAt = rotated.expiresAt;
  session.lastUsedAt = new Date();
  await session.save();
  return { user, accessToken: issueAccessToken(user, session), refreshToken: rotated.token };
}

async function logout(session) {
  session.revokedAt = new Date();
  session.revokeReason = "logout";
  await session.save();
}

async function revokeAllSessions(userId, reason = "logout_all") {
  await AuthSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

async function forgotPassword(email) {
  const user = await User.findOne({ email: normalizeEmail(email) });
  if (user) {
    const token = await createSecurityToken(user, "password_reset", 20);
    const link = buildLink("reset-password", token);
    await sendMail({ to: user.email, subject: "Reset your ExamQuest password", text: `Reset your password: ${link}` });
  }
  return genericForgotResponse;
}

async function resetPassword(token, password) {
  const record = await SecurityToken.findOne({
    tokenHash: hashToken(token),
    purpose: "password_reset",
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) {
    const error = new Error("Invalid token");
    error.statusCode = 400;
    error.code = "INVALID_OR_EXPIRED_TOKEN";
    throw error;
  }
  const user = await User.findById(record.userId).select("+passwordHash");
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.authVersion += 1;
  record.usedAt = new Date();
  await Promise.all([user.save(), record.save(), revokeAllSessions(user._id, "password_reset")]);
  await audit("PASSWORD_RESET", { targetUserId: user._id });
}

async function changePassword(user, currentPassword, newPassword) {
  const fullUser = await User.findById(user._id).select("+passwordHash");
  if (!(await verifyPassword(fullUser.passwordHash, currentPassword))) {
    const error = new Error("Invalid current password");
    error.statusCode = 400;
    error.code = "INVALID_CURRENT_PASSWORD";
    throw error;
  }
  fullUser.passwordHash = await hashPassword(newPassword);
  fullUser.passwordChangedAt = new Date();
  fullUser.forcePasswordChange = false;
  fullUser.authVersion += 1;
  await fullUser.save();
  await revokeAllSessions(fullUser._id, "password_changed");
  await audit("PASSWORD_CHANGED", { actorUserId: fullUser._id, targetUserId: fullUser._id });
}

async function acceptStaffInvite(token, password) {
  const invite = await StaffInvite.findOne({
    tokenHash: hashToken(token),
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  if (!invite) {
    const error = new Error("Invalid invitation");
    error.statusCode = 400;
    error.code = "INVALID_OR_EXPIRED_INVITE";
    throw error;
  }
  const user = await User.findById(invite.staffUserId).select("+passwordHash");
  user.passwordHash = await hashPassword(password);
  user.accountStatus = ACCOUNT_STATUS.ACTIVE;
  user.emailVerified = true;
  user.emailVerifiedAt = user.emailVerifiedAt || new Date();
  user.authVersion += 1;
  invite.status = "accepted";
  invite.acceptedAt = new Date();
  await Promise.all([user.save(), invite.save()]);
  await audit("STAFF_INVITE_ACCEPTED", { targetUserId: user._id, metadata: { inviteId: invite._id.toString() } });
  return user;
}

module.exports = {
  registerMember,
  verifyEmail,
  login,
  refresh,
  logout,
  revokeAllSessions,
  forgotPassword,
  resetPassword,
  changePassword,
  acceptStaffInvite,
  createSession,
};
