const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const { generateOpaqueToken, hashToken, addDays } = require("./auth.crypto");

function issueAccessToken(user, session) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      sid: session.sessionId,
      role: user.role,
      ver: user.authVersion,
      jti: crypto.randomUUID(),
    },
    env.jwtAccessSecret,
    {
      expiresIn: env.jwtAccessExpiresIn,
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    }
  );
}

function createRefreshTokenRecord() {
  const token = generateOpaqueToken();
  return { token, hash: hashToken(token), expiresAt: addDays(env.refreshTokenExpiresDays) };
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret, {
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
  });
}

module.exports = { issueAccessToken, createRefreshTokenRecord, verifyAccessToken };
