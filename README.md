# Library Management System

A small full-stack project for a library desk. The browser app calls a C++ REST API, and PostgreSQL stores books, members, and loans.

## What it does

- Add, search, edit, and remove books.
- Register, search, edit, and remove members.
- Issue books, track due dates, and record returns.
- View available copies, active loans, overdue loans, and recent activity.

## How it is put together

- `artifacts/library-system/` — React and TypeScript user interface.
- `artifacts/api-server/cpp/library_api.cpp` — C++17 HTTP API and database queries.
- `lib/db/src/schema/` — PostgreSQL table definitions for books, members, and loans.
- `lib/api-spec/openapi.yaml` — API contract used to generate the frontend's typed API calls.

The C++ server uses PostgreSQL's `libpq` library and parameterized SQL queries. Books have a total number of copies; available copies are calculated from the open loans. A checkout lasts 14 days. Loan history is retained, so records connected to past loans cannot be deleted.

## API routes

All routes start with `/api`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Check that the API and database respond |
| `GET` | `/dashboard` | Get library totals and loan counts |
| `GET`, `POST` | `/books` | List/search books or add a book |
| `PATCH`, `DELETE` | `/books/{bookId}` | Edit or remove a book |
| `GET`, `POST` | `/members` | List/search members or register one |
| `PATCH`, `DELETE` | `/members/{memberId}` | Edit or remove a member |
| `GET`, `POST` | `/loans` | View loans or issue a book |
| `POST` | `/loans/{loanId}/return` | Record a return |
| `GET` | `/activity` | View recent issues and returns |

Example request to add a book:

```bash
curl -X POST http://localhost:80/api/books \
  -H 'Content-Type: application/json' \
  -d '{"title":"The Left Hand of Darkness","author":"Ursula K. Le Guin","isbn":"9780441478125","category":"Fiction","totalCopies":2}'
```

## Development

The web and API workflows start from the Replit workspace. To apply database schema changes, run:

```bash
pnpm --filter @workspace/db run push
```

After changing the API contract in `lib/api-spec/openapi.yaml`, regenerate the client:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Three sample books, three sample members, and one open loan are included in the development database.