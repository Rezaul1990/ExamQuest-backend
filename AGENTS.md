# ExamQuest Backend — scoped Codex instructions

- Read `BACKEND_ARCHITECTURE.md` before implementing server features; follow its controller/service/repository boundaries and current project conventions.
- Backend owns business rules, validation, security and database integrity. Never trust mobile-provided roles, ownership, prices or permissions.
- For API changes, update `../docs/API_CONTRACT.md` and coordinate frontend types/services/hooks/screen as needed under root `AGENTS.md`. Mark partial work if a requested full-stack feature remains disconnected.
- Use the existing Node.js/Express CommonJS JavaScript modules (`src/app.js`, `src/server.js`); do not introduce a TypeScript migration as routine feature work. Only install packages after compatibility review; update lockfiles and migration/config docs. Keep secrets out of source and screenshots.
- Provide integration tests on validation, permission and state transitions when appropriate. Report actual commands, changes, and blockers using `../docs/DELIVERY_REPORT_TEMPLATE.md`.
- This folder is its own Git repository for `ExamQuest-backend`; commit and push backend changes only from `backend/`. Do not use the workspace root as a Git repository, and do not include `.env`, secrets, `node_modules`, generated builds, or cache files.

## Automatic synchronization / task closeout
- Automatically load the root `../AGENTS.md`, `../docs/PROJECT_STATE.md`, and task-relevant docs selected from `../docs/DOCS_INDEX.md` (do not reread every document in full).
- On any changed feature update verified status in `../docs/PROJECT_STATE.md`, related feature spec, API contract and changelog as applicable; coordinate opposite layer for cross-stack implementation.
- Update this scoped `AGENTS.md` **only** if enduring coding/agent rules or documentation paths change, not for each feature. If root or other scoped agent also needs a policy change, synchronize only the relevant instruction sections.
- Final answer must say what changed in *both* layers or why a layer is unaffected, dependencies/install/rebuild commands and evidence, plus Bangla viewer demo instructions. Do not say COMPLETE when a required integration is missing.
