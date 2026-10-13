# test-manager-library-3145556-tool

> **Prueba técnica · Ficha ADSO 3145556**: utilidades de *Manager Library*. Contiene el **sembrador de datos de demostración**
> (T-21), que **usa solo la API** y nunca SQL directo (`data-model.md` §9).

## Qué siembra

| Dato | Cantidad | Origen |
|---|---|---|
| Bibliotecario de demostración | 1 (`bibliotecario.demo`) | `POST /users` |
| Libros | 40, en las 5 categorías, con ISBN-13 válido | `seed/data/books.json` → `POST /books` |
| Socios | 10 | `seed/data/members.json` → `POST /members` |
| Préstamos | 15 (3 quedan vencidos) | `POST /loans` |
| Devoluciones | 4 | `POST /loans/{id}/items/{item}/return` |

Es idempotente para libros, socios y bibliotecario: si ya existen, la API responde `ISBN_TAKEN`, `DOCUMENT_TAKEN` o
`USERNAME_TAKEN` y el sembrador sigue. Los préstamos sí se repiten si se vuelve a correr.

## Por qué hay dos fases (ADR-006)

La API pone `loaned_at` con su propio reloj y el contrato no permite enviar una fecha. Para que existan préstamos **vencidos**
creados por la API, la primera fase se corre con la API levantada con `CLOCK_OFFSET_DAYS=-20`. Ver
`test-manager-library-3145556-docs/spec-laravel/adr/adr-006-shiftable-clock-for-the-seeder.md`.

## Uso (Node 20+, sin dependencias)

Con `infra` levantado (`docker compose up -d --build`):

```bash
# Fase 1: API 20 días en el pasado → 3 préstamos que quedarán vencidos
cd ../test-manager-library-3145556-infra && CLOCK_OFFSET_DAYS=-20 docker compose up -d api
cd ../test-manager-library-3145556-tool  && ADMIN_PASSWORD=<la del .env> node seed/seed.mjs --phase past

# Fase 2: API en la hora real → 12 préstamos más y 4 devoluciones
cd ../test-manager-library-3145556-infra && CLOCK_OFFSET_DAYS=0 docker compose up -d api
cd ../test-manager-library-3145556-tool  && ADMIN_PASSWORD=<la del .env> node seed/seed.mjs --phase now

# Evidencia de T-21: debe decir "Vencidos: 3" y mostrar filas del reporte
ADMIN_PASSWORD=<la del .env> node seed/seed.mjs --check
```

Variables: `API_URL` (por defecto `http://localhost:8000/api/v1`), `ADMIN_USERNAME` (por defecto `admin`), `ADMIN_PASSWORD`
(obligatoria) y `LIBRARIAN_PASSWORD` (opcional). Ver `.env.example`.

## Prueba de carga de RNF-1

`seed/load.mjs` completa el catálogo hasta 5 000 libros **por la API** y mide 60 búsquedas de `GET /books` (con texto, con
categoría, sin resultados). Termina con código 1 si el p95 supera 300 ms. Úsese en un entorno desechable y después
`docker compose down -v` en `infra`.

```bash
ADMIN_PASSWORD=<la del .env> node seed/load.mjs
# Corrida del 13-10-2026: Búsquedas: 60 · p50 28.9 ms · p95 58.3 ms · máx 66.8 ms (límite 300 ms) → RNF-1 cumple
```

## Evidencia (corrida del 13-10-2026)

```text
Vencidos: 3
  Charlie y la fábrica de chocolate · Isabella Quintero Mejía · 6 día(s)
  Crónica de una muerte anunciada · Mariana Salazar Ortiz · 6 día(s)
  El hombre que confundió a su mujer con un sombrero · Sebastián Rojas Cárdenas · 6 día(s)
Filas del reporte (2026-09-03 a 2026-10-13): 12
  4 × Crónica de una muerte anunciada (Novela)
```
