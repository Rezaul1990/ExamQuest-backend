const requiredInProduction = ["MONGODB_URI", "JWT_ACCESS_SECRET"];

function readEnv() {
  const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 3000),
    mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/examquest",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "dev-only-change-me-to-a-strong-secret",
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    jwtIssuer: process.env.JWT_ISSUER || "examquest-api",
    jwtAudience: process.env.JWT_AUDIENCE || "examquest-mobile",
    refreshTokenExpiresDays: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30),
    appDeepLinkScheme: process.env.APP_DEEP_LINK_SCHEME || "examquest",
    appPublicBaseUrl: process.env.APP_PUBLIC_BASE_URL || "http://localhost:3000",
    corsOrigins: (process.env.CORS_ORIGIN || "*")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false") === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.EMAIL_FROM || "ExamQuest <no-reply@example.com>",
    },
  };

  if (env.nodeEnv === "production") {
    const missing = requiredInProduction.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required production env: ${missing.join(", ")}`);
    }
    if (env.corsOrigins.includes("*")) {
      throw new Error("Production CORS_ORIGIN must not be wildcard");
    }
  }

  return env;
}

module.exports = readEnv();
