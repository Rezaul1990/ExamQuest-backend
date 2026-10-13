# Serviq — backend architecture contract

## Style
**Modular monolith**, feature modules with explicit HTTP/controller → service/use case → repository/data adapter boundaries. Express + TypeScript. Do not create microservices, DDD complexity or layers with no actual responsibility.

```text
backend/
  src/
    app.ts              # Express composition, middleware, routes
    server.ts           # start / shutdown
    config/             # typed env setup
    modules/
      example/
        example.routes.ts
        example.controller.ts
        example.service.ts
        example.repository.ts
        example.schema.ts
        example.types.ts
        __tests__/
    middleware/
    shared/
      errors/
      http/
      logging/
  tests/                # cross-module integration
```

Illustrative names are **not files to generate in advance**. Add only required modules and artifacts.

## Responsibilities
- Routes: endpoint registration, middleware orchestration.
- Controller: parse validated request, call service, format status/response; no DB/business logic.
- Service/use case: business rules, invariants, authorization checks with trusted identity, orchestration, transactions where needed.
- Repository: encapsulate Mongoose/MongoDB persistence and query details.
- Schema: validate request and env; never expose internal models automatically.
- Shared: cross-cutting implementations only after true reuse.

## Cross-stack contract
Version APIs intentionally, document in `../docs/API_CONTRACT.md`, provide explicit errors, auth constraints and example payloads. A feature modifying API must update frontend consumers and corresponding docs/tests unless user explicitly scopes backend-only work.

## Safety
Server owns role/resource permission checks, idempotency and race-safe booking rules as relevant. Never trust client-provided price. Structured logging with trace/request ID, redact secrets. Centralized error translation. Separate envs and secure config.

## Tests
Unit test critical rules, integration test routes/database behavior with isolated test data; contract-test frontend DTO compatibility when possible. Report exact checks, not assumed success.
