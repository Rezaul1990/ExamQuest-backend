require("dotenv").config();

const app = require("./app");
const { connectDatabase } = require("./db/connect");
const env = require("./config/env");

const PORT = env.port;
const { ensureExamStorage, startExpiryWorker } = require("./modules/exam/exam.member");
const mongoose = require("mongoose");
const { startupError } = require("./db/startupError");
let startupStage = "database";
let server;
let stopWorker;
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (stopWorker) await stopWorker();
  await mongoose.disconnect();
  clearTimeout(deadline);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

connectDatabase()
  .then(async () => {
    startupStage = "exam storage";
    await ensureExamStorage();
    if (stopping) return;
    server = app.listen(PORT, () => {
      stopWorker = startExpiryWorker();
      console.log(`ExamQuest API running on port ${PORT}`);
    });
    server.on("error", async () => {
      console.error("ExamQuest API could not bind its port");
      process.exitCode = 1;
      await shutdown();
    });
  })
  .catch(async (error) => {
    console.error(`Failed to start ExamQuest API [${startupStage}]: ${startupError(error, startupStage)}`);
    process.exitCode = 1;
    await shutdown();
  });
