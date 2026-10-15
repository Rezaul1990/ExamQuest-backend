// Local disposable Phase 4 UI fixture; never loads workspace .env or application data.
const mongoose=require('mongoose'),express=require('express');
const {randomUUID}=require('node:crypto');
const {Book,Chapter,QuestionPaper,ExamAttempt}=require('../../src/modules/exam/exam.models');
const {User}=require('../../src/modules/auth/auth.models');
const {hashPassword}=require('../../src/modules/auth/auth.crypto');
const memberExams=require('../../src/modules/exam/exam.member');
(async()=>{
  const dbName='examquest_ui_security_'+randomUUID().replaceAll('-','');
  await mongoose.connect('mongodb://127.0.0.1:27017/'+dbName,{serverSelectionTimeoutMS:4000});
  const passwordHash=await hashPassword('TestPassword123!');
  const [manual,timer]=await Promise.all(['phase4@example.test','timer4@example.test','native4@example.test'].map((email)=>User.create({name:'Demo Member',email,passwordHash,role:'MEMBER',accountStatus:'active',emailVerified:true,className:'HSC',group:'Science',academicYear:2026})));
  const book=await Book.create({title:'Physics 1st Paper',subject:'Physics',className:'HSC',group:'Science',createdByUserId:manual._id});
  const chapter=await Chapter.create({bookId:book._id,title:'Vector',createdByUserId:manual._id});
  const questionId=new mongoose.Types.ObjectId();
  async function paper(title,durationMinutes){return QuestionPaper.create({title,bookId:book._id,chapterIds:[chapter._id],eligibleGroups:['Science'],durationMinutes,totalMarks:1,passMark:1,questions:[{questionId,marks:1}],status:'published',snapshotVersion:1,academicContext:{className:'HSC',subject:'Physics',bookTitle:book.title},questionSnapshots:[{questionId,text:'Which quantity is a vector?',options:[{key:'A',text:'Force'},{key:'B',text:'Mass'},{key:'C',text:'Time'},{key:'D',text:'Temperature'}],marks:1,difficulty:'easy'}],answerKey:[{questionId,correctOption:'A',explanation:'Private key'}],createdByUserId:manual._id});}
  const normal=await paper('Phase 4 manual exam',20),expiry=await paper('Phase 4 timer exam',1);
  await memberExams.ensureExamStorage();
  const stopWorker=memberExams.startExpiryWorker({intervalMs:500});
  const harness=express();let stopping=false;
  const server=harness.listen(3006,'127.0.0.1',()=>console.log('Disposable Phase 4 API ready http://127.0.0.1:3006'));
  harness.post('/__fixture/prepare-timer',async(req,res)=>{
    const startedAt=new Date(Date.now()-15000),expiresAt=new Date(startedAt.getTime()+60000);
    const attempt=await ExamAttempt.create({memberUserId:timer._id,questionPaperId:expiry._id,total:1,status:'in_progress',startedAt,expiresAt,activeKey:String(timer._id)+':'+String(expiry._id),paperSnapshotVersion:1});
    res.json({attemptId:String(attempt._id),expiresAt});
  });
  const stop=async()=>{if(stopping)return;stopping=true;await stopWorker();await new Promise((resolve)=>server.close(resolve));if(mongoose.connection.name!==dbName)throw Error('Cleanup database guard failed');for(const model of Object.values(mongoose.models))await model.deleteMany({});await mongoose.disconnect();console.log('Phase 4 fixture documents cleaned and server stopped.');};
  harness.post('/__fixture/stop',(req,res)=>{res.json({stopping:true});void stop();});
  harness.use(require('../../src/app'));
  process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
})().catch((error)=>{console.error(error.message);process.exitCode=1;});
