# test-manager-library-3145556-tool

> **Technical test · ADSO group 3145556**: *Manager Library* utilities. It holds the **demo data seeder** (T-21), which
> **uses only the API** and never direct SQL (`data-model.md` §9).

## What it seeds

| Data | Amount | Source |
|---|---|---|
| Demo librarian | 1 (`LIBRARIAN_USERNAME`, default `Juan Diego`) | `POST /users` |
| Books | 40, across the 5 categories, with valid ISBN-13 | `seed/data/books.json` → `POST /books` |
| Members | 10 | `seed/data/members.json` → `POST /members` |
| Loans | 15 (3 end up overdue) | `POST /loans` |
| Returns | 4 | `POST /loans/{id}/items/{item}/return` |

Books, members and the librarian are idempotent: if they already exist, the API answers `ISBN_TAKEN`, `DOCUMENT_TAKEN` or
`USERNAME_TAKEN` and the seeder carries on. Loans are created again on every run.

The demo data and the console output are in Spanish because users see them (ADR-015).

## Why there are two phases (ADR-006)

The API sets `loaned_at` with its own clock, and the contract does not allow sending a date. For loans created by the API to be
**overdue**, the first phase runs with the API started with `CLOCK_OFFSET_DAYS=-20`. See
`test-manager-library-3145556-docs/spec-laravel/adr/adr-006-shiftable-clock-for-the-seeder.md`.

## Usage (Node 20+, no dependencies)

With `infra` running (`docker compose up -d --build`):

```bash
# Phase 1: API 20 days in the past → 3 loans that will be overdue
cd ../test-manager-library-3145556-infra && CLOCK_OFFSET_DAYS=-20 docker compose up -d api
cd ../test-manager-library-3145556-tool  && ADMIN_PASSWORD=<from .env> LIBRARIAN_PASSWORD=<from .env> node seed/seed.mjs --phase past

# Phase 2: API on real time → 12 more loans and 4 returns
cd ../test-manager-library-3145556-infra && CLOCK_OFFSET_DAYS=0 docker compose up -d api
cd ../test-manager-library-3145556-tool  && ADMIN_PASSWORD=<from .env> LIBRARIAN_PASSWORD=<from .env> node seed/seed.mjs --phase now

# T-21 evidence: it must say "Vencidos: 3" and list report rows
ADMIN_PASSWORD=<from .env> node seed/seed.mjs --check
```

Variables:
- `API_URL`: default `http://localhost:8000/api/v1`;
- `ADMIN_USERNAME`: default `Jonas7891`;
- `ADMIN_PASSWORD`: required;
- `LIBRARIAN_USERNAME`: default `Juan Diego`;
- `LIBRARIAN_PASSWORD`: required for `past` and `now`.

Passwords go only in the local `infra` `.env` (ADR-014). See `.env.example`.

## RNF-1 load test

`seed/load.mjs` fills the catalogue up to 5,000 books **through the API** and times 60 `GET /books` searches (with text, with a
category and with no results). It exits with code 1 if the p95 goes over 300 ms. Run it on a throwaway environment, then run
`docker compose down -v` in `infra`.

```bash
ADMIN_PASSWORD=<from .env> node seed/load.mjs
# Run of 13-10-2026: Búsquedas: 60 · p50 28.9 ms · p95 58.3 ms · máx 66.8 ms (límite 300 ms) → RNF-1 met
```

## Evidence (run of 13-10-2026)

```text
Vencidos: 3
  Charlie y la fábrica de chocolate · Isabella Quintero Mejía · 6 día(s)
  Crónica de una muerte anunciada · Mariana Salazar Ortiz · 6 día(s)
  El hombre que confundió a su mujer con un sombrero · Sebastián Rojas Cárdenas · 6 día(s)
Filas del reporte (2026-09-03 a 2026-10-13): 12
  4 × Crónica de una muerte anunciada (Novela)
```
