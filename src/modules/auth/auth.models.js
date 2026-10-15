const mongoose = require("mongoose");
const { ACCOUNT_STATUS, ROLES } = require("./auth.constants");

const parentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    relation: { type: String, enum: ["Father", "Mother", "Guardian"], required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true, default: ROLES.MEMBER, index: true },
    permissions: [{ type: String, trim: true }],
    bookIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
    educationLevel: { type: String, enum: ["SSC", "HSC"] },
    className: { type: String, trim: true, index: true },
    group: { type: String, enum: ["Science", "Humanities", "BusinessStudies"], index: true },
    academicYear: { type: Number, min: 2000, max: 2100, index: true },
    dateOfBirth: { type: Date },
    parent: parentSchema,
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date },
    accountStatus: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      default: ACCOUNT_STATUS.PENDING_VERIFICATION,
      index: true,
    },
    authVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
    forcePasswordChange: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    permissions: this.permissions || [],
    bookIds: (this.bookIds || []).map(String),
    educationLevel: this.educationLevel,
    className: this.className,
    group: this.group,
    academicYear: this.academicYear,
    dateOfBirth: this.dateOfBirth,
    parent: this.parent,
    emailVerified: this.emailVerified,
    accountStatus: this.accountStatus,
    forcePasswordChange: this.forcePasswordChange,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const authSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    tokenFamilyId: { type: String, required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, index: true },
    previousRefreshTokenHash: { type: String, index: true },
    deviceName: { type: String, trim: true },
    platform: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date },
    revokeReason: { type: String, trim: true },
  },
  { timestamps: true }
);

const tokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    purpose: { type: String, enum: ["email_verification", "password_reset"], required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date },
  },
  { timestamps: true }
);

const staffInviteSchema = new mongoose.Schema(
  {
    staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: ["pending", "accepted", "expired", "revoked"], default: "pending", index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    acceptedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    eventType: { type: String, required: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = {
  User: mongoose.model("User", userSchema),
  AuthSession: mongoose.model("AuthSession", authSessionSchema),
  SecurityToken: mongoose.model("SecurityToken", tokenSchema),
  StaffInvite: mongoose.model("StaffInvite", staffInviteSchema),
  AuditLog: mongoose.model("AuditLog", auditLogSchema),
};
