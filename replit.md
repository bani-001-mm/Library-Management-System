# Library Management System

A small library desk app for managing the book catalogue, members, and loans from one browser-based interface.

## Run & Operate

- The `artifacts/library-system: web` workflow runs the React interface.
- The `artifacts/api-server: API Server` workflow compiles and runs the C++ API.
- `pnpm --filter @workspace/db run push` applies development database schema changes.
- `pnpm --filter @workspace/api-spec run codegen` regenerates the typed frontend API client after OpenAPI changes.
- `pnpm run typecheck` checks the TypeScript workspace packages.

## Stack

- Frontend: React, Vite, TypeScript, Wouter, and generated React Query hooks.
- API: C++17 HTTP server using POSIX sockets, nlohmann JSON, and libpq.
- Database: PostgreSQL, with the Drizzle schema under `lib/db/src/schema/`.
- Contract: `lib/api-spec/openapi.yaml` is the source for the generated client and API types.

## Where things live

- `artifacts/library-system/` — dashboard, catalogue, member register, and lending screens.
- `artifacts/api-server/cpp/library_api.cpp` — C++ REST API and PostgreSQL queries.
- `lib/db/src/schema/` — books, members, and loans tables.
- `lib/api-spec/openapi.yaml` — endpoint and data contracts.

## Architecture decisions

- The library API is served directly by C++; its route handlers use parameterized PostgreSQL queries.
- PostgreSQL tables are defined in Drizzle and applied with the development `push` command. The C++ server does not create or migrate tables at startup.
- Loan records are retained as history, so a book or member with any linked loan cannot be deleted.
- Issuing a book locks its catalogue row and checks availability inside a transaction.

## Product

- Add, search, edit, and remove books and members.
- Issue available copies to members, track due dates, and record returns.
- Review active and overdue loans, dashboard counts, and recent activity.
- Three example books, three example members, and one open loan are inserted into the development database to make the first screen useful.

## User preferences

- Keep this project simple and use a C++ backend with a frontend, API calls, and a database.

## Gotchas

- If the database schema changes, run `pnpm --filter @workspace/db run push` before starting the API.
- If an endpoint or response changes, update the OpenAPI contract, regenerate the client, and keep the C++ route in sync.
- The API runs at `/api`; requests pass through the shared project proxy without stripping that prefix.