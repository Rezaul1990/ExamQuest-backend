const { verifyAccessToken } = require("../modules/auth/auth.tokens");
const { User, AuthSession } = require("../modules/auth/auth.models");
const { ACCOUNT_STATUS, ROLE_PERMISSIONS, ROLES } = require("../modules/auth/auth.constants");

async function authenticate(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const [, token] = header.match(/^Bearer (.+)$/i) || [];
    if (!token) {
      return res.status(401).json({ success: false, error: "AUTH_REQUIRED" });
    }
    const payload = verifyAccessToken(token);
    const [user, session] = await Promise.all([
      User.findById(payload.sub),
      AuthSession.findOne({ sessionId: payload.sid }),
    ]);
    if (!user || !session || session.revokedAt || session.expiresAt <= new Date()) {
      return res.status(401).json({ success: false, error: "AUTH_INVALID" });
    }
    if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
      return res.status(403).json({ success: false, error: "ACCOUNT_NOT_ACTIVE" });
    }
    if (user.authVersion !== payload.ver || user.role !== payload.role) {
      return res.status(401).json({ success: false, error: "AUTH_STALE" });
    }
    req.user = user;
    req.authSession = session;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "AUTH_INVALID" });
  }
}

function authorizePermissions(...permissions) {
  return (req, res, next) => {
    const available =
      req.user?.role === ROLES.STAFF
        ? req.user.permissions || []
        : ROLE_PERMISSIONS[req.user?.role] || [];
    if (permissions.every((permission) => available.includes(permission))) {
      return next();
    }
    return res.status(403).json({ success: false, error: "FORBIDDEN" });
  };
}

module.exports = { authenticate, authorizePermissions };
