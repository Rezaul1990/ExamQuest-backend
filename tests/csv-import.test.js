const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { HEADERS, parseCsv, validateRecords, previewImport, commitImport } = require('../src/modules/exam/exam.import');
const { Book, Chapter, Question, QuestionPaper, ExamAttempt } = require('../src/modules/exam/exam.models');
const { User, AuthSession } = require('../src/modules/auth/auth.models');
const { issueAccessToken } = require('../src/modules/auth/auth.tokens');
const service = require('../src/modules/exam/exam.service');
const row = (question = 'Which quantity is a vector?') => ({ book: 'Physics 1st Paper', chapter: 'Vector', question, optionA: 'Force', optionB: 'Mass', optionC: 'Time', optionD: 'Temperature', correctOption: 'A', explanation: '', difficulty: 'easy', subject: 'Physics', className: 'HSC', group: 'Science' });
const csv = (rows) => HEADERS.join(',') + '\r\n' + rows.map((r) => HEADERS.map((h) => '"' + String(r[h]).replace(/"/g,'""') + '"').join(',')).join('\r\n');

test('strict CSV syntax, BOM, Bangla, quoted commas/newlines/double quotes and limits', () => {
  const data = row('বাংলা, প্রশ্ন\n"উত্তর"');
  assert.equal(validateRecords(parseCsv('\uFEFF' + csv([data]))).rows[0].data.question, data.question);
  for (const bad of ['a"b,c', '"abc', '"abc"xyz']) assert.ok(parseCsv(bad).errors.length);
  assert.ok(validateRecords(parseCsv('')).errors.length);
  assert.ok(validateRecords(parseCsv(HEADERS.join(','))).errors.length);
  assert.ok(validateRecords(parseCsv(csv([row()]).replace('book,chapter','chapter,book'))).errors.length);
  assert.equal(validateRecords(parseCsv(csv(Array.from({length:51}, (_,i)=>row('Question '+i))))).validCount, 0);
  assert.ok(parseCsv('a'.repeat(500001)).errors.length);
  const width = validateRecords(parseCsv(csv([row()]) + ',extra'));
  assert.ok(width.rows[0].errors.some((e)=>e.includes('13 columns')));
  const long = row(); long.optionA = 'x'.repeat(501);
  assert.equal(validateRecords(parseCsv(csv([long]))).validCount, 0);
});

test('disposable MongoDB CSV and API integration', async (t) => {
  const dbName = 'examquest_csv_test_' + randomUUID().replaceAll('-','');
  await mongoose.connect('mongodb://127.0.0.1:27017/' + dbName, { serverSelectionTimeoutMS: 4000 });
  let server;
  try {
    const actor = new mongoose.Types.ObjectId();
    await Promise.all([Book.init(), Chapter.init(), Question.init(), User.init(), AuthSession.init()]);
    const book = await Book.create({ title: row().book, subject: 'Physics', className: 'HSC', group: 'Science', createdByUserId: actor });
    const chapter = await Chapter.create({ bookId: book._id, title: 'Vector', createdByUserId: actor });
    await t.test('five rows/two duplicates -> remove original or all duplicates -> three imports', async () => {
      const input = [row(), row(), row('Second question'), row('Second question'), row('Third question')];
      const first = await previewImport(csv(input));
      assert.equal(first.validCount, 3); assert.equal(first.duplicateCount, 2);
      const withoutOriginal = await previewImport(csv(input.slice(1)), [3,4,5,6]);
      assert.equal(withoutOriginal.rows[0].errors.length, 0);
      const remainder = first.rows.filter((r)=>!r.duplicate);
      const result = await commitImport(remainder.map((r)=>r.data), actor, remainder.map((r)=>r.rowNumber));
      assert.equal(result.importedCount, 3); assert.equal(await QuestionPaper.countDocuments(),0);
      const retry = await commitImport(remainder.map((r)=>r.data),actor);
      assert.equal(retry.importedCount,0); assert.equal(retry.skippedDuplicateCount,3);
    });
    await t.test('normalized legacy DB duplicates and options conflict are distinct', async () => {
      await Question.create({ bookId: book._id, chapterId: chapter._id, text: 'Legacy   Question', options: ['A','B','C','D'].map((key,i)=>({key,text:['Force','Mass','Time','Temperature'][i]})), correctOption:'A',createdByUserId:actor });
      const input=row('  LEGACY question ');input.book=' physics 1st paper ';
      const result=await previewImport(csv([input])); assert.equal(result.duplicateCount,1);
      input.optionA='Different answer'; const conflict=await previewImport(csv([input]));
      assert.equal(conflict.duplicateCount,0); assert.equal(conflict.validCount,0);
    });
    await t.test('mapping errors are removable; final commit never creates taxonomy', async () => {
      const invalid=row('Invalid taxonomy question'); invalid.chapter='Typo chapter';
      const valid=row('Valid remainder question');
      const result=await commitImport([invalid,valid],actor,[11,12]);
      assert.equal(result.invalidCount,1);assert.equal(result.importedCount,1);assert.equal(result.rows[0].rowNumber,11);
      assert.equal(await Chapter.countDocuments(),1);assert.equal(await Book.countDocuments(),1);
    });
    await t.test('concurrent normalized imports count only actual inserts', async () => {
      const a=row('Concurrent question'), b=row('CONCURRENT   QUESTION');
      const results=await Promise.all(Array.from({length:8},(_,i)=>commitImport([i%2?a:b],actor)));
      assert.equal(results.reduce((sum,r)=>sum+r.importedCount,0),1);
      assert.equal(results.reduce((sum,r)=>sum+r.skippedDuplicateCount,0),7);
    });
    await t.test('edited value is revalidated against DB and new values are committed', async () => {
      const initial=await previewImport(csv([row()]));assert.equal(initial.duplicateCount,1);
      const edited={...row(),question:'Edited preview question'};
      const result=await previewImport(csv([edited]),[25]);assert.equal(result.validCount,1);
      const commit=await commitImport(result.validRows,actor,[25]);assert.equal(commit.questions[0].text,edited.question);
    });
    await t.test('shared books match every eligible group; duplicate identity stays within the book and chapter', async () => {
      const shared = await Book.create({ title: 'Bangla 1st Paper', subject: 'Bangla', className: 'HSC', group: 'Science', eligibleGroups: ['Science', 'Humanities', 'BusinessStudies'], createdByUserId: actor });
      const first = await Chapter.create({ bookId: shared._id, title: 'অপরিচিতা', createdByUserId: actor });
      const second = await Chapter.create({ bookId: shared._id, title: 'Another chapter', createdByUserId: actor });
      const input = { ...row('অপরিচিতা গল্পের কথক কে?'), book: shared.title, subject: 'Bangla', chapter: first.title, group: 'Arts' };
      for (const group of ['Arts', 'Humanities', 'Science', 'Commerce', 'BusinessStudies']) {
        const preview = await previewImport(csv([{ ...input, group }]), undefined, { role: 'ADMIN' });
        assert.equal(preview.validCount, 1, group);
        assert.equal(preview.duplicateCount, 0);
      }
      const receipt = await commitImport([input], actor, undefined, { role: 'ADMIN' });
      assert.equal(receipt.importedCount, 1);
      for (const group of ['Science', 'Arts']) {
        assert.equal((await previewImport(csv([{ ...input, group }]))).duplicateCount, 1);
      }
      assert.equal((await previewImport(csv([{ ...input, question: 'A different question in the same chapter' }]))).validCount, 1);
      assert.equal((await previewImport(csv([{ ...input, chapter: second.title }]))).validCount, 1);
      await Chapter.create({ bookId: book._id, title: first.title, createdByUserId: actor });
      assert.equal((await previewImport(csv([{ ...input, book: book.title, subject: book.subject, group: 'Science' }]))).validCount, 1);
      assert.equal((await previewImport(csv([{ ...input, question: 'Scoped question' }]), undefined, { role: 'STAFF', bookIds: [] })).validCount, 0);
      await Book.updateOne({ _id: shared._id }, { $set: { eligibleGroups: ['Science'] } });
      const denied = await previewImport(csv([{ ...input, question: 'Ineligible audience question' }]));
      assert.equal(denied.validCount, 0);
      assert.equal(denied.duplicateCount, 0);
    });
    await t.test('completed paper hiding/start guard remains intact', async () => {
      const q=await Question.findOne();
      const paper=await QuestionPaper.create({ title:'Regression paper',bookId:book._id,chapterIds:[chapter._id],eligibleGroups:['Science'],durationMinutes:20,totalMarks:1,passMark:1,questions:[{questionId:q._id,marks:1}],status:'published',createdByUserId:actor });
      const member=await User.create({name:'Test Member',email:'member@example.test',passwordHash:'unused',role:'MEMBER',accountStatus:'active',className:'HSC',group:'Science',academicYear:2026});
      await ExamAttempt.create({memberUserId:member._id,questionPaperId:paper._id,total:1,status:'submitted'});
      assert.equal((await service.listQuestionPapers({memberUserId:member._id},{memberOnly:true})).length,0);
      assert.equal((await service.startAttempt(String(paper._id),member._id)).error,'EXAM_ALREADY_SUBMITTED');
    });
    await t.test('real HTTP auth, permission, validation, preview and commit DTOs', async () => {
      const app=require('../src/app');server=app.listen(0,'127.0.0.1');await new Promise((resolve)=>server.once('listening',resolve));
      const base='http://127.0.0.1:'+server.address().port+'/api/v1/exams/admin/questions/import/';
      async function token(role,permissions=[]) {
        const user=await User.create({name:'CSV Test',email:randomUUID()+'@example.test',passwordHash:'unused',role,permissions,accountStatus:'active'});
        const session=await AuthSession.create({userId:user._id,sessionId:randomUUID(),tokenFamilyId:randomUUID(),refreshTokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)});
        return issueAccessToken(user,session);
      }
      const admin=await token('ADMIN'),staff=await token('STAFF');
      const post=(path,body,access)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},body:JSON.stringify(body)});
      assert.equal((await post('preview',{csvText:csv([row()])})).status,401);
      assert.equal((await post('preview',{csvText:csv([row()])},staff)).status,403);
      assert.equal((await post('commit',{rows:[]},admin)).status,422);
      const data=row('HTTP imported question');
      const preview=await (await post('preview',{csvText:csv([data]),rowNumbers:[42]},admin)).json();assert.equal(preview.data.rows[0].rowNumber,42);assert.equal(preview.data.validCount,1);
      const bad={...row('Bad row'),optionA:''};
      const mixed=await (await post('commit',{rows:[bad,row('HTTP valid remainder')],rowNumbers:[31,32]},admin)).json();
      assert.equal(mixed.data.importedCount,1);assert.equal(mixed.data.invalidCount,1);assert.equal(mixed.data.rows[0].rowNumber,31);
      const response=await post('commit',{rows:preview.data.validRows,rowNumbers:[42]},admin);assert.equal(response.status,201);
      const receipt=await response.json();assert.equal(receipt.data.importedCount,1);assert.equal(receipt.data.rows[0].rowNumber,42);
    });
  } finally {
    if(server) await new Promise((resolve)=>server.close(resolve));
    // Only this newly created disposable database is touched; leave an empty DB.
    for(const model of Object.values(mongoose.models)) await model.deleteMany({});
    await mongoose.disconnect();
  }
});
