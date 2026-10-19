const mongoose = require('mongoose');
const { Book, Chapter, QuestionPaper, ExamAttempt, ExamSubmission } = require('./exam.models');
const { User } = require('../auth/auth.models');
const { hasCompleteAcademicProfile } = require('../academic/academic.constants');
const { ensurePaperSnapshot, serializePaper } = require('./exam.authoring');
const { eligibleMember, isPaperOpen, dhakaDay, dayBounds, serializeAttempt } = require('./exam.member-rules');
const { audit } = require('../auth/auth.audit');
const { createPresentation, presentQuestions } = require('./exam.presentation');
const validId = mongoose.isValidObjectId;
const writeConcern = { w: 'majority', j: true };
function storageError() { const error = new Error('Exam uniqueness indexes are not ready'); error.statusCode=503; error.code='EXAM_STORAGE_NOT_READY'; return error; }
async function ensureExamStorage() {
  await Promise.all([ExamSubmission.init(), ExamAttempt.init()]);
  const [submissionIndexes, attemptIndexes] = await Promise.all([ExamSubmission.collection.indexes(), ExamAttempt.collection.indexes()]);
  const required = [ ['memberUserId','dayKey'], ['memberUserId','questionPaperId'], ['attemptId'] ];
  if (!required.every((keys) => submissionIndexes.some((index) => index.unique && !index.partialFilterExpression && !index.sparse && JSON.stringify(Object.keys(index.key))===JSON.stringify(keys)))) throw storageError();
  if (!attemptIndexes.some((index) => index.unique && index.sparse && Object.keys(index.key).join(',')==='activeKey')) throw storageError();
}
async function memberRecord(id) {
  const member = validId(id) ? await User.findById(id) : null;
  if (!member || member.role !== 'MEMBER' || member.accountStatus !== 'active') return { error:'MEMBER_ACCESS_REQUIRED' };
  if (!hasCompleteAcademicProfile(member)) return { error:'MEMBER_PROFILE_INCOMPLETE' };
  return { member };
}
function legacyDayQuery(memberUserId, dayKey) {
  const { start, end }=dayBounds(dayKey);
  return { memberUserId, status:'submitted', $or:[{submittedAt:{$gte:start,$lt:end}},{submittedAt:{$exists:false},updatedAt:{$gte:start,$lt:end}}] };
}
async function quotaStatus(memberUserId, now = new Date()) {
  const access=await memberRecord(memberUserId); if(access.error)return access;
  const dayKey=dhakaDay(now);
  const [accepted, legacy] = await Promise.all([ExamSubmission.exists({memberUserId,dayKey}), ExamAttempt.exists(legacyDayQuery(memberUserId,dayKey))]);
  return { dayKey, timeZone:'Asia/Dhaka', limit:1, used: accepted || legacy ? 1 : 0, canSubmit:!accepted&&!legacy, resetsAt:dayBounds(dayKey).end, serverNow:now };
}
async function completedPaperIds(memberUserId) {
  const [accepted,legacy]=await Promise.all([ExamSubmission.distinct('questionPaperId',{memberUserId}),ExamAttempt.distinct('questionPaperId',{memberUserId,status:'submitted'})]);
  return [...new Set([...accepted,...legacy].map(String))];
}
async function listMemberPapers(filters={}, now=new Date()) {
  const access=await memberRecord(filters.memberUserId); if(access.error)return [];
  if ((filters.bookId&&!validId(filters.bookId))||(filters.chapterId&&!validId(filters.chapterId))) return [];
  const completed=await completedPaperIds(filters.memberUserId);
  const query={ status:'published', _id:{$nin:completed}, ...(filters.bookId?{bookId:filters.bookId}:{}), ...(filters.chapterId?{chapterIds:filters.chapterId}:{}) };
  const papers=await QuestionPaper.find(query).sort({createdAt:-1});
  const books=await Book.find({_id:{$in:papers.map((p)=>p.bookId)},status:'published'});
  return papers.filter((paper)=>isPaperOpen(paper,now)&&eligibleMember(access.member,paper,books.find((book)=>String(book._id)===String(paper.bookId)))&&books.some((book)=>String(book._id)===String(paper.bookId))).map((paper)=>serializePaper(paper,undefined,books.find((book)=>String(book._id)===String(paper.bookId))));
}
async function paperDetail(id, memberUserId) {
  if(!validId(id))return {error:'QUESTION_PAPER_NOT_FOUND'};
  const papers=await listMemberPapers({memberUserId});
  const paper=papers.find((entry)=>entry.id===String(id));
  return paper?{paper}:{error:'QUESTION_PAPER_NOT_FOUND'};
}
async function ownedAttempt(id, memberUserId) {
  const access=await memberRecord(memberUserId);if(access.error)return access;
  if(!validId(id))return {error:'ATTEMPT_NOT_FOUND'};
  const attempt=await ExamAttempt.findOne({_id:id,memberUserId});if(!attempt)return {error:'ATTEMPT_NOT_FOUND'};
  const paper=await QuestionPaper.findById(attempt.questionPaperId).select('+answerKey');
  const book=paper?await Book.findById(paper.bookId):null;
  // Eligibility was checked at start. Owned attempts survive later academic changes.
  if(!paper)return {error:'QUESTION_PAPER_NOT_FOUND'};
  return {attempt,paper,book,member:access.member};
}
async function adoptDeadline(attempt,paper) {
  if(attempt.expiresAt)return attempt;
  const expiresAt=new Date(new Date(attempt.startedAt).getTime()+paper.durationMinutes*60000);
  await ExamAttempt.updateOne({_id:attempt._id,expiresAt:{$exists:false}},{$set:{expiresAt}});
  return ExamAttempt.findById(attempt._id);
}
async function projectSubmission(submission) {
  try {
    await ExamAttempt.updateOne({_id:submission.attemptId,memberUserId:submission.memberUserId},{$set:{status:'submitted',answers:submission.answers,score:submission.score,total:submission.total,percentage:submission.percentage,submittedAt:submission.submittedAt,submissionMode:submission.submissionMode},$unset:{activeKey:1}});
  } catch { /* Authoritative result is already durable; retries/history do not depend on this projection. */ }
}
async function submittedRecord(attempt,paper) {
  const accepted=await ExamSubmission.findOne({attemptId:attempt._id,memberUserId:attempt.memberUserId});
  if(accepted){await projectSubmission(accepted);return {attempt:serializeAttempt(accepted,paper)};}
  if(attempt.status==='submitted')return {attempt:serializeAttempt(attempt,paper)};
  return null;
}
async function startAttempt(paperId,memberUserId) {
  // Capture before async reads: a start racing an Admin close must not gain a
  // fresh duration after closing and outlive the answer-release safety window.
  const startedAt=new Date();
  const access=await memberRecord(memberUserId);if(access.error)return access;
  if(!validId(paperId))return {error:'QUESTION_PAPER_NOT_FOUND'};
  let paper=await QuestionPaper.findOne({_id:paperId,status:'published'}).select('+answerKey');
  const book=paper?await Book.findById(paper.bookId):null;
  if(!paper)return {error:'QUESTION_PAPER_NOT_FOUND'};
  if(!eligibleMember(access.member,paper,book))return {error:'QUESTION_PAPER_NOT_ELIGIBLE'};
  if(!book||book.status!=='published'||!isPaperOpen(paper))return {error:'QUESTION_PAPER_NOT_OPEN'};
  if((await completedPaperIds(memberUserId)).includes(String(paperId)))return {error:'EXAM_ALREADY_SUBMITTED'};
  const quota=await quotaStatus(memberUserId);if(!quota.canSubmit)return {error:'DAILY_SUBMISSION_LIMIT',quota};
  paper=await ensurePaperSnapshot(paper);if(!paper)return {error:'PAPER_SNAPSHOT_UNAVAILABLE'};
  await ensureExamStorage();
  const activeKey=String(memberUserId)+':'+String(paperId);
  let attempt=await ExamAttempt.findOne({memberUserId,questionPaperId:paperId,status:'in_progress'}).sort({startedAt:1});
  if(attempt){
    try { attempt=await ExamAttempt.findOneAndUpdate({_id:attempt._id,status:'in_progress'},{$set:{activeKey}},{new:true}); }
    catch(error){if(error.code!==11000)throw error;attempt=await ExamAttempt.findOne({activeKey});}
  }
  if(!attempt){
    try { attempt=await ExamAttempt.findOneAndUpdate({activeKey},{$setOnInsert:{activeKey,memberUserId,questionPaperId:paperId,total:paper.totalMarks,startedAt,expiresAt:new Date(startedAt.getTime()+paper.durationMinutes*60000),paperSnapshotVersion:paper.snapshotVersion,presentation:createPresentation(paper),answerRevision:0,status:'in_progress'}},{upsert:true,new:true,setDefaultsOnInsert:true}); }
    catch(error){if(error.code!==11000)throw error;attempt=await ExamAttempt.findOne({activeKey});}
  }
  attempt=await adoptDeadline(attempt,paper);
  if(attempt.expiresAt<=new Date())return submitAttempt(String(attempt._id),memberUserId,[],{reason:'timer_expired'});
  // A different device could have committed while start was building the attempt.
  if(await ExamSubmission.exists({memberUserId,questionPaperId:paperId}))return {error:'EXAM_ALREADY_SUBMITTED'};
  return {attempt:serializeAttempt(attempt,paper,presentQuestions(paper,attempt)),paper:serializePaper(paper,undefined,book)};
}
function validateAnswers(answers,paper){
  const ids=new Set((paper.questionSnapshots||[]).map((q)=>String(q.questionId))),seen=new Set();
  for(const answer of answers){if(!ids.has(String(answer.questionId))||seen.has(String(answer.questionId))||!['A','B','C','D'].includes(answer.selectedOption))return false;seen.add(String(answer.questionId));}
  return answers.length<=ids.size;
}
async function expireWithoutSubmission(attempt,reason){await ExamAttempt.updateOne({_id:attempt._id,status:'in_progress'},{$set:{status:'expired',expiryReason:reason},$unset:{activeKey:1}});}
async function submitAttempt(id,memberUserId,answers=[],{reason='manual',clock=()=>new Date()}={}){
  let context=await ownedAttempt(id,memberUserId);if(context.error)return context;
  let {attempt,paper,book}=context;
  const existing=await submittedRecord(attempt,paper);if(existing)return existing;
  if(attempt.status!=='in_progress')return {error:'ATTEMPT_EXPIRED'};
  if(paper.status!=='published'||book?.status!=='published')return {error:'QUESTION_PAPER_NOT_OPEN'};
  paper=await ensurePaperSnapshot(paper);if(!paper)return {error:'PAPER_SNAPSHOT_UNAVAILABLE'};
  attempt=await adoptDeadline(attempt,paper);
  const now=clock(), expired=attempt.expiresAt<=now;
  if(reason==='timer_expired'&&!expired)return {error:'ATTEMPT_NOT_EXPIRED'};
  const chosen=expired?(attempt.answers||[]).filter((answer)=>answer.selectedOption).map((answer)=>({questionId:String(answer.questionId),selectedOption:answer.selectedOption})):answers;
  if(!validateAnswers(chosen,paper))return {error:'INVALID_ATTEMPT_ANSWERS'};
  await ensureExamStorage();
  const other=await ExamSubmission.findOne({memberUserId,questionPaperId:paper._id});
  if(other){if(String(other.attemptId)===String(id)){await projectSubmission(other);return {attempt:serializeAttempt(other,paper)};} if(expired)await expireWithoutSubmission(attempt,'EXAM_ALREADY_SUBMITTED');return {error:'EXAM_ALREADY_SUBMITTED'};}
  if(await ExamAttempt.exists({memberUserId,questionPaperId:paper._id,status:'submitted',_id:{$ne:attempt._id}})){if(expired)await expireWithoutSubmission(attempt,'EXAM_ALREADY_SUBMITTED');return {error:'EXAM_ALREADY_SUBMITTED'};}
  const dayKey=dhakaDay(now);
  // Legacy submitted rows are a static compatibility floor; all new writers use atomic unique submissions.
  if(await ExamAttempt.exists(legacyDayQuery(memberUserId,dayKey))){
    const retry=await submittedRecord(await ExamAttempt.findById(id),paper);if(retry)return retry;
    if(expired)await expireWithoutSubmission(attempt,'DAILY_SUBMISSION_LIMIT');return {error:'DAILY_SUBMISSION_LIMIT'};
  }
  const selected=new Map(chosen.map((answer)=>[String(answer.questionId),answer.selectedOption]));
  const graded=paper.questionSnapshots.map((q)=>{const key=paper.answerKey.find((item)=>String(item.questionId)===String(q.questionId));if(!key)throw storageError();const selectedOption=selected.get(String(q.questionId));const isCorrect=selectedOption===key.correctOption;return {questionId:q.questionId,selectedOption,correctOption:key.correctOption,isCorrect,marksAwarded:isCorrect?q.marks:0};});
  const score=Math.round(graded.reduce((sum,answer)=>sum+answer.marksAwarded,0)*1000000)/1000000;
  const candidate={memberUserId,questionPaperId:paper._id,attemptId:attempt._id,dayKey,paperTitle:paper.originalTitle||paper.title,academicContext:{className:paper.academicContext?.className||book.className,eligibleGroups:paper.eligibleGroups},answers:graded,score,total:paper.totalMarks,percentage:paper.totalMarks?Math.round(score/paper.totalMarks*10000)/100:0,startedAt:attempt.startedAt,expiresAt:attempt.expiresAt,submittedAt:now,submissionMode:expired?'timer_expired':'manual',paperSnapshotVersion:paper.snapshotVersion};
  let submission;
  try { [submission]=await ExamSubmission.create([candidate],{writeConcern}); }
  catch(error){
    // Resolve double taps, unique conflicts and lost acknowledgements against durable truth.
    const accepted=await ExamSubmission.findOne({attemptId:attempt._id,memberUserId}).readConcern('majority');
    if(accepted){await projectSubmission(accepted);return {attempt:serializeAttempt(accepted,paper)};}
    if(error.code!==11000){error.statusCode=503;error.code='SUBMISSION_UNCONFIRMED';throw error;}
    const completed=await ExamSubmission.exists({memberUserId,questionPaperId:paper._id});
    const code=completed?'EXAM_ALREADY_SUBMITTED':'DAILY_SUBMISSION_LIMIT';
    if(expired)await expireWithoutSubmission(attempt,code);
    return {error:code};
  }
  await projectSubmission(submission);
  await audit('EXAM_SUBMITTED',{actorUserId:memberUserId,metadata:{attemptId:String(id),paperId:String(paper._id),dayKey,mode:candidate.submissionMode}});
  return {attempt:serializeAttempt(submission,paper)};
}
async function getAttempt(id,memberUserId){
  const context=await ownedAttempt(id,memberUserId);if(context.error)return context;
  let {attempt,paper,book}=context;
  const submitted=await submittedRecord(attempt,paper);if(submitted)return {...submitted,paper:serializePaper(paper,undefined,book)};
  if(attempt.status==='expired')return {attempt:serializeAttempt(attempt,paper),paper:serializePaper(paper,undefined,book)};
  if(paper.status!=='published'||book?.status!=='published')return {error:'QUESTION_PAPER_NOT_OPEN'};
  attempt=await adoptDeadline(attempt,paper);
  if(attempt.expiresAt<=new Date())return submitAttempt(id,memberUserId,[],{reason:'timer_expired'});
  paper=await ensurePaperSnapshot(paper);if(!paper)return {error:'PAPER_SNAPSHOT_UNAVAILABLE'};
  return {attempt:serializeAttempt(attempt,paper,presentQuestions(paper,attempt)),paper:serializePaper(paper,undefined,book)};
}
async function saveAnswers(id,memberUserId,answers,revision,reviewQuestionIds){
  const context=await ownedAttempt(id,memberUserId);if(context.error)return context;
  let {attempt,paper,book}=context;
  const submitted=await submittedRecord(attempt,paper);if(submitted)return submitted;
  if(attempt.status!=='in_progress')return {error:'ATTEMPT_EXPIRED'};
  if(paper.status!=='published'||book?.status!=='published')return {error:'QUESTION_PAPER_NOT_OPEN'};
  paper=await ensurePaperSnapshot(paper);if(!paper)return {error:'PAPER_SNAPSHOT_UNAVAILABLE'};
  attempt=await adoptDeadline(attempt,paper);
  if(attempt.expiresAt<=new Date())return {error:'ATTEMPT_EXPIRED'};
  if(!validateAnswers(answers,paper))return {error:'INVALID_ATTEMPT_ANSWERS'};
  if(reviewQuestionIds?.some((id)=>!paper.questionSnapshots.some((q)=>String(q.questionId)===String(id))))return {error:'INVALID_ATTEMPT_ANSWERS'};
  const filter={_id:id,memberUserId,status:'in_progress',expiresAt:{$gt:new Date()},$expr:{$gt:['$expiresAt','$$NOW']},...(revision===0?{$or:[{answerRevision:0},{answerRevision:{$exists:false}}]}:{answerRevision:revision})};
  const saved=await ExamAttempt.findOneAndUpdate(filter,{$set:{answers,...(reviewQuestionIds?{reviewQuestionIds}:{})},$inc:{answerRevision:1}},{new:true,runValidators:true});
  if(!saved)return {error:'ATTEMPT_CHANGED_RELOAD'};
  return {attempt:serializeAttempt(saved,paper)};
}
async function listAttempts(memberUserId){
  const access=await memberRecord(memberUserId);if(access.error)return [];
  const [accepted,legacy]=await Promise.all([ExamSubmission.find({memberUserId}).sort({submittedAt:-1}).limit(100),ExamAttempt.find({memberUserId}).sort({createdAt:-1}).limit(100)]);
  const records=[...accepted,...legacy.filter((item)=>!accepted.some((record)=>String(record.attemptId)===String(item._id)))];
  const papers=await QuestionPaper.find({_id:{$in:records.map((r)=>r.questionPaperId)}});
  return records.filter((item)=>papers.some((p)=>String(p._id)===String(item.questionPaperId))).map((item)=>serializeAttempt(item,papers.find((p)=>String(p._id)===String(item.questionPaperId)))).sort((a,b)=>new Date(b.submittedAt||b.startedAt)-new Date(a.submittedAt||a.startedAt)).slice(0,100);
}
async function sweepExpiredAttempts(){
  const attempts=await ExamAttempt.find({status:'in_progress',expiresAt:{$lte:new Date()}}).sort({expiresAt:1}).limit(25);
  const summary={checked:attempts.length,submitted:0,closed:0,failed:0};
  for(const attempt of attempts){try{const result=await submitAttempt(String(attempt._id),attempt.memberUserId,[],{reason:'timer_expired'});if(result.attempt?.status==='submitted')summary.submitted++;else if(result.error&&['DAILY_SUBMISSION_LIMIT','EXAM_ALREADY_SUBMITTED','QUESTION_PAPER_NOT_OPEN','QUESTION_PAPER_NOT_ELIGIBLE','MEMBER_ACCESS_REQUIRED','MEMBER_PROFILE_INCOMPLETE'].includes(result.error)){await expireWithoutSubmission(attempt,result.error);summary.closed++;}else summary.failed++;}catch{summary.failed++;}}
  return summary;
}
function startExpiryWorker({intervalMs=15000}={}){
  let pending=null,stopped=false;
  const tick=()=>{if(stopped||pending)return;pending=sweepExpiredAttempts().catch(()=>undefined).finally(()=>{pending=null;});};
  const timer=setInterval(tick,intervalMs);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);if(pending)await pending;};
}
module.exports={ensureExamStorage,memberRecord,quotaStatus,completedPaperIds,listMemberPapers,paperDetail,startAttempt,submitAttempt,getAttempt,saveAnswers,listAttempts,sweepExpiredAttempts,startExpiryWorker,serializeAttempt};
