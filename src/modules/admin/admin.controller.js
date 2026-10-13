const { User, StaffInvite, AuthSession } = require("../auth/auth.models");
const { ROLES, ACCOUNT_STATUS, PERMISSIONS } = require("../auth/auth.constants");
const { hashPassword, generateOpaqueToken, hashToken, addDays } = require("../auth/auth.crypto");
const { buildLink, sendMail } = require("../auth/auth.mailer");
const { audit } = require("../auth/auth.audit");

const allowedStaffPermissions = Object.values(PERMISSIONS).filter(
  (permission) => ![PERMISSIONS.USERS_MANAGE, PERMISSIONS.STAFF_INVITE].includes(permission)
);

function sanitizeStaffPermissions(permissions) {
  return [...new Set((permissions || []).filter((permission) => allowedStaffPermissions.includes(permission)))];
}

async function createStaffAccount(req, res, next) {
  try {
    const { name, email, password, permissions } = req.validatedBody;
    const grantedPermissions = sanitizeStaffPermissions(permissions);
    let staff = await User.findOne({ email }).select("+passwordHash");
    if (staff && staff.role !== ROLES.STAFF) {
      return res.status(409).json({ success: false, error: "EMAIL_ALREADY_USED" });
    }
    if (!staff) {
      staff = await User.create({
        name,
        email,
        passwordHash: await hashPassword(password),
        role: ROLES.STAFF,
        permissions: grantedPermissions,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      });
    } else {
      staff.name = name;
      staff.passwordHash = await hashPassword(password);
      staff.permissions = grantedPermissions;
      staff.accountStatus = ACCOUNT_STATUS.ACTIVE;
      staff.emailVerified = true;
      staff.emailVerifiedAt = staff.emailVerifiedAt || new Date();
      staff.authVersion += 1;
      await staff.save();
      await AuthSession.updateMany({ userId: staff._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "staff_permissions_updated" } });
    }
    await audit("ADMIN_CREATED_STAFF_ACCOUNT", {
      actorUserId: req.user._id,
      targetUserId: staff._id,
      metadata: { permissions: grantedPermissions },
    });
    res.status(201).json({ success: true, data: { user: staff.toSafeJSON() } });
  } catch (error) {
    next(error);
  }
}

async function createStaffInvite(req, res, next) {
  try {
    const { name, email } = req.validatedBody;
    let staff = await User.findOne({ email });
    if (staff && staff.role !== ROLES.STAFF) {
      return res.status(409).json({ success: false, error: "EMAIL_ALREADY_USED" });
    }
    if (!staff) {
      staff = await User.create({
        name,
        email,
        passwordHash: await hashPassword(generateOpaqueToken()),
        role: ROLES.STAFF,
        accountStatus: ACCOUNT_STATUS.INVITED,
      });
    }
    await StaffInvite.updateMany({ staffUserId: staff._id, status: "pending" }, { $set: { status: "revoked", revokedAt: new Date() } });
    const token = generateOpaqueToken();
    const invite = await StaffInvite.create({
      staffUserId: staff._id,
      invitedByUserId: req.user._id,
      email,
      name,
      tokenHash: hashToken(token),
      expiresAt: addDays(1),
    });
    const inviteLink = buildLink("staff-invite", token);
    await sendMail({ to: email, subject: "ExamQuest staff invitation", text: `Accept staff invitation: ${inviteLink}` });
    await audit("ADMIN_CREATED_STAFF_INVITE", { actorUserId: req.user._id, targetUserId: staff._id, metadata: { inviteId: invite._id.toString() } });
    res.status(201).json({ success: true, data: { invite: serializeInvite(invite), inviteLink } });
  } catch (error) {
    next(error);
  }
}

async function listInvites(req, res, next) {
  try {
    const invites = await StaffInvite.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: { invites: invites.map(serializeInvite) } });
  } catch (error) {
    next(error);
  }
}

async function regenerateInvite(req, res, next) {
  try {
    const invite = await StaffInvite.findById(req.params.id);
    if (!invite) return res.status(404).json({ success: false, error: "INVITE_NOT_FOUND" });
    const token = generateOpaqueToken();
    invite.tokenHash = hashToken(token);
    invite.status = "pending";
    invite.expiresAt = addDays(1);
    invite.revokedAt = undefined;
    await invite.save();
    const inviteLink = buildLink("staff-invite", token);
    await audit("STAFF_INVITE_REGENERATED", { actorUserId: req.user._id, targetUserId: invite.staffUserId, metadata: { inviteId: invite._id.toString() } });
    res.json({ success: true, data: { invite: serializeInvite(invite), inviteLink } });
  } catch (error) {
    next(error);
  }
}

async function revokeInvite(req, res, next) {
  try {
    const invite = await StaffInvite.findById(req.params.id);
    if (!invite) return res.status(404).json({ success: false, error: "INVITE_NOT_FOUND" });
    invite.status = "revoked";
    invite.revokedAt = new Date();
    await invite.save();
    await audit("STAFF_INVITE_REVOKED", { actorUserId: req.user._id, targetUserId: invite.staffUserId, metadata: { inviteId: invite._id.toString() } });
    res.json({ success: true, data: { invite: serializeInvite(invite) } });
  } catch (error) {
    next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: { users: users.map((user) => user.toSafeJSON()) } });
  } catch (error) {
    next(error);
  }
}

async function updateUserStatus(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
    if (user.role === ROLES.ADMIN && req.validatedBody.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
      return res.status(403).json({ success: false, error: "CANNOT_SUSPEND_ADMIN" });
    }
    user.accountStatus = req.validatedBody.accountStatus;
    user.authVersion += 1;
    await user.save();
    await audit(user.accountStatus === ACCOUNT_STATUS.SUSPENDED ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REACTIVATED", {
      actorUserId: req.user._id,
      targetUserId: user._id,
    });
    res.json({ success: true, data: { user: user.toSafeJSON() } });
  } catch (error) {
    next(error);
  }
}

async function revokeUserSessions(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
    await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "admin_revoked" } });
    await audit("SESSION_REVOKED", { actorUserId: req.user._id, targetUserId: user._id });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

function serializeInvite(invite) {
  return {
    id: invite._id.toString(),
    staffUserId: invite.staffUserId.toString(),
    email: invite.email,
    name: invite.name,
    status: invite.status,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

module.exports = { createStaffAccount, createStaffInvite, listInvites, regenerateInvite, revokeInvite, listUsers, updateUserStatus, revokeUserSessions };
