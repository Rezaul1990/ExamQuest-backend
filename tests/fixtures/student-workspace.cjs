// Disposable UI verification only. Never reads .env or connects to application DB.
const mongoose=require('mongoose'),express=require('express');
const {randomUUID}=require('node:crypto');
const {Book,Chapter,QuestionPaper,ExamAttempt,ExamSubmission}=require('../../src/modules/exam/exam.models');
const {User}=require('../../src/modules/auth/auth.models');
const {hashPassword}=require('../../src/modules/auth/auth.crypto');
const member=require('../../src/modules/exam/exam.member');
const app=require('../../src/app');
(async()=>{
  const dbName='examquest_student_ui_'+randomUUID().replaceAll('-','');
  await mongoose.connect('mongodb://127.0.0.1:27017/'+dbName,{serverSelectionTimeoutMS:4000});
  await Promise.all(Object.values(mongoose.models).map((m)=>m.init()));
  const passwordHash=await hashPassword('StudentDemo123!');
  const users=await Promise.all([['MEMBER','student'],['ADMIN','admin'],['STAFF','staff'],['MEMBER','empty']].map(([role,name])=>User.create({name:'Demo '+name,email:name+'@student.example.test',passwordHash,role,accountStatus:'active',emailVerified:true,className:'HSC',group:'Science',academicYear:2026})));
  const book=await Book.create({title:'Physics Learning',subject:'Physics',className:'HSC',group:'Science',createdByUserId:users[1]._id});
  const chapter=await Chapter.create({bookId:book._id,title:'Motion and vectors',createdByUserId:users[1]._id});
  const ids=[new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId()];
  async function paper(title,extra={}){return QuestionPaper.create({title,bookId:book._id,chapterIds:[chapter._id],eligibleGroups:['Science'],durationMinutes:1,totalMarks:3,passMark:2,status:'published',snapshotVersion:1,academicContext:{className:'HSC',bookTitle:book.title,subject:'Physics'},questions:ids.map((questionId)=>({questionId,marks:1})),questionSnapshots:ids.map((questionId,i)=>({questionId,chapterId:chapter._id,text:['Which quantity is a vector?','Which quantity measures inertia?','Which quantity is measured in seconds?'][i],options:['Force','Mass','Time','Temperature'].map((text,index)=>({key:'ABCD'[index],text})),marks:1,difficulty:'easy'})),answerKey:ids.map((questionId,i)=>({questionId,correctOption:'ABC'[i],explanation:['Force has both magnitude and direction.','Mass measures inertia.','Time is measured in seconds.'][i]})),createdByUserId:users[1]._id,...extra});}
  const past=await paper('Completed learning exam');
  const started=await member.startAttempt(String(past._id),users[0]._id);
  await member.submitAttempt(started.attempt.id,users[0]._id,[{questionId:String(ids[0]),selectedOption:'B'},{questionId:String(ids[1]),selectedOption:'B'}]);
  const yesterday=new Date(Date.now()-86400000);
  await ExamSubmission.updateMany({memberUserId:users[0]._id},{$set:{dayKey:require('../../src/modules/exam/exam.member-rules').dhakaDay(yesterday),submittedAt:yesterday}});
  await ExamAttempt.updateMany({memberUserId:users[0]._id},{$set:{submittedAt:yesterday}});
  await QuestionPaper.updateOne({_id:past._id},{$set:{availableUntil:new Date(Date.now()-120000)}});
  await paper('Open navigator exam');await paper('Upcoming physics exam',{availableFrom:new Date(Date.now()+3600000)});
  const harness=express();
  harness.post('/__fixture/stop',(req,res)=>{res.json({stopping:true});void stop();});
  harness.use(app);
  const server=harness.listen(3007,'127.0.0.1',()=>console.log('Disposable student API ready http://127.0.0.1:3007'));
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;await new Promise((r)=>server.close(r));if(mongoose.connection.name!==dbName||!/^examquest_student_ui_[a-f\d]+$/.test(dbName))throw Error('Cleanup guard failed');for(const m of Object.values(mongoose.models))await m.deleteMany({});await mongoose.disconnect();console.log('Student UI fixture documents cleaned.');}
  process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
})().catch((error)=>{console.error(error.message);process.exitCode=1;});
