const {test}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const {Book,Chapter,QuestionPaper,ExamAttempt,ExamSubmission}=require('../src/modules/exam/exam.models');
const {User,AuthSession}=require('../src/modules/auth/auth.models');
const {issueAccessToken}=require('../src/modules/auth/auth.tokens');
const memberExams=require('../src/modules/exam/exam.member');
const {dhakaDay,dayBounds}=require('../src/modules/exam/exam.member-rules');
const execute=promisify(execFile);

test('Dhaka calendar boundary uses timezone, not UTC date or a rolling 24 hours',()=>{
  assert.equal(dhakaDay(new Date('2026-10-15T17:59:59.999Z')),'2026-10-15');
  assert.equal(dhakaDay(new Date('2026-10-15T18:00:00.000Z')),'2026-10-16');
  assert.equal(dayBounds('2026-10-16').start.toISOString(),'2026-10-15T18:00:00.000Z');
  assert.equal(dayBounds('2026-10-16').end.toISOString(),'2026-10-16T18:00:00.000Z');
});

test('Phase 4 standalone MongoDB + HTTP exam security',async(t)=>{
  const dbName='examquest_security_test_'+randomUUID().replaceAll('-','');
  await mongoose.connect('mongodb://127.0.0.1:27017/'+dbName,{serverSelectionTimeoutMS:4000});
  let server;
  try{
    await Promise.all(Object.values(mongoose.models).map((model)=>model.init()));
    const hello=await mongoose.connection.db.admin().command({hello:1});
    console.log('MongoDB topology:',hello.setName?'replica set':'standalone');
    await memberExams.ensureExamStorage();
    const creator=new mongoose.Types.ObjectId();
    const book=await Book.create({title:'Physics',subject:'Physics',className:'HSC',group:'Science',createdByUserId:creator});
    const chapter=await Chapter.create({bookId:book._id,title:'Vector',createdByUserId:creator});
    const ids=[new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId()];
    let serial=0;
    async function identity(extra={}){
      const user=await User.create({name:'Exam Test',email:randomUUID()+'@example.test',passwordHash:'unused',role:'MEMBER',accountStatus:'active',className:'HSC',group:'Science',academicYear:2026,...extra});
      const session=await AuthSession.create({userId:user._id,sessionId:randomUUID(),tokenFamilyId:randomUUID(),refreshTokenHash:randomUUID(),expiresAt:new Date(Date.now()+600000)});
      return {user,token:issueAccessToken(user,session)};
    }
    async function paper(extra={}){
      return QuestionPaper.create({title:'Security Paper '+serial++,bookId:book._id,chapterIds:[chapter._id],eligibleGroups:['Science'],durationMinutes:20,totalMarks:2,passMark:1,questions:ids.map((questionId)=>({questionId,marks:1})),status:'published',snapshotVersion:1,academicContext:{className:'HSC',subject:'Physics',bookTitle:'Physics'},questionSnapshots:ids.map((questionId,i)=>({questionId,text:'Public question '+i,options:['A','B','C','D'].map((key)=>({key,text:'Option '+key})),difficulty:'easy',marks:1})),answerKey:ids.map((questionId)=>({questionId,correctOption:'A',explanation:'PRIVATE_GRADING_SECRET'})),createdByUserId:creator,...extra});
    }
    const app=require('../src/app');server=app.listen(0,'127.0.0.1');await new Promise((resolve)=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/api/v1/exams';
    async function request(route,body,who,method=body?'POST':'GET'){
      const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,...await response.json()};
    }
    const chosen=ids.map((id)=>({questionId:String(id),selectedOption:'A'}));
    const start=async(p,who)=>{const response=await request('/question-papers/'+p._id+'/start',{},who);assert.equal(response.status,201,JSON.stringify(response));return response.data.attempt;};
    const submit=(attempt,who,answers=chosen)=>request('/attempts/'+attempt.id+'/submit',{answers},who);
    const child=async(who,attempt)=>{const response=await execute(process.execPath,[path.join(__dirname,'fixtures/submit-exam.cjs'),dbName,String(who.user._id),attempt.id]);return JSON.parse(response.stdout.trim());};

    await t.test('start/concurrent start, save/resume and leaving consume zero; timer and ownership are server-controlled',async()=>{
      const who=await identity(),p=await paper();
      const starts=await Promise.all(Array.from({length:8},()=>start(p,who)));
      assert.equal(new Set(starts.map((a)=>a.id)).size,1);const a=starts[0];
      assert.equal(await ExamAttempt.countDocuments({memberUserId:who.user._id,status:'in_progress'}),1);
      assert.equal((await request('/status',undefined,who)).data.used,0);
      const saved=await request('/attempts/'+a.id+'/answers',{answers:chosen,revision:0},who,'PUT');assert.equal(saved.status,200);assert.equal(saved.data.attempt.answerRevision,1);
      assert.ok(!JSON.stringify(saved.data).includes('correctOption'));assert.ok(!JSON.stringify(saved.data).includes('marksAwarded'));
      const resumed=await request('/attempts/'+a.id,undefined,who);assert.equal(resumed.data.attempt.answers.length,2);assert.equal(resumed.data.attempt.expiresAt,a.expiresAt);
      assert.equal((await request('/status',undefined,who)).data.used,0);
      assert.equal((await request('/attempts/'+a.id+'/answers',{answers:[],revision:0},who,'PUT')).error,'ATTEMPT_CHANGED_RELOAD');
      const stranger=await identity();assert.equal((await request('/attempts/'+a.id,undefined,stranger)).status,404);
      assert.equal((await submit(a,stranger)).status,404);
      assert.equal((await request('/attempts/'+a.id+'/submit',{answers:chosen,score:999,submittedAt:'2030-01-01'},who)).status,422);
      assert.equal((await request('/attempts/'+a.id+'/submit',{answers:[],reason:'timer_expired'},who)).error,'ATTEMPT_NOT_EXPIRED');
    });
    await t.test('invalid or failed submit never consumes quota; failed persistence is safely retryable',async()=>{
      const who=await identity(),a=await start(await paper(),who);
      assert.equal((await submit(a,who,[chosen[0],chosen[0]])).error,'INVALID_ATTEMPT_ANSWERS');
      assert.equal((await submit(a,who,[{questionId:String(new mongoose.Types.ObjectId()),selectedOption:'A'}])).error,'INVALID_ATTEMPT_ANSWERS');
      const original=ExamSubmission.create;ExamSubmission.create=async()=>{throw Error('Simulated database write failure');};
      try{const failed=await submit(a,who);assert.equal(failed.status,503);assert.equal(failed.error,'SUBMISSION_UNCONFIRMED');}finally{ExamSubmission.create=original;}
      assert.equal((await request('/status',undefined,who)).data.used,0);
      const accepted=await submit(a,who);assert.equal(accepted.status,200);assert.equal(accepted.data.attempt.score,2);
      const retry=await submit(a,who,[]);assert.equal(retry.data.attempt.score,2);assert.equal(retry.data.attempt.submittedAt,accepted.data.attempt.submittedAt);
      assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),1);
    });
    await t.test('different devices/processes submitting different exams accept exactly one per Dhaka day',async()=>{
      const who=await identity();const ps=await Promise.all(Array.from({length:6},()=>paper()));
      const active=await Promise.all(ps.map((p)=>start(p,who)));
      const results=await Promise.all(active.map((attempt)=>child(who,attempt)));
      assert.equal(results.filter((r)=>r.status==='submitted').length,1);
      assert.equal(results.filter((r)=>r.error==='DAILY_SUBMISSION_LIMIT').length,5);
      assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),1);
      const fresh=await request('/question-papers/'+(await paper())._id+'/start',{},who);assert.equal(fresh.error,'DAILY_SUBMISSION_LIMIT');
    });
    await t.test('same-attempt double taps/manual+expiry races return one immutable accepted result',async()=>{
      const who=await identity(),a=await start(await paper(),who);
      await request('/attempts/'+a.id+'/answers',{answers:chosen,revision:0},who,'PUT');
      await ExamAttempt.updateOne({_id:a.id},{$set:{expiresAt:new Date(Date.now()-1000)}});
      const results=await Promise.all(Array.from({length:10},(_,i)=>request('/attempts/'+a.id+'/submit',{answers:i%2?[]:chosen,reason:i%2?'timer_expired':'manual'},who)));
      assert.ok(results.every((r)=>r.status===200));assert.ok(results.every((r)=>r.data.attempt.score===2));
      assert.equal(new Set(results.map((r)=>r.data.attempt.submittedAt)).size,1);assert.equal(await ExamSubmission.countDocuments({attemptId:a.id}),1);
    });
    await t.test('timer expiry rejects late answer changes; worker persists saved answers and survives retry',async()=>{
      const who=await identity(),a=await start(await paper(),who);
      await request('/attempts/'+a.id+'/answers',{answers:[chosen[0]],revision:0},who,'PUT');
      await ExamAttempt.updateOne({_id:a.id},{$set:{expiresAt:new Date(Date.now()-1000)}});
      assert.equal((await request('/attempts/'+a.id+'/answers',{answers:chosen,revision:1},who,'PUT')).error,'ATTEMPT_EXPIRED');
      await memberExams.sweepExpiredAttempts();
      const result=await submit(a,who,chosen);assert.equal(result.data.attempt.score,1);assert.equal(result.data.attempt.submissionMode,'timer_expired');
      assert.equal((await request('/status',undefined,who)).data.used,1);
    });
    await t.test('quota-denied expiry closes without burning tomorrow; next Dhaka day may submit a different paper',async()=>{
      const who=await identity();const first=await paper(),second=await paper();
      const a=await start(first,who),b=await start(second,who);await submit(a,who);
      await ExamAttempt.updateOne({_id:b.id},{$set:{expiresAt:new Date(Date.now()-1000)}});
      const denied=await request('/attempts/'+b.id+'/submit',{answers:[],reason:'timer_expired'},who);assert.equal(denied.error,'DAILY_SUBMISSION_LIMIT');
      const closed=await ExamAttempt.findById(b.id);assert.equal(closed.status,'expired');assert.ok(!closed.activeKey);
      assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),1);
      const future=new Date(dayBounds(dhakaDay(new Date())).end.getTime()+1000);
      assert.equal((await memberExams.quotaStatus(who.user._id,future)).used,0);
      const next=await paper();const fresh=await ExamAttempt.create({memberUserId:who.user._id,questionPaperId:next._id,total:2,startedAt:future,expiresAt:new Date(future.getTime()+600000)});
      const accepted=await memberExams.submitAttempt(String(fresh._id),who.user._id,chosen,{clock:()=>future});assert.equal(accepted.attempt.status,'submitted');
      assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),2);
    });
    await t.test('one paper cannot be accepted twice even when concurrent attempts straddle Dhaka midnight',async()=>{
      const who=await identity(),p=await paper();
      const before=new Date('2027-01-15T17:59:59.999Z'),after=new Date('2027-01-15T18:00:00.000Z');
      const legacy=await Promise.all([1,2].map(()=>ExamAttempt.create({memberUserId:who.user._id,questionPaperId:p._id,total:2,startedAt:new Date(before.getTime()-60000),expiresAt:new Date(after.getTime()+60000)})));
      const results=await Promise.all(legacy.map((attempt,i)=>memberExams.submitAttempt(String(attempt._id),who.user._id,chosen,{clock:()=>i?after:before})));
      assert.equal(results.filter((r)=>r.attempt?.status==='submitted').length,1);
      assert.equal(results.filter((r)=>r.error==='EXAM_ALREADY_SUBMITTED').length,1);
      assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id,questionPaperId:p._id}),1);
    });
    await t.test('durable result survives failed attempt projection, process restart and retry',async()=>{
      const who=await identity(),p=await paper(),a=await start(p,who);
      const original=ExamAttempt.updateOne;
      ExamAttempt.updateOne=function(filter,update,...args){if(update?.$set?.status==='submitted')throw Error('Simulated projection failure');return original.call(this,filter,update,...args);};
      try{const result=await submit(a,who);assert.equal(result.status,200);assert.equal(result.data.attempt.score,2);}finally{ExamAttempt.updateOne=original;}
      assert.equal((await ExamAttempt.findById(a.id)).status,'in_progress');
      const visible=await request('/question-papers',undefined,who);assert.ok(!visible.data.questionPapers.some((entry)=>entry.id===String(p._id)));
      const history=await request('/attempts',undefined,who);assert.equal(history.data.attempts.filter((entry)=>entry.id===a.id).length,1);assert.equal(history.data.attempts.find((entry)=>entry.id===a.id).score,2);
      const retry=await child(who,a);assert.equal(retry.status,'submitted');assert.equal(retry.score,2);
      assert.equal((await ExamAttempt.findById(a.id)).status,'submitted');assert.equal(await ExamSubmission.countDocuments({attemptId:a.id}),1);
    });
    await t.test('completed paper stays hidden forever, legacy submitted rows enforce quota/history without migration',async()=>{
      const who=await identity(),p=await paper();
      const old=await ExamAttempt.create({memberUserId:who.user._id,questionPaperId:p._id,status:'submitted',score:1,total:2,percentage:50,submittedAt:new Date(),answers:[{questionId:ids[0],selectedOption:'A',correctOption:'A',isCorrect:true,marksAwarded:1}]});
      assert.equal((await request('/status',undefined,who)).data.used,1);
      assert.equal((await request('/question-papers/'+p._id+'/start',{},who)).error,'EXAM_ALREADY_SUBMITTED');
      const retry=await submit({id:String(old._id)},who,[]);assert.equal(retry.data.attempt.score,1);assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),0);
      const next=await request('/question-papers/'+(await paper())._id+'/start',{},who);assert.equal(next.error,'DAILY_SUBMISSION_LIMIT');
      const tomorrow=new Date(dayBounds(dhakaDay(new Date())).end.getTime()+1000);assert.equal((await memberExams.quotaStatus(who.user._id,tomorrow)).used,0);
      assert.ok((await memberExams.completedPaperIds(who.user._id)).includes(String(p._id)));
    });
    await t.test('old successful paper cannot be resubmitted via a different legacy attempt on a later day',async()=>{
      const who=await identity(),p=await paper();
      const yesterday=new Date(dayBounds(dhakaDay(new Date())).start.getTime()-1000);
      await ExamAttempt.create({memberUserId:who.user._id,questionPaperId:p._id,status:'submitted',score:2,total:2,percentage:100,submittedAt:yesterday});
      const legacy=await ExamAttempt.create({memberUserId:who.user._id,questionPaperId:p._id,total:2,startedAt:new Date(),expiresAt:new Date(Date.now()+600000)});
      const response=await submit({id:String(legacy._id)},who);
      assert.equal(response.error,'EXAM_ALREADY_SUBMITTED');assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),0);
      assert.equal((await request('/status',undefined,who)).data.used,0);
    });
    await t.test('cross-group/class starts and cross-owner access denied; owned attempts survive academic changes',async()=>{
      const who=await identity(),p=await paper(),a=await start(p,who);
      const outsider=await identity({group:'Humanities'}),wrongClass=await identity({className:'SSC'}),admin=await identity({role:'ADMIN'});
      for(const actor of [outsider,wrongClass]){
        assert.ok(!(await request('/question-papers',undefined,actor)).data.questionPapers.some((entry)=>entry.id===String(p._id)));
        assert.equal((await request('/question-papers/'+p._id,undefined,actor)).status,404);
        assert.equal((await request('/question-papers/'+p._id+'/start',{},actor)).status,403);
        assert.equal((await request('/attempts/'+a.id,undefined,actor)).status,404);
      }
      assert.equal((await request('/books',undefined,outsider)).data.books.length,0);
      assert.equal((await request('/books/'+book._id+'/chapters',undefined,outsider)).data.chapters.length,0);
      assert.equal((await request('/books',undefined,admin)).status,403);
      assert.equal((await request('/status',undefined,null)).status,401);
      await User.updateOne({_id:who.user._id},{$set:{group:'Humanities'}});
      for(const [route,body,method] of [['/attempts/'+a.id,undefined,'GET'],['/attempts/'+a.id+'/answers',{answers:chosen,revision:0},'PUT'],['/attempts/'+a.id+'/submit',{answers:chosen},'POST']])assert.equal((await request(route,body,who,method)).status,200);
      assert.equal((await request('/attempts',undefined,who)).data.attempts.length,1);
      assert.equal((await request('/question-papers/'+(await paper())._id+'/start',{},who)).status,403);
    });
    await t.test('unsubmitted payloads never expose grading keys; archive retains authorized completed result',async()=>{
      const who=await identity(),p=await paper(),a=await start(p,who);
      for(const response of [a,(await request('/attempts/'+a.id,undefined,who)).data,(await request('/attempts',undefined,who)).data])for(const field of ['correctOption','PRIVATE_GRADING_SECRET','isCorrect','marksAwarded','answerKey'])assert.ok(!JSON.stringify(response).includes(field),field);
      await submit(a,who);await require('../src/modules/exam/exam.authoring').deleteQuestionPaper(String(p._id),creator);
      const result=await request('/attempts/'+a.id,undefined,who);assert.equal(result.status,200);assert.equal(result.data.attempt.score,2);assert.ok(result.data.attempt.answers.every((answer)=>answer.correctOption===undefined));
      await QuestionPaper.updateOne({_id:p._id},{$set:{availableUntil:new Date(Date.now()-21*60000)}});
      assert.ok((await request('/attempts/'+a.id,undefined,who)).data.attempt.answers.every((answer)=>answer.correctOption==='A'));
      await User.updateOne({_id:who.user._id},{$set:{group:'Humanities'}});
      assert.equal((await request('/attempts/'+a.id,undefined,who)).status,200);
      assert.equal((await request('/attempts',undefined,who)).data.attempts.length,1);
    });
    await t.test('missing uniqueness indexes fail closed before any quota/result commit',async()=>{
      const who=await identity(),a=await start(await paper(),who);
      await ExamSubmission.collection.dropIndex('one_submission_per_dhaka_day');
      try{const blocked=await submit(a,who);assert.equal(blocked.status,503);assert.equal(blocked.error,'EXAM_STORAGE_NOT_READY');assert.equal(await ExamSubmission.countDocuments({memberUserId:who.user._id}),0);}finally{await ExamSubmission.collection.createIndex({memberUserId:1,dayKey:1},{unique:true,name:'one_submission_per_dhaka_day'});}
    });
  }finally{
    if(server)await new Promise((resolve)=>server.close(resolve));
    if(mongoose.connection.name!==dbName)throw Error('Disposable cleanup guard failed');
    for(const model of Object.values(mongoose.models))await model.deleteMany({});
    await mongoose.disconnect();
  }
});
