#!/usr/bin/env node
// RNF-1 load test: "book search answers in under 300 ms with 5,000 books".
// Fills the catalogue up to 5,000 books THROUGH THE API and times several GET /books searches.
// Use a throwaway environment: afterwards run `docker compose down -v` in infra and seed again.
//
//   ADMIN_PASSWORD=... node seed/load.mjs

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const TARGET = Number(process.env.LOAD_BOOKS ?? 5000);
const LIMIT_MS = 300;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

function isbn(n) {
  const base = `979${String(n).padStart(9, '0')}`;
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

const login = await call('POST', '/auth/login', null, { username: process.env.ADMIN_USERNAME ?? 'Jonas7891', password: process.env.ADMIN_PASSWORD });
if (login.status !== 200) throw new Error('No se pudo iniciar sesión como admin');
const token = login.data.access_token;
const categories = (await call('GET', '/categories', token)).data;

let total = (await call('GET', '/books?size=1', token)).data.total;
console.log(`Libros activos: ${total}. Objetivo: ${TARGET}.`);
const words = ['Historia', 'Ciencia', 'Viaje', 'Ciudad', 'Mar', 'Noche', 'Tiempo', 'Jardín', 'Código', 'Río'];
for (let n = 1; total < TARGET; n++) {
  const r = await call('POST', '/books', token, {
    title: `${words[n % words.length]} ${n} de la carga`,
    author: `Autor de carga ${n % 97}`,
    isbn: isbn(n),
    category_id: categories[n % categories.length].id,
    total_copies: 1,
  });
  if (r.status === 201) total++;
  if (total % 500 === 0 && r.status === 201) console.log(`  ${total} libros`);
}

const queries = ['', 'historia', 'código 12', 'autor de carga 5', 'xyz-sin-resultados', 'mar'];
const times = [];
for (let round = 0; round < 5; round++) {
  for (const q of queries) {
    for (const cat of [undefined, categories[round % categories.length].id]) {
      const qs = new URLSearchParams({ q, size: '20', ...(cat && { category_id: cat }) });
      const start = performance.now();
      const r = await call('GET', `/books?${qs}`, token);
      times.push(performance.now() - start);
      if (r.status !== 200) throw new Error(`Búsqueda falló: ${r.status}`);
    }
  }
}
times.sort((a, b) => a - b);
const p = (x) => times[Math.min(times.length - 1, Math.floor(times.length * x))].toFixed(1);
console.log(`Búsquedas: ${times.length} · p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · máx ${times.at(-1).toFixed(1)} ms (límite ${LIMIT_MS} ms)`);
process.exitCode = Number(p(0.95)) < LIMIT_MS ? 0 : 1;
console.log(process.exitCode === 0 ? 'RNF-1 cumple' : 'RNF-1 NO cumple');
