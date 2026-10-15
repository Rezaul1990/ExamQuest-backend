const { normalizeClassName, hasCompleteAcademicProfile, groupsMatch } = require('../academic/academic.constants');
const { groupsFor } = require('./exam.authoring');
function eligibleMember(member, paper, book) {
  if (member?.role !== 'MEMBER' || member.accountStatus !== 'active' || !hasCompleteAcademicProfile(member)) return false;
  const className = paper.snapshotVersion ? paper.academicContext?.className : book?.className;
  if (!className || normalizeClassName(member.className).toLowerCase() !== normalizeClassName(className).toLowerCase()) return false;
  return groupsMatch(member.group, paper.eligibleGroups?.length ? paper.eligibleGroups : groupsFor(book || {}));
}
const isPaperOpen = (paper, now = new Date()) => paper.status === 'published' && (!paper.availableFrom || paper.availableFrom <= now) && (!paper.availableUntil || paper.availableUntil >= now);
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
function dateParts(date) { return Object.fromEntries(parts.formatToParts(date).map((part) => [part.type, part.value])); }
function dhakaDay(date = new Date()) { const p = dateParts(date); return `${p.year}-${p.month}-${p.day}`; }
function midnight(day) {
  const target = Date.parse(day + 'T00:00:00Z'); let guess = target;
  for (let i=0;i<3;i++) { const p=dateParts(new Date(guess)); const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second); guess += target-local; }
  return new Date(guess);
}
function dayBounds(day) { const tomorrow = new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10); return { start: midnight(day), end: midnight(tomorrow) }; }
function serializeAttempt(item, paper, questions = []) {
  const accepted = !!item.attemptId || item.status === 'submitted';
  return {
    id: String(item.attemptId || item._id), questionPaperId: String(item.questionPaperId), paperTitle: item.paperTitle || paper?.originalTitle || paper?.title,
    status: accepted ? 'submitted' : item.status, questions,
    answers: (item.answers || []).map((answer) => accepted ? { questionId: String(answer.questionId), selectedOption: answer.selectedOption, correctOption: answer.correctOption, isCorrect: answer.isCorrect, marksAwarded: answer.marksAwarded } : { questionId: String(answer.questionId), selectedOption: answer.selectedOption }),
    score: accepted ? item.score : 0, total: item.total, percentage: accepted ? item.percentage : 0,
    startedAt: item.startedAt, expiresAt: item.expiresAt, submittedAt: accepted ? item.submittedAt : undefined,
    serverNow: new Date(), answerRevision: item.answerRevision || 0, submissionMode: item.submissionMode, expiryReason: item.expiryReason,
  };
}
module.exports = { eligibleMember, isPaperOpen, dhakaDay, dayBounds, serializeAttempt };
