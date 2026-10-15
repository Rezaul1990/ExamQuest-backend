const mongoose = require('mongoose');
const { QuestionPaper, ExamSubmission, ExamAttempt } = require('./exam.models');

async function usageCounts(ids) {
  const rows = await QuestionPaper.aggregate([
    { $match: { 'questions.questionId': { $in: ids } } },
    { $unwind: '$questions' }, { $match: { 'questions.questionId': { $in: ids } } },
    { $group: { _id: { paper: '$_id', question: '$questions.questionId' } } },
    { $group: { _id: '$_id.question', paperCount: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.paperCount]));
}

// Only aggregate counts leave this service. Accepted truth precedes legacy projections.
async function questionAnalytics(questions) {
  const ids = questions.map((q) => new mongoose.Types.ObjectId(q.id));
  const match = { 'answers.questionId': { $in: ids } };
  const rows = await ExamSubmission.aggregate([
    { $match: match }, { $project: { attemptKey: '$attemptId', answers: 1, priority: { $literal: 0 } } },
    { $unionWith: { coll: ExamAttempt.collection.name, pipeline: [
      { $match: { ...match, status: 'submitted' } },
      { $project: { attemptKey: '$_id', answers: 1, priority: { $literal: 1 } } },
    ] } },
    { $sort: { priority: 1 } }, { $group: { _id: '$attemptKey', answers: { $first: '$answers' } } },
    { $unwind: '$answers' }, { $match: match },
    { $group: { _id: '$answers.questionId', submissions: { $sum: 1 },
      answered: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$answers.selectedOption', null] }, null] }, 1, 0] } },
      correct: { $sum: { $cond: [{ $eq: ['$answers.isCorrect', true] }, 1, 0] } } } },
  ]);
  const counts = new Map(rows.map((row) => [String(row._id), row]));
  return questions.map((q) => {
    const row = counts.get(q.id) || { submissions: 0, answered: 0, correct: 0 };
    return { questionId: q.id, difficulty: q.difficulty, paperCount: q.paperCount || 0,
      submissions: row.submissions, answered: row.answered, correct: row.correct,
      correctnessPercent: row.submissions ? Math.round(row.correct / row.submissions * 10000) / 100 : null };
  });
}
module.exports = { usageCounts, questionAnalytics };
