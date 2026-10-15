// Explicit target only; never loads .env or creates indexes/collections.
const mongoose = require('mongoose');

const requirements = [
  { collection: 'examsubmissions', key: { memberUserId: 1, dayKey: 1 }, sparse: false },
  { collection: 'examsubmissions', key: { memberUserId: 1, questionPaperId: 1 }, sparse: false },
  { collection: 'examsubmissions', key: { attemptId: 1 }, sparse: false },
  { collection: 'examattempts', key: { activeKey: 1 }, sparse: true },
  { collection: 'questions', key: { identityKey: 1 }, sparse: true },
];

async function inspectStorage(db) {
  const checks = [];
  for (const spec of requirements) {
    const collection = db.collection(spec.collection);
    let indexes;
    try { indexes = await collection.indexes(); }
    catch (error) { if (error.code !== 26) throw error; indexes = []; }
    const ready = indexes.some((index) => index.unique === true &&
      Boolean(index.sparse) === spec.sparse && !index.partialFilterExpression &&
      JSON.stringify(index.key) === JSON.stringify(spec.key));
    const fields = Object.keys(spec.key);
    const pipeline = [];
    if (spec.sparse) pipeline.push({ $match: { [fields[0]]: { $exists: true } } });
    pipeline.push({ $group: { _id: Object.fromEntries(fields.map((field) => [field, '$' + field])), count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $count: 'groups' });
    const duplicates = await collection.aggregate(pipeline, { maxTimeMS: 10000 }).toArray();
    checks.push({ ...spec, ready, duplicateGroups: duplicates[0]?.groups || 0 });
  }
  return { ready: checks.every((check) => check.ready && check.duplicateGroups === 0), checks };
}

async function main() {
  if (!process.env.RELEASE_MONGODB_URI) throw new Error('RELEASE_MONGODB_URI must explicitly identify the authorized database');
  const connection = mongoose.createConnection();
  try {
    await connection.openUri(process.env.RELEASE_MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
    const report = await inspectStorage(connection.db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  } finally { await connection.close(); }
}

if (require.main === module) main().catch(() => {
  console.error('Release preflight failed: explicit target, connectivity or read access unavailable. No changes applied.');
  process.exitCode = 1;
});
module.exports = { inspectStorage };
