const express = require("express");
const controller = require("./admin.controller");
const { authenticate, authorizePermissions } = require("../../middleware/authenticate");
const { PERMISSIONS } = require("../auth/auth.constants");
const { validate, staffScopeSchema, staffCreateSchema, staffInviteSchema, userStatusSchema } = require("../auth/auth.validation");

const router = express.Router();

router.use(authenticate);
router.patch("/staff/:id/scope", authorizePermissions(PERMISSIONS.STAFF_INVITE), validate(staffScopeSchema), controller.updateStaffScope);
router.post("/staff", authorizePermissions(PERMISSIONS.STAFF_INVITE), validate(staffCreateSchema), controller.createStaffAccount);
router.post("/staff/invite", authorizePermissions(PERMISSIONS.STAFF_INVITE), validate(staffInviteSchema), controller.createStaffInvite);
router.get("/staff/invites", authorizePermissions(PERMISSIONS.STAFF_INVITE), controller.listInvites);
router.post("/staff/invites/:id/regenerate", authorizePermissions(PERMISSIONS.STAFF_INVITE), controller.regenerateInvite);
router.post("/staff/invites/:id/revoke", authorizePermissions(PERMISSIONS.STAFF_INVITE), controller.revokeInvite);
router.get("/users", authorizePermissions(PERMISSIONS.USERS_MANAGE), controller.listUsers);
router.patch("/users/:id/status", authorizePermissions(PERMISSIONS.USERS_MANAGE), validate(userStatusSchema), controller.updateUserStatus);
router.post("/users/:id/revoke-sessions", authorizePermissions(PERMISSIONS.USERS_MANAGE), controller.revokeUserSessions);

module.exports = router;
