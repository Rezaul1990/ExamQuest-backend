const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { Book, Chapter, Question, QuestionPaper, ExamAttempt } = require('../src/modules/exam/exam.models');
const { User, AuthSession, AuditLog } = require('../src/modules/auth/auth.models');
const { issueAccessToken } = require('../src/modules/auth/auth.tokens');
const service = require('../src/modules/exam/exam.service');
const authoring = require('../src/modules/exam/exam.authoring');

test('Phase 3: isolated MongoDB + real HTTP paper authoring', async (t) => {
  await mongoose.connect('mongodb://127.0.0.1:27017/examquest_paper_test_' + randomUUID().replaceAll('-',''), { serverSelectionTimeoutMS: 4000 });
  let server;
  try {
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    async function identity(role, extra = {}) {
      const user = await User.create({ name:'Paper Test',email:randomUUID()+'@example.test',passwordHash:'unused',role,accountStatus:'active',...extra });
      const session = await AuthSession.create({userId:user._id,sessionId:randomUUID(),tokenFamilyId:randomUUID(),refreshTokenHash:randomUUID(),expiresAt:new Date(Date.now()+600000)});
      return { user, token:issueAccessToken(user,session) };
    }
    const admin = await identity('ADMIN');
    const book = await Book.create({title:'Physics',subject:'Physics',className:'HSC',group:'Science',createdByUserId:admin.user._id});
    const common = await Book.create({title:'ICT',subject:'ICT',className:'HSC',group:'Science',eligibleGroups:['Science','Humanities','BusinessStudies'],createdByUserId:admin.user._id});
    const chapter = await Chapter.create({bookId:book._id,title:'Vector',createdByUserId:admin.user._id});
    const otherChapter = await Chapter.create({bookId:common._id,title:'Shared chapter',createdByUserId:admin.user._id});
    const staff = await identity('STAFF',{permissions:['CONTENT_READ','QUESTION_MANAGE','EXAM_MANAGE'],bookIds:[book._id]});
    const noScope = await identity('STAFF',{permissions:['CONTENT_READ','EXAM_MANAGE']});
    const member = await identity('MEMBER',{className:'HSC',group:'Science',academicYear:2026});
    const app = require('../src/app');server=app.listen(0,'127.0.0.1');await new Promise((resolve)=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/api/v1';
    async function request(path,body,who=admin,method=body?'POST':'GET') {
      const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return { status:response.status,...await response.json() };
    }
    const qPayload=(text)=>({bookId:String(book._id),chapterId:String(chapter._id),text,optionA:'Force',optionB:'Mass',optionC:'Time',optionD:'Temperature',correctOption:'A',explanation:'SECRET explanation',difficulty:'easy'});
    let questions=[];
    await t.test('new questions require sequential review, legacy active rows remain eligible',async()=>{
      for(let i=0;i<3;i++){
        const created=await request('/exams/admin/questions',qPayload('Question '+i));assert.equal(created.status,201);let q=created.data.question;assert.equal(q.reviewStatus,'draft');
        const denied=await request('/exams/admin/questions/'+q.id+'/review',{reviewStatus:'approved',revision:q.revision});assert.equal(denied.error,'INVALID_REVIEW_TRANSITION');
        q=(await request('/exams/admin/questions/'+q.id+'/review',{reviewStatus:'reviewed',revision:q.revision})).data.question;
        q=(await request('/exams/admin/questions/'+q.id+'/review',{reviewStatus:'approved',revision:q.revision})).data.question;questions.push(q);
      }
      const legacy = { bookId:book._id,chapterId:chapter._id,text:'Legacy bank question',options:['A','B','C','D'].map((key)=>({key,text:key})),correctOption:'B',status:'active',createdByUserId:admin.user._id,difficulty:'medium',__v:0 };
      await Question.collection.insertOne(legacy);
      const candidates=await request('/exams/admin/question-papers/candidates?bookId='+book._id);assert.equal(candidates.data.questions.length,4);
      assert.ok(!JSON.stringify(candidates.data).includes('correctOption'));assert.ok(!JSON.stringify(candidates.data).includes('explanation'));
      assert.equal(candidates.data.availability.reduce((sum,row)=>sum+row.approved,0),4);
      const pending=await Question.create({bookId:book._id,chapterId:chapter._id,text:'Pending medium question',options:['A','B','C','D'].map(key=>({key,text:key})),correctOption:'A',difficulty:'medium',status:'active',reviewStatus:'draft',createdByUserId:admin.user._id});
      const counts=(await request('/exams/admin/question-papers/candidates?bookId='+book._id)).data;
      assert.equal(counts.questions.length,5);
      assert.equal((await request('/exams/admin/question-papers/candidates?bookId='+book._id,undefined,staff)).data.questions.length,4);
      assert.deepEqual(counts.availability.find(row=>row.difficulty==='medium'),{chapterId:String(chapter._id),difficulty:'medium',total:2,approved:1,pendingReview:1});
      await Question.deleteOne({_id:pending._id});
    });
    const payload=()=>({title:'Reusable category title',bookId:String(book._id),chapterIds:[String(chapter._id)],eligibleGroups:['Science'],durationMinutes:20,totalMarks:2,passMark:1,questionIds:questions.map((q)=>q.id),status:'draft'});
    let paper;
    await t.test('mapping, question, mark and audience validation; draft creation',async()=>{
      assert.equal((await request('/exams/admin/question-papers',{...payload(),eligibleGroups:['Humanities']})).error,'PAPER_GROUP_MAPPING_INVALID');
      assert.equal((await request('/exams/admin/question-papers',{...payload(),chapterIds:[String(otherChapter._id)]})).error,'QUESTION_CHAPTER_MISMATCH');
      assert.equal((await request('/exams/admin/question-papers',{...payload(),questionIds:[questions[0].id,questions[0].id]})).error,'QUESTION_SELECTION_INVALID');
      assert.equal((await request('/exams/admin/question-papers',{...payload(),passMark:3})).error,'PASS_MARK_EXCEEDS_TOTAL');
      assert.equal((await request('/exams/admin/question-papers',{...payload(),status:'published'},staff)).error,'PAPER_REVIEW_REQUIRED');
      const created=await request('/exams/admin/question-papers',payload(),staff);assert.equal(created.status,201);paper=created.data.questionPaper;
      assert.equal((await request('/exams/admin/question-papers',payload())).error,'PAPER_TITLE_ALREADY_EXISTS');
      assert.equal((await request('/exams/admin/question-papers/'+paper.id+'/status',{status:'published',revision:paper.revision},staff)).error,'PAPER_REVIEW_REQUIRED');
    });
    await t.test('generation reports shortage, honors approved chapter/difficulty filters and returns no keys',async()=>{
      const result=await request('/exams/admin/question-papers/generate',{bookId:String(book._id),chapterIds:[String(chapter._id)],eligibleGroups:['Science'],count:10,difficulty:'easy',preferFresh:true},staff);
      assert.equal(result.data.availableCount,3);assert.equal(result.data.shortageCount,7);assert.equal(result.data.questionIds.length,3);assert.equal(result.data.reusedCount,3);
      const mismatch=await request('/exams/admin/question-papers/generate',{bookId:String(book._id),chapterIds:[String(otherChapter._id)],eligibleGroups:['Science'],count:1,preferFresh:true});assert.equal(mismatch.error,'CHAPTER_SELECTION_INVALID');
    });
    await t.test('scope applies to lists, direct IDs, creation, imports and permission checks',async()=>{
      const books=await request('/exams/admin/books',undefined,staff);assert.equal(books.data.books.length,1);
      assert.equal((await request('/exams/admin/books/'+common._id+'/chapters',undefined,staff)).status,403);
      assert.equal((await request('/exams/admin/question-papers/generate',{bookId:String(common._id),chapterIds:[String(otherChapter._id)],eligibleGroups:['Humanities'],count:1,preferFresh:true},staff)).status,403);
      assert.equal((await request('/exams/admin/question-papers',undefined,noScope)).data.questionPapers.length,0);
      assert.equal((await request('/exams/admin/question-papers/'+paper.id+'/preview',undefined,noScope)).status,403);
      assert.equal((await request('/exams/admin/question-papers',payload(),member)).status,403);
      assert.equal((await request('/exams/admin/question-papers',payload(),null)).status,401);
      const {HEADERS}=require('../src/modules/exam/exam.import');
      const data={book:'ICT',chapter:'Shared chapter',question:'Unscoped CSV question',optionA:'A',optionB:'B',optionC:'C',optionD:'D',correctOption:'A',explanation:'',difficulty:'easy',subject:'ICT',className:'HSC',group:'Science'};
      const preview=await request('/exams/admin/questions/import/preview',{csvText:HEADERS.join(',')+'\n'+HEADERS.map((h)=>data[h]).join(',')},staff);assert.equal(preview.data.validCount,0);
      assert.equal((await request('/exams/admin/question-papers/'+paper.id+'/status',{status:'published'},noScope)).status,403);
    });
    await t.test('student preview omits keys; ordered review, stale revision conflict, snapshot publish',async()=>{
      const preview=await request('/exams/admin/question-papers/'+paper.id+'/preview',undefined,staff);assert.equal(preview.data.questions.length,3);
      assert.ok(!JSON.stringify(preview.data).includes('correctOption'));assert.ok(!JSON.stringify(preview.data).includes('SECRET'));
      const reviewed=await request('/exams/admin/question-papers/'+paper.id+'/review',{reviewStatus:'reviewed',revision:paper.revision},staff);assert.equal(reviewed.status,200);const oldRevision=paper.revision;paper=reviewed.data.questionPaper;
      assert.equal((await request('/exams/admin/question-papers/'+paper.id+'/review',{reviewStatus:'approved',revision:oldRevision},staff)).error,'PAPER_CHANGED_RELOAD');
      paper=(await request('/exams/admin/question-papers/'+paper.id+'/review',{reviewStatus:'approved',revision:paper.revision},staff)).data.questionPaper;
      const published=await request('/exams/admin/question-papers/'+paper.id+'/status',{status:'published',revision:paper.revision},staff);assert.equal(published.status,200);paper=published.data.questionPaper;assert.equal(paper.snapshotVersion,1);
      assert.equal((await request('/exams/admin/question-papers/'+paper.id,{title:'Cannot mutate'},staff,'PATCH')).error,'PUBLISHED_PAPER_IMMUTABLE');
      assert.equal((await request('/exams/admin/question-papers/'+paper.id+'/status',{status:'draft'},staff)).error,'PUBLISHED_PAPER_IMMUTABLE');
    });
    let attempt;
    await t.test('bank edits after publication do not change student content/grading; fractional marks sum correctly',async()=>{
      const edited=await request('/exams/admin/questions/'+questions[0].id,{text:'Changed bank question',correctOption:'D'},admin,'PATCH');assert.equal(edited.data.question.reviewStatus,'draft');
      const start=await request('/exams/question-papers/'+paper.id+'/start',{},member);assert.equal(start.status,201);attempt=start.data.attempt;
      assert.equal(attempt.questions.find((q)=>q.id===questions[0].id).text,'Question 0');assert.ok(!JSON.stringify(attempt).includes('SECRET'));assert.ok(!JSON.stringify(attempt).includes('correctOption'));
      const submit=await request('/exams/attempts/'+attempt.id+'/submit',{answers:questions.map((q)=>({questionId:q.id,selectedOption:'A'}))},member);assert.equal(submit.data.attempt.score,2);assert.equal(submit.data.attempt.percentage,100);
      assert.equal((await request('/exams/question-papers',undefined,member)).data.questionPapers.length,0);
      assert.equal((await request('/exams/question-papers/'+paper.id+'/start',{},member)).error,'EXAM_ALREADY_SUBMITTED');
    });
    await t.test('archive preserves history and snapshots; same title/category can be recreated',async()=>{
      const archive=await request('/exams/admin/question-papers/'+paper.id,undefined,staff,'DELETE');assert.equal(archive.data.deletedMode,'archived');assert.equal(archive.data.attemptCount,1);
      assert.equal((await QuestionPaper.findById(paper.id)).status,'archived');assert.equal(await ExamAttempt.countDocuments(),1);
      const history=await request('/exams/attempts',undefined,member);assert.equal(history.data.attempts[0].paperTitle,paper.title);assert.equal(history.data.attempts[0].score,2);
      const recreated=await request('/exams/admin/question-papers',{...payload(),questionIds:[questions[1].id]});assert.equal(recreated.status,201);
      assert.equal((await request('/exams/admin/question-papers/'+paper.id+'/preview')).data.questions[0].text,'Question 0');
      assert.equal(await Question.countDocuments(),4);
    });
    await t.test('explicit shared-book audience permits common subjects, schedule stays closed before opening',async()=>{
      const q=await Question.create({bookId:common._id,chapterId:otherChapter._id,text:'Shared ICT question',options:['A','B','C','D'].map((key)=>({key,text:key})),correctOption:'A',reviewStatus:'approved',createdByUserId:admin.user._id});
      const data={...payload(),title:'Shared scheduled paper',bookId:String(common._id),chapterIds:[String(otherChapter._id)],eligibleGroups:['Humanities','BusinessStudies'],questionIds:[String(q._id)],availableFrom:new Date(Date.now()+3600000).toISOString(),availableUntil:new Date(Date.now()+7200000).toISOString()};
      let shared=(await request('/exams/admin/question-papers',data)).data.questionPaper;
      for(const reviewStatus of ['reviewed','approved'])shared=(await request('/exams/admin/question-papers/'+shared.id+'/review',{reviewStatus,revision:shared.revision})).data.questionPaper;
      shared=(await request('/exams/admin/question-papers/'+shared.id+'/status',{status:'published',revision:shared.revision})).data.questionPaper;
      assert.equal(shared.availabilityStatus,'scheduled');
      const humanities=await identity('MEMBER',{className:'HSC',group:'Humanities',academicYear:2026});
      assert.equal((await request('/exams/question-papers/'+shared.id+'/start',{},humanities)).error,'QUESTION_PAPER_NOT_OPEN');
    });
    await t.test('bank changes after review demand review again; invalid drafts stay previewable and editable',async()=>{
      let draft=(await request('/exams/admin/question-papers',{...payload(),title:'Review integrity',questionIds:[questions[1].id]})).data.questionPaper;
      draft=(await request('/exams/admin/question-papers/'+draft.id+'/review',{reviewStatus:'reviewed',revision:draft.revision})).data.questionPaper;
      await request('/exams/admin/questions/'+questions[1].id,{optionB:'Changed after review'},admin,'PATCH');
      const preview=await request('/exams/admin/question-papers/'+draft.id+'/preview');assert.equal(preview.status,200);assert.ok(preview.data.warnings.length);
      assert.equal((await request('/exams/admin/question-papers/'+draft.id+'/review',{reviewStatus:'approved',revision:draft.revision})).error,'PAPER_CONTENT_CHANGED_REVIEW_REQUIRED');
      let q=(await Question.findById(questions[1].id));
      q=(await request('/exams/admin/questions/'+q._id+'/review',{reviewStatus:'reviewed',revision:q.__v})).data.question;
      await request('/exams/admin/questions/'+q.id+'/review',{reviewStatus:'approved',revision:q.revision});
      assert.equal((await request('/exams/admin/question-papers/'+draft.id+'/review',{reviewStatus:'approved',revision:draft.revision})).error,'PAPER_CONTENT_CHANGED_REVIEW_REQUIRED');
      const edited=await request('/exams/admin/question-papers/'+draft.id,{title:'Review integrity corrected',revision:draft.revision,availableFrom:null,availableUntil:null},admin,'PATCH');
      assert.equal(edited.status,200);assert.equal(edited.data.questionPaper.reviewStatus,'draft');
      draft=edited.data.questionPaper;
      const results=await Promise.all([1,2].map(()=>request('/exams/admin/question-papers/'+draft.id+'/review',{reviewStatus:'reviewed',revision:draft.revision})));
      assert.equal(results.filter((result)=>result.status===200).length,1);
      const original = await Question.findById(questions[1].id);
      await Question.updateOne({ _id: original._id }, { $set: { bookId: common._id, chapterId: otherChapter._id, text: 'Restricted ICT content' } });
      const restrictedPreview = await request('/exams/admin/question-papers/'+draft.id+'/preview',undefined,staff);
      assert.equal(restrictedPreview.status,200); assert.ok(!JSON.stringify(restrictedPreview.data).includes('Restricted ICT content'));
      assert.deepEqual(restrictedPreview.data.questions[0].options,[]);
      await Question.updateOne({ _id: original._id }, { $set: { bookId: original.bookId, chapterId: original.chapterId, text: original.text } });
    });
    await t.test('editing legacy published bank references freezes content before modification',async()=>{
      const legacyQ = await Question.findOne({text:'Legacy bank question'}).select('+correctOption');
      const legacyPaper = await QuestionPaper.create({ title:'Legacy published', bookId:book._id, chapterIds:[chapter._id],eligibleGroups:['Science'],durationMinutes:20,totalMarks:1,passMark:1,questions:[{questionId:legacyQ._id,marks:1}],status:'published',createdByUserId:admin.user._id });
      const edited = await request('/exams/admin/questions/'+legacyQ._id,{text:'Edited legacy bank',correctOption:'D'},admin,'PATCH');assert.equal(edited.status,200);
      const frozen = await QuestionPaper.findById(legacyPaper._id).select('+answerKey');
      assert.equal(frozen.snapshotVersion,1);assert.equal(frozen.questionSnapshots[0].text,'Legacy bank question');assert.equal(frozen.answerKey[0].correctOption,'B');
      const deleting = await request('/exams/admin/question-papers/'+legacyPaper._id,undefined,admin,'DELETE');assert.equal(deleting.data.deletedMode,'archived');
      assert.equal((await request('/exams/admin/questions/'+legacyQ._id,undefined,admin,'DELETE')).status,200);
      assert.equal((await QuestionPaper.findById(legacyPaper._id)).questionSnapshots[0].text,'Legacy bank question');
    });
    await t.test('Admin imports 50 draft bank questions and publishes for members directly; Staff cannot bypass review',async()=>{
      const directChapter=(await request('/exams/admin/chapters',{bookId:String(book._id),title:'Direct import chapter',status:'published'})).data.chapter;
      const header=require('../src/modules/exam/exam.import').HEADERS.join(',');
      const csvText=header+'\n'+Array.from({length:50},(_,i)=>[book.title,directChapter.title,'Imported direct question '+i,'Force','Mass','Time','Temperature','A','Imported explanation',i<36?'easy':i<49?'medium':'hard','Physics','HSC','Science'].join(',')).join('\n');
      const preview=await request('/exams/admin/questions/import/preview',{csvText});assert.equal(preview.data.validCount,50);
      const imported=await request('/exams/admin/questions/import/commit',{rows:preview.data.validRows});assert.equal(imported.data.importedCount,50);
      const ids=imported.data.questions.map(q=>q.id);
      const candidates=await request('/exams/admin/question-papers/candidates?bookId='+book._id);
      assert.equal(candidates.data.questions.filter(q=>q.chapterId===directChapter.id).length,50);
      assert.ok(!JSON.stringify(candidates.data).includes('correctOption'));
      const generated=await request('/exams/admin/question-papers/generate',{bookId:String(book._id),chapterIds:[directChapter.id],eligibleGroups:['Science'],count:50,preferFresh:true});
      assert.equal(generated.data.shortageCount,0);assert.equal(generated.data.questionIds.length,50);
      const exam={...payload(),title:'Admin imported exam',chapterIds:[directChapter.id],questionIds:ids,totalMarks:50,passMark:20,status:'published'};
      assert.equal((await request('/exams/admin/question-papers',exam,staff)).error,'PAPER_REVIEW_REQUIRED');
      assert.equal((await request('/exams/admin/question-papers',exam,member)).status,403);
      assert.equal((await request('/exams/admin/question-papers',{...exam,eligibleGroups:['Humanities']})).error,'PAPER_GROUP_MAPPING_INVALID');
      const created=await request('/exams/admin/question-papers',exam);assert.equal(created.status,201);assert.equal(created.data.questionPaper.status,'published');assert.equal(created.data.questionPaper.snapshotVersion,1);
      assert.equal(await Question.countDocuments({_id:{$in:ids},reviewStatus:'draft'}),50);
      const learner=await identity('MEMBER',{className:'HSC',group:'Science',academicYear:2026});
      const outsider=await identity('MEMBER',{className:'HSC',group:'Humanities',academicYear:2026});
      assert.ok((await request('/exams/question-papers',undefined,learner)).data.questionPapers.some(p=>p.id===created.data.questionPaper.id));
      assert.ok(!(await request('/exams/question-papers',undefined,outsider)).data.questionPapers.some(p=>p.id===created.data.questionPaper.id));
      const started=await request('/exams/question-papers/'+created.data.questionPaper.id+'/start',{},learner);assert.equal(started.status,201);assert.equal(started.data.attempt.questions.length,50);assert.ok(!JSON.stringify(started.data).includes('correctOption'));
      const draft=await request('/exams/admin/question-papers',{...exam,title:'Admin optional draft',status:'draft'});assert.equal(draft.status,201);
      const published=await request('/exams/admin/question-papers/'+draft.data.questionPaper.id+'/status',{status:'published',revision:draft.data.questionPaper.revision});assert.equal(published.status,200);assert.equal(published.data.questionPaper.status,'published');
    });
    await t.test('Member has no admin endpoints even with forged management permissions; Staff needs assigned permission',async()=>{
      const forged=await identity('MEMBER',{permissions:['CONTENT_READ','CONTENT_MANAGE','QUESTION_MANAGE','EXAM_MANAGE'],bookIds:[book._id],className:'HSC',group:'Science',academicYear:2026});
      for(const who of [member,forged])for(const [route,method,body] of [
        ['/admin/books','GET'],['/admin/books/'+book._id+'/chapters','GET'],['/admin/questions','GET'],['/admin/question-papers','GET'],['/admin/question-papers/candidates?bookId='+book._id,'GET'],['/admin/question-papers/'+paper.id+'/preview','GET'],['/admin/question-analytics','GET'],
        ['/admin/books','POST',{}],['/admin/chapters','POST',{}],['/admin/questions','POST',{role:'ADMIN'}],['/admin/questions/import/preview','POST',{}],['/admin/questions/import/commit','POST',{}],['/admin/question-papers/generate','POST',{}],['/admin/question-papers','POST',payload()],['/admin/question-papers/'+paper.id+'/status','POST',{status:'published'}],['/admin/question-papers/'+paper.id+'/review','POST',{}],['/admin/questions/'+questions[0].id,'PATCH',{}],['/admin/questions/'+questions[0].id,'DELETE'],['/admin/question-papers/'+paper.id,'DELETE'],
        ['/admin/books/'+book._id,'PATCH',{}],['/admin/chapters/'+chapter._id,'PATCH',{}],['/admin/question-papers/'+paper.id,'PATCH',{}],['/admin/questions/'+questions[0].id+'/review','POST',{}],
        ['/admin/student-reports','GET'],['/admin/student-reports/'+questions[0].id,'PATCH',{}],['/admin/question-papers/'+paper.id+'/release-results','POST',{}],
      ])assert.equal((await request('/exams'+route,body,who,method)).status,403,method+' '+route);
      const limited=await identity('STAFF',{permissions:['CONTENT_READ'],bookIds:[book._id]});
      assert.equal((await request('/exams/admin/books',undefined,limited)).status,200);
      assert.equal((await request('/exams/admin/questions',qPayload('Denied staff question'),limited)).status,403);
      assert.equal((await request('/exams/admin/questions/import/commit',{rows:[]},limited)).status,403);
      assert.equal((await request('/exams/admin/question-papers',payload(),limited)).status,403);
      const allowed=await request('/exams/admin/questions',qPayload('Allowed scoped staff question'),staff);assert.equal(allowed.status,201);
      assert.equal((await request('/exams/question-papers',undefined,member)).status,200);
    });
    await t.test('cross-role account administration denies Member and all supported Staff permissions before mutations',async()=>{
      const { ROLE_PERMISSIONS } = require('../src/modules/auth/auth.constants');
      const fullStaff = await identity('STAFF',{permissions:ROLE_PERMISSIONS.STAFF,bookIds:[book._id]});
      const forged = await identity('MEMBER',{permissions:['USERS_MANAGE','STAFF_INVITE'],className:'HSC',group:'Science',academicYear:2026});
      const usersBefore = await User.countDocuments();
      const targetBefore = await User.findById(staff.user._id).lean();
      const routes = [
        ['/admin/staff/'+staff.user._id+'/scope','PATCH',{bookIds:[String(common._id)]}],
        ['/admin/staff','POST',{}],['/admin/staff/invite','POST',{}],['/admin/staff/invites','GET'],
        ['/admin/staff/invites/'+staff.user._id+'/regenerate','POST',{}],['/admin/staff/invites/'+staff.user._id+'/revoke','POST',{}],
        ['/admin/users','GET'],['/admin/users/'+staff.user._id+'/status','PATCH',{accountStatus:'suspended'}],
        ['/admin/users/'+staff.user._id+'/revoke-sessions','POST',{}],
      ];
      for (const who of [member,forged,fullStaff,null]) for (const [route,method,body] of routes) {
        const response = await request(route,body,who,method);
        assert.equal(response.status,who?403:401,method+' '+route);
        assert.equal(response.error,who?'FORBIDDEN':'AUTH_REQUIRED');
      }
      assert.equal(await User.countDocuments(),usersBefore);
      const targetAfter = await User.findById(staff.user._id).lean();
      assert.deepEqual(targetAfter.bookIds,targetBefore.bookIds);
      assert.equal(targetAfter.accountStatus,targetBefore.accountStatus);
      assert.equal(targetAfter.authVersion,targetBefore.authVersion);
      assert.equal((await request('/admin/users')).status,200);
      assert.equal((await request('/admin/staff/invites')).status,200);
      assert.equal((await request('/exams/admin/books',undefined,fullStaff)).status,200);
      assert.equal((await request('/exams/admin/question-analytics?bookId='+book._id,undefined,fullStaff)).status,403);
      assert.equal((await request('/exams/attempts',undefined,fullStaff)).status,403);
    });
    await t.test('admin can assign existing staff books; scope change revokes prior access session',async()=>{
      const response=await request('/admin/staff/'+noScope.user._id+'/scope',{bookIds:[String(book._id)]},admin,'PATCH');assert.equal(response.status,200);assert.deepEqual(response.data.user.bookIds,[String(book._id)]);
      assert.equal((await request('/exams/admin/books',undefined,noScope)).status,401);
      assert.equal((await request('/admin/staff/'+staff.user._id+'/scope',{bookIds:[String(common._id)]},staff,'PATCH')).status,403);
      assert.ok(await AuditLog.countDocuments({eventType:'PAPER_PUBLISHED'})>=2);assert.ok(await AuditLog.countDocuments({eventType:'PAPER_ARCHIVED'})>=1);assert.equal(await AuditLog.countDocuments({eventType:'STAFF_SCOPE_UPDATED'}),1);
    });
  } finally {
    if(server)await new Promise((resolve)=>server.close(resolve));
    for(const model of Object.values(mongoose.models))await model.deleteMany({});
    await mongoose.disconnect();
  }
});
