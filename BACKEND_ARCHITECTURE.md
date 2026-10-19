# ExamQuest — backend architecture contract

## Current implementation
Modular Express monolith using Node.js CommonJS JavaScript and Mongoose/MongoDB. Paths below are relative to `backend/` and describe existing files, not a TypeScript migration plan.

```text
src/
  app.js                    # Express composition, middleware and API mounting
  server.js                 # database/index readiness, HTTP lifecycle, expiry worker
  config/env.js             # environment reading/validation
  db/                       # connection and safe startup diagnostics
  middleware/               # authentication, rate limits, error translation
  modules/
    auth/                   # auth routes/controllers/service/models and helpers
    admin/                  # staff/admin routes and controller
    academic/               # canonical academic constants
    exam/                   # routes/controllers, validation, services and models
  scripts/                  # explicit seed/preflight entry points
tests/                      # disposable MongoDB/HTTP and rule regressions
```

## Responsibilities and placement
- Routes mount middleware, roles/permissions/scope and validation. Controllers adapt HTTP requests/responses.
- Services and focused use-case modules own business rules and persistence orchestration. Exam use cases include `exam.member.js`, `exam.authoring.js`, `exam.import.js`, `exam.bank.js` and `exam.learning.js`.
- Existing services/controllers access Mongoose models directly where implemented; there is no mandatory repository folder or TypeScript build layer. Keep additions consistent with nearby source. Introduce a separate adapter only when it has a real responsibility.
- Validation lives in `*.validation.js` and relevant controller schemas; shared helpers belong near their owning module unless genuinely reused.
- Do not create placeholder modules, microservices or unrelated architecture conversions.

## Cross-stack contract
Stable mounts are `/api/v1/auth`, `/api/v1/admin`, `/api/v1/exams`; health is `/api/health`. Document contract changes in [API_CONTRACT.md](../docs/API_CONTRACT.md) and coordinate frontend consumers. Naming reconciliation must not rename routes, role/permission identifiers, database collections or token/deep-link identifiers.

## Safety and verification
The server owns authorization, academic eligibility, timing, scoring, quota and immutable snapshots. Preserve existing secret-handling boundaries; production safeguards and outstanding gaps are documented in [security rules](../docs/SECURITY_RULES.md) and project state.

Run `npm run check` and `npm test` for configured syntax and disposable MongoDB/HTTP regressions. Never treat these as production/native verification or write to a live database to validate documentation.