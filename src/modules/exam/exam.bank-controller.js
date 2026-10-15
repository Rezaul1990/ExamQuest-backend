const { bankQuerySchema } = require('./exam.validation');
const { listQuestions } = require('./exam.service');
const { questionAnalytics } = require('./exam.bank');

async function analytics(req, res, next) {
  try {
    const parsed = bankQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'INVALID_BANK_FILTERS' });
    const questions = await listQuestions(parsed.data, req.user);
    res.json({ success: true, data: { analytics: await questionAnalytics(questions) } });
  } catch (error) { next(error); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'ADMIN_ACCESS_REQUIRED' });
  next();
}
module.exports = { analytics, adminOnly };
