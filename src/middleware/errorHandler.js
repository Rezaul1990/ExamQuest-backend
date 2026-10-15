function notFound(req, res) {
  res.status(404).json({ success: false, error: "NOT_FOUND" });
}

function errorHandler(error, req, res, next) {
  const status = error.statusCode || 500;
  const payload = {
    success: false,
    error: status >= 500 && !["EXAM_STORAGE_NOT_READY", "SUBMISSION_UNCONFIRMED"].includes(error.code) ? "INTERNAL_ERROR" : error.code || "REQUEST_ERROR",
  };
  if (process.env.NODE_ENV !== "production" && status >= 500 && !["EXAM_STORAGE_NOT_READY", "SUBMISSION_UNCONFIRMED"].includes(error.code)) {
    payload.message = error.message;
  }
  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
