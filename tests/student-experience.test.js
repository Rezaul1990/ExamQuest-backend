const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { Book, Chapter, QuestionPaper, ExamAttempt, ExamSubmission } = require('../src/modules/exam/exam.models');
const { User, AuthSession } = require('../src/modules/auth/auth.models');
const { LearningBookmark, ExamReminder, QuestionReport } = require('../src/modules/exam/exam.learning-models');
const { issueAccessToken } = require('../src/modules/auth/auth.tokens');
const app = require('../src/app');

test('student experience: isolated HTTP ownership, release, learning, reports and reminders', async (t) => {
  const dbName = 'examquest_student_test_' + randomUUID().replaceAll('-','');
  await mongoose.connect('mongodb://127.0.0.1:27017/' + dbName, { serverSelectionTimeoutMS: 4000 });
  let server;
  try {
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    async function identity(role = 'MEMBER', group = 'Science') {
      const user = await User.create({ name:'Student Test', email:randomUUID()+'@example.test', passwordHash:'unused', role, group, className:'HSC', academicYear:2026, accountStatus:'active' });
      const session = await AuthSession.create({ userId:user._id, sessionId:randomUUID(), tokenFamilyId:randomUUID(), refreshTokenHash:randomUUID(), expiresAt:new Date(Date.now()+600000) });
      return { user, token:issueAccessToken(user,session) };
    }
    const admin=await identity('ADMIN'), member=await identity(), stranger=await identity(), wrongGroup=await identity('MEMBER','Humanities'), staff=await identity('STAFF');
    const book=await Book.create({ title:'Student Physics', subject:'Physics', className:'HSC', group:'Science', createdByUserId:admin.user._id });
    const chapter=await Chapter.create({ bookId:book._id, title:'Motion', createdByUserId:admin.user._id });
    const ids=[new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId()];
    async function paper(extra={}) {
      return QuestionPaper.create({ title:randomUUID(), bookId:book._id, chapterIds:[chapter._id], eligibleGroups:['Science'], durationMinutes:10,totalMarks:2,passMark:1,status:'published',snapshotVersion:1,
        academicContext:{ className:'HSC',bookTitle:'Student Physics',subject:'Physics' }, questions:ids.map((questionId)=>({questionId,marks:1})),
        questionSnapshots:ids.map((questionId,index)=>({questionId,chapterId:chapter._id,text:'Frozen question '+index,options:['A','B','C','D'].map((key)=>({key,text:'Option '+key})),marks:1})),
        answerKey:ids.map((questionId)=>({questionId,correctOption:'A',explanation:'FROZEN_EXPLANATION'})),createdByUserId:admin.user._id,...extra });
    }
    server=app.listen(0,'127.0.0.1'); await new Promise((r)=>server.once('listening',r));
    async function request(route, who=member, body, method=body?'PUT':'GET') {
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/exams'+route,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,...await response.json()};
    }
    const p=await paper(); let attempt;
    await t.test('review markers share answer revision; unknown IDs/stale saves rejected',async()=>{
      const start=await request('/question-papers/'+p._id+'/start',member,{},'POST'); assert.equal(start.status,201); attempt=start.data.attempt;
      const save=await request('/attempts/'+attempt.id+'/answers',member,{answers:[],reviewQuestionIds:[String(ids[1])],revision:0});
      assert.equal(save.status,200); assert.deepEqual(save.data.attempt.reviewQuestionIds,[String(ids[1])]);
      assert.deepEqual((await request('/attempts/'+attempt.id)).data.attempt.reviewQuestionIds,[String(ids[1])]);
      assert.equal((await request('/attempts/'+attempt.id+'/answers',member,{answers:[],reviewQuestionIds:[],revision:0})).status,409);
      assert.equal((await request('/attempts/'+attempt.id+'/answers',member,{answers:[],reviewQuestionIds:[String(new mongoose.Types.ObjectId())],revision:1})).status,400);
      assert.equal((await request('/learning/attempts/'+attempt.id+'/review')).status,409);
    });
    await t.test('submitted history/submit/review cannot disclose keys until final deadline',async()=>{
      const submitted=await request('/attempts/'+attempt.id+'/submit',member,{answers:[{questionId:String(ids[0]),selectedOption:'B'}]},'POST');
      assert.equal(submitted.status,200); assert.equal(submitted.data.attempt.score,0);
      for(const response of [submitted,await request('/attempts'),await request('/attempts/'+attempt.id),await request('/learning/attempts/'+attempt.id+'/review')]) {
        assert.ok(!JSON.stringify(response).includes('correctOption')); assert.ok(!JSON.stringify(response).includes('FROZEN_EXPLANATION'));
      }
      assert.equal((await request('/learning/attempts/'+attempt.id+'/questions/'+ids[0]+'/bookmark',member,{enabled:true})).status,403);
      await QuestionPaper.updateOne({_id:p._id},{$set:{availableUntil:new Date(Date.now()-60000)}});
      assert.equal((await request('/learning/attempts/'+attempt.id+'/review')).data.available,false);
      await QuestionPaper.updateOne({_id:p._id},{$set:{availableUntil:new Date(Date.now()-11*60000)}});
      const review=await request('/learning/attempts/'+attempt.id+'/review'); assert.equal(review.data.available,true);
      assert.equal(review.data.questions[0].explanation,'FROZEN_EXPLANATION');
      assert.deepEqual(review.data.questions.map((q)=>q.id),attempt.questions.map((q)=>q.id));
      assert.equal((await request('/learning/attempts/'+attempt.id+'/review',stranger)).status,404);
      assert.equal((await request('/learning/attempts/'+attempt.id+'/review',staff)).status,403);
      assert.equal((await request('/learning',null)).status,401);
    });
    await t.test('bookmark/practice/progress are owned, idempotent and deduplicate projections',async()=>{
      const path='/learning/attempts/'+attempt.id+'/questions/'+ids[0]+'/bookmark';
      await Promise.all([request(path,member,{enabled:true}),request(path,member,{enabled:true})]);
      assert.equal(await LearningBookmark.countDocuments({}),1);
      const overview=(await request('/learning')).data;
      assert.equal(overview.submissionCount,1); assert.equal(overview.chapters[0].total,2); assert.equal(overview.chapters[0].correct,0);
      assert.equal(overview.practice.length,2); assert.ok(overview.practice.some((q)=>q.bookmarked));
      assert.equal((await request('/learning',stranger)).data.practice.length,0);
      const quotaBefore=await ExamSubmission.countDocuments({}); await request('/learning'); assert.equal(await ExamSubmission.countDocuments({}),quotaBefore);
      await request(path,member,{enabled:false}); assert.equal(await LearningBookmark.countDocuments({}),0);
      await User.updateOne({_id:member.user._id},{$set:{group:'Humanities'}});
      assert.equal((await request('/learning')).data.submissionCount,0);
      assert.equal((await request('/learning/attempts/'+attempt.id+'/review')).status,403);
      await User.updateOne({_id:member.user._id},{$set:{group:'Science'}});
    });
    await t.test('question reports validate owned snapshot and Admin-only triage without regrading',async()=>{
      const path='/learning/attempts/'+attempt.id+'/questions/'+ids[0]+'/report';
      assert.equal((await request(path,stranger,{category:'unclear',detail:'Question unclear'})).status,404);
      assert.equal((await request(path,member,{category:'unclear',detail:'x',score:10})).status,422);
      const report=await request(path,member,{category:'unclear',detail:'Question wording unclear'}); assert.equal(report.status,200);
      await request(path,member,{category:'typo',detail:'Another request should not duplicate'}); assert.equal(await QuestionReport.countDocuments({}),1);
      assert.equal((await request('/admin/student-reports')).status,403); assert.equal((await request('/admin/student-reports',staff)).status,403);
      const list=await request('/admin/student-reports',admin); assert.equal(list.data.total,1); assert.ok(list.data.reports[0].questionText.startsWith('Frozen'));
      assert.equal((await request('/admin/student-reports/'+report.data.id,admin,{status:'resolved',resolution:'Checked; next revision will clarify'},'PATCH')).status,200);
      assert.equal((await request('/admin/student-reports/'+report.data.id,admin,{status:'dismissed',resolution:'Second update'},'PATCH')).status,409);
      assert.equal((await ExamSubmission.findOne({attemptId:attempt.id})).score,0);
    });
    await t.test('discovery and reminders exclude wrong audiences, drafts, expired and completed papers',async()=>{
      const upcoming=await paper({availableFrom:new Date(Date.now()+3600000)}), draft=await paper({status:'draft'});
      const found=(await request('/learning/discovery')).data.papers;
      assert.ok(found.some((x)=>x.id===String(upcoming._id)&&x.upcoming)); assert.ok(!found.some((x)=>[String(p._id),String(draft._id)].includes(x.id)));
      assert.equal((await request('/learning/discovery',wrongGroup)).data.papers.length,0);
      const path='/learning/papers/'+upcoming._id+'/reminder';
      await Promise.all([request(path,member,{enabled:true}),request(path,member,{enabled:true})]); assert.equal(await ExamReminder.countDocuments({}),1);
      assert.equal((await request('/learning/discovery')).data.papers.find((x)=>x.id===String(upcoming._id)).reminded,true);
      assert.equal((await request(path,wrongGroup,{enabled:true})).status,404);
      const early=await request('/question-papers/'+upcoming._id+'/start',stranger,{},'POST'); assert.equal(early.status,400); assert.equal(early.error,'QUESTION_PAPER_NOT_OPEN');
      await QuestionPaper.updateOne({_id:upcoming._id},{$set:{status:'archived'}});
      assert.ok(!(await request('/learning/discovery')).data.papers.some((x)=>x.id===String(upcoming._id)));
      assert.equal((await request(path,member,{enabled:false})).status,200); assert.equal(await ExamReminder.countDocuments({}),0);
    });
    await t.test('Admin closes unscheduled paper with delayed release; scheduled policy cannot be bypassed',async()=>{
      const open=await paper(), scheduled=await paper({availableUntil:new Date(Date.now()+3600000)});
      const path='/admin/question-papers/'+open._id+'/release-results';
      assert.equal((await request(path,member,{},'POST')).status,403); assert.equal((await request(path,staff,{},'POST')).status,403);
      assert.equal((await request(path,admin,{},'POST')).status,200);
      const closed=await QuestionPaper.findById(open._id); assert.ok(closed.availableUntil); assert.ok(closed.resultsReleaseScheduledAt);
      assert.equal((await request('/admin/question-papers/'+scheduled._id+'/release-results',admin,{},'POST')).status,409);
    });
    await t.test('legacy sparse answers retain the full frozen denominator; missing chapter stays unknown',async()=>{
      const legacy=await identity(), legacyPaper=await paper({questionSnapshots:ids.map((questionId)=>({questionId,text:'Older frozen question',options:['A','B','C','D'].map((key)=>({key,text:key})),marks:1}))});
      await ExamAttempt.create({memberUserId:legacy.user._id,questionPaperId:legacyPaper._id,status:'submitted',total:2,score:1,percentage:50,submittedAt:new Date(),answers:[{questionId:ids[0],selectedOption:'A',correctOption:'A',isCorrect:true,marksAwarded:1}]});
      const overview=(await request('/learning',legacy)).data;
      assert.equal(overview.chapters[0].total,2);assert.equal(overview.chapters[0].correct,1);assert.equal(overview.chapters[0].accuracy,50);assert.equal(overview.chapters[0].chapterId,null);
      assert.equal(overview.practice.length,0);assert.equal(overview.trend[0].percentage,50);
    });
    await t.test('learning startup refuses missing unique indexes without repairing or deleting data',async()=>{
      const {ensureLearningStorage}=require('../src/modules/exam/exam.learning-models');
      await ensureLearningStorage();
      const index=(await ExamReminder.collection.indexes()).find((i)=>i.unique&&Object.keys(i.key).join(',')==='memberUserId,paperId');
      await ExamReminder.collection.dropIndex(index.name);
      try{await assert.rejects(ensureLearningStorage(),{code:'LEARNING_STORAGE_NOT_READY'});}finally{await ExamReminder.createIndexes();}
    });
    await t.test('a start racing Admin close cannot outlive the final answer-release deadline',{timeout:5000},async()=>{
      const racer=await identity(), racingPaper=await paper();
      const original=ExamAttempt.findOneAndUpdate;
      let entered, resume;
      const reached=new Promise((resolve)=>{entered=resolve;}), barrier=new Promise((resolve)=>{resume=resolve;});
      ExamAttempt.findOneAndUpdate=function(filter,...args){
        if(filter.activeKey===String(racer.user._id)+':'+String(racingPaper._id)){
          entered();return barrier.then(()=>original.call(this,filter,...args));
        }
        return original.call(this,filter,...args);
      };
      let starting;
      try{
        starting=request('/question-papers/'+racingPaper._id+'/start',racer,{},'POST');
        await reached;
        const closed=await request('/admin/question-papers/'+racingPaper._id+'/release-results',admin,{},'POST');assert.equal(closed.status,200);
        const stored=await QuestionPaper.findById(racingPaper._id);
        await new Promise((resolve)=>setTimeout(resolve,15));resume();
        const response=await starting;assert.equal(response.status,201);
        assert.ok(Date.parse(response.data.attempt.expiresAt)<=stored.availableUntil.getTime()+stored.durationMinutes*60000);
      }finally{resume();ExamAttempt.findOneAndUpdate=original;if(starting)await starting;}
    });
  } finally {
    if(server) await new Promise((r)=>server.close(r));
    if(mongoose.connection.name!==dbName || !/^examquest_student_test_[a-f\d]+$/.test(dbName)) throw Error('Disposable cleanup guard failed');
    for(const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
  }
});
