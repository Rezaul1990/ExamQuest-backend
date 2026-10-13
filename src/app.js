const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const env = require("./config/env");
const authRoutes = require("./modules/auth/auth.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const examRoutes = require("./modules/exam/exam.routes");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

function resolveCorsOrigin(origin, callback) {
  if (!origin) {
    return callback(null, true);
  }
  if (env.corsOrigins.includes("*") || env.corsOrigins.includes(origin)) {
    return callback(null, true);
  }
  if (
    env.nodeEnv !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)
  ) {
    return callback(null, true);
  }
  return callback(new Error("Not allowed by CORS"));
}

app.use(helmet());
app.use(cors({ origin: resolveCorsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ExamQuest API is running",
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/exams", examRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
