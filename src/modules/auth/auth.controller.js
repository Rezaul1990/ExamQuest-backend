const authService = require("./auth.service");

function authResponse(user, accessToken, refreshToken) {
  return { success: true, data: { user: user.toSafeJSON(), accessToken, refreshToken } };
}

async function register(req, res, next) {
  try {
    const { user } = await authService.registerMember(req.validatedBody);
    res.status(201).json({
      success: true,
      data: {
        user: user.toSafeJSON(),
        message: "Registration complete. You can login now.",
      },
    });
  } catch (error) {
    next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const user = await authService.verifyEmail(req.validatedBody.token);
    res.json({ success: true, data: { user: user.toSafeJSON() } });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.validatedBody, req);
    res.json(authResponse(result.user, result.accessToken, result.refreshToken));
  } catch (error) {
    next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const result = await authService.refresh(req.validatedBody.refreshToken);
    res.json(authResponse(result.user, result.accessToken, result.refreshToken));
  } catch (error) {
    next(error);
  }
}

async function me(req, res) {
  res.json({ success: true, data: { user: req.user.toSafeJSON() } });
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.authSession);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function logoutAll(req, res, next) {
  try {
    await authService.revokeAllSessions(req.user._id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const message = await authService.forgotPassword(req.validatedBody.email);
    res.json({ success: true, data: { message } });
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    await authService.resetPassword(req.validatedBody.token, req.validatedBody.password);
    res.json({ success: true, data: { message: "Password reset complete. Please login again." } });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    await authService.changePassword(req.user, req.validatedBody.currentPassword, req.validatedBody.newPassword);
    res.json({ success: true, data: { message: "Password changed. Please login again." } });
  } catch (error) {
    next(error);
  }
}

async function acceptStaffInvite(req, res, next) {
  try {
    const user = await authService.acceptStaffInvite(req.validatedBody.token, req.validatedBody.password);
    res.json({ success: true, data: { user: user.toSafeJSON() } });
  } catch (error) {
    next(error);
  }
}

module.exports = { register, verifyEmail, login, refresh, me, logout, logoutAll, forgotPassword, resetPassword, changePassword, acceptStaffInvite };
