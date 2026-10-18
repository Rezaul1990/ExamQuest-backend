const mongoose = require('mongoose');
const id = { type: mongoose.Schema.Types.ObjectId, required: true };

const bookmarkSchema = new mongoose.Schema({ memberUserId: id, paperId: id, questionId: id }, { timestamps: true });
bookmarkSchema.index({ memberUserId: 1, paperId: 1, questionId: 1 }, { unique: true });
const reminderSchema = new mongoose.Schema({ memberUserId: id, paperId: id }, { timestamps: true });
reminderSchema.index({ memberUserId: 1, paperId: 1 }, { unique: true });
const reportSchema = new mongoose.Schema({
  memberUserId: id, attemptId: id, paperId: id, questionId: id,
  category: { type: String, enum: ['wrong_answer', 'unclear', 'typo', 'other'], required: true },
  detail: { type: String, maxlength: 1000, required: true },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  resolution: { type: String, maxlength: 1000 },
  resolvedByUserId: mongoose.Schema.Types.ObjectId,
}, { timestamps: true });
reportSchema.index({ memberUserId: 1, attemptId: 1, questionId: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });

const models = {
  LearningBookmark: mongoose.model('LearningBookmark', bookmarkSchema),
  ExamReminder: mongoose.model('ExamReminder', reminderSchema),
  QuestionReport: mongoose.model('QuestionReport', reportSchema),
};
async function ensureLearningStorage() {
  const required = [[models.LearningBookmark, ['memberUserId','paperId','questionId']], [models.ExamReminder, ['memberUserId','paperId']], [models.QuestionReport, ['memberUserId','attemptId','questionId']]];
  for (const [model, keys] of required) {
    await model.init();
    const indexes = await model.collection.indexes();
    if (!indexes.some((index) => index.unique && !index.sparse && !index.partialFilterExpression && Object.keys(index.key).join(',') === keys.join(','))) {
      const error = new Error('Learning uniqueness indexes are not ready');
      error.code = 'LEARNING_STORAGE_NOT_READY'; error.statusCode = 503; throw error;
    }
  }
}
module.exports = { ...models, ensureLearningStorage };
