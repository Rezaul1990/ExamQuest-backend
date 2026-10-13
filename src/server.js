require("dotenv").config();

const app = require("./app");
const { connectDatabase } = require("./db/connect");
const env = require("./config/env");

const PORT = env.port;

connectDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ExamQuest API running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start ExamQuest API", error.message);
    process.exit(1);
  });
