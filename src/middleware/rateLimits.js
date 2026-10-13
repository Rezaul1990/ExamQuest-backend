const rateLimit = require("express-rate-limit");

function limiter({ windowMinutes, max }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "RATE_LIMITED" },
  });
}

module.exports = {
  authLimiter: limiter({ windowMinutes: 15, max: 50 }),
  loginLimiter: limiter({ windowMinutes: 15, max: 10 }),
  tokenLimiter: limiter({ windowMinutes: 15, max: 20 }),
};
