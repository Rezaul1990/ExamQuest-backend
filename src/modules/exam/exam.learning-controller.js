const { z } = require('zod');
const service = require('./exam.learning');
const enabled = z.object({ enabled: z.boolean() }).strict();
const report = z.object({ category: z.enum(['wrong_answer','unclear','typo','other']), detail: z.string().trim().min(5).max(1000) }).strict();
const resolution = z.object({ status: z.enum(['resolved','dismissed']), resolution: z.string().trim().min(5).max(1000) }).strict();
const reportQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), status: z.enum(['open','resolved','dismissed','all']).default('open') }).strict();
function handler(run, schema, query = false) {
  return async (req,res,next) => {
    try {
      let body;
      if (schema) {
        const parsed = schema.safeParse(query ? req.query : req.body);
        if (!parsed.success) return res.status(422).json({ success:false, error:'VALIDATION_ERROR' });
        body = parsed.data;
      }
      res.json({ success:true, data:await run(req,body) });
    } catch (error) { next(error); }
  };
}
module.exports = {
  overview: handler((r) => service.learningOverview(r.user._id)),
  discovery: handler((r) => service.discovery(r.user._id)),
  review: handler((r) => service.resultReview(r.user._id,r.params.id)),
  bookmark: handler((r,b) => service.setBookmark(r.user._id,r.params.id,r.params.questionId,b.enabled),enabled),
  reminder: handler((r,b) => service.setReminder(r.user._id,r.params.id,b.enabled),enabled),
  report: handler((r,b) => service.reportQuestion(r.user._id,r.params.id,r.params.questionId,b),report),
  reports: handler((r,b) => service.listReports(b),reportQuery,true),
  resolve: handler((r,b) => service.resolveReport(r.user,r.params.id,b),resolution),
  release: handler((r) => service.releaseResults(r.user,r.params.id), z.object({}).strict()),
};
