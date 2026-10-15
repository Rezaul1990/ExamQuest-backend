const mongoose=require('mongoose');
const [dbName,memberId,attemptId]=process.argv.slice(2);
if(!/^examquest_security_test_[a-f0-9]+$/.test(dbName))throw Error('Disposable database required');
(async()=>{
  await mongoose.connect('mongodb://127.0.0.1:27017/'+dbName,{serverSelectionTimeoutMS:4000});
  const result=await require('../../src/modules/exam/exam.member').submitAttempt(attemptId,memberId,[]);
  console.log(JSON.stringify({error:result.error,id:result.attempt?.id,score:result.attempt?.score,status:result.attempt?.status}));
  await mongoose.disconnect();
})().catch(async(error)=>{console.error(error.code||error.message);await mongoose.disconnect();process.exitCode=1;});
