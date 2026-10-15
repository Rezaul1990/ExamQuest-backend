const { randomInt } = require('node:crypto');

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Persist once with the winning attempt insert; never reshuffle on resume.
function createPresentation(paper) {
  return shuffle(paper.questionSnapshots).map((question) => ({
    questionId: question.questionId,
    optionKeys: shuffle(question.options.map((option) => option.key)),
  }));
}

function presentQuestions(paper, attempt) {
  const snapshots = paper.questionSnapshots || [];
  const order = attempt?.presentation?.length ? attempt.presentation : snapshots.map((q) => ({ questionId: q.questionId }));
  return order.map((entry) => {
    const q = snapshots.find((item) => String(item.questionId) === String(entry.questionId));
    if (!q) throw new Error('Attempt presentation does not match frozen paper');
    const keys = entry.optionKeys?.length ? entry.optionKeys : q.options.map((option) => option.key);
    return { id: String(q.questionId), bookId: String(paper.bookId), text: q.text, difficulty: q.difficulty,
      options: keys.map((key, index) => ({ key, label: 'ABCD'[index], text: q.options.find((option) => option.key === key).text })) };
  });
}
module.exports = { createPresentation, presentQuestions };
