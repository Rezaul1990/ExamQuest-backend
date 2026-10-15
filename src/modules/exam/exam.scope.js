const { Book, Chapter, Question, QuestionPaper } = require('./exam.models');
const allowedBookIds = (actor) => actor?.role === 'STAFF' ? (actor.bookIds || []).map(String) : null;
const canAccessBook = (actor, bookId) => !allowedBookIds(actor) || allowedBookIds(actor).includes(String(bookId));
const scopedBooks = (actor) => actor?.role === 'STAFF' ? { _id: { $in: actor.bookIds || [] } } : {};

// Applied to every content-management route, in addition to route permissions.
async function enforceContentScope(req, res, next) {
  if (req.user.role !== 'STAFF') return next();
  const parts = req.path.split('/').filter(Boolean);
  let bookId = req.body?.bookId || req.query.bookId;
  try {
    if (parts[0] === 'books' && parts[1]) bookId = parts[1];
    else if (['chapters','questions','question-papers'].includes(parts[0]) && /^[a-f\d]{24}$/i.test(parts[1] || '')) {
      const model = { chapters: Chapter, questions: Question, 'question-papers': QuestionPaper }[parts[0]];
      const resource = await model.findById(parts[1]).select('bookId');
      if (!resource || !canAccessBook(req.user, resource.bookId)) return res.status(403).json({ success: false, error: 'RESOURCE_SCOPE_FORBIDDEN' });
    }
    if ((bookId && !canAccessBook(req.user, bookId)) || (parts[0] === 'books' && req.method === 'POST')) return res.status(403).json({ success: false, error: 'RESOURCE_SCOPE_FORBIDDEN' });
    return next();
  } catch (error) { return next(error); }
}
module.exports = { allowedBookIds, canAccessBook, scopedBooks, enforceContentScope };
