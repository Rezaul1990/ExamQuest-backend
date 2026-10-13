const express = require("express");
const { authenticate, authorizePermissions } = require("../../middleware/authenticate");
const { PERMISSIONS } = require("../auth/auth.constants");

const router = express.Router();

router.get("/question-papers/:id/start", authenticate, authorizePermissions(PERMISSIONS.EXAM_TAKE), (req, res) => {
  res.status(501).json({
    success: false,
    error: "EXAM_ENGINE_NOT_IMPLEMENTED",
    message: "Exam endpoints are reserved behind auth/RBAC; scoring implementation requires question-paper data models.",
  });
});

module.exports = router;
