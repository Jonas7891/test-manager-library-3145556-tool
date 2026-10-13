#!/usr/bin/env node
// Sembrador de demostración de Manager Library (T-21).
// Usa SOLO la API (data-model.md §9): nunca SQL directo.
//
//   node seed/seed.mjs --phase past   # con la API en CLOCK_OFFSET_DAYS=-20 (ADR-006): 3 préstamos que quedarán vencidos
//   node seed/seed.mjs --phase now    # con la API en CLOCK_OFFSET_DAYS=0: 12 préstamos más y algunas devoluciones
//   node seed/seed.mjs --check        # comprueba la evidencia: 3 vencidos y reporte con filas

import { readFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const ADMIN = { username: process.env.ADMIN_USERNAME ?? 'admin', password: process.env.ADMIN_PASSWORD };
const LIBRARIAN = { username: 'bibliotecario.demo', password: process.env.LIBRARIAN_PASSWORD ?? 'Demo-Biblio-2026' };

const books = JSON.parse(readFileSync(new URL('./data/books.json', import.meta.url)));
const members = JSON.parse(readFileSync(new URL('./data/members.json', import.meta.url)));
const phase = process.argv.includes('--check') ? 'check' : process.argv[process.argv.indexOf('--phase') + 1];

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

async function login({ username, password }) {
  const { status, data } = await call('POST', '/auth/login', null, { username, password });
  if (status !== 200) throw new Error(`No se pudo iniciar sesión como ${username}: ${data?.message}`);
  return data.access_token;
}

// ISBN-13 válido y determinista para cada libro (prefijo 978 + índice + dígito de control).
function isbn(index) {
  const base = `978${String(100000000 + index).slice(1).padStart(9, '0')}`;
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

async function ensureCatalog(admin) {
  const created = await call('POST', '/users', admin, { ...LIBRARIAN, role: 'librarian' });
  console.log(created.status === 201 ? `Bibliotecario creado: ${LIBRARIAN.username}` : `Bibliotecario: ${created.data.code}`);

  const categories = Object.fromEntries((await call('GET', '/categories', admin)).data.map((c) => [c.name, c.id]));
  let n = 0;
  for (const [i, b] of books.entries()) {
    const r = await call('POST', '/books', admin, {
      title: b.title, author: b.author, isbn: isbn(i + 1), category_id: categories[b.category], total_copies: b.copies,
    });
    if (r.status === 201) n++;
    else if (r.data.code !== 'ISBN_TAKEN') throw new Error(`Libro «${b.title}»: ${r.data.message}`);
  }
  console.log(`Libros nuevos: ${n} (catálogo de ${books.length})`);

  n = 0;
  for (const m of members) {
    const r = await call('POST', '/members', admin, m);
    if (r.status === 201) n++;
    else if (r.data.code !== 'DOCUMENT_TAKEN') throw new Error(`Socio ${m.full_name}: ${r.data.message}`);
  }
  console.log(`Socios nuevos: ${n} (de ${members.length})`);
}

async function allItems(token, path) {
  return (await call('GET', `${path}${path.includes('?') ? '&' : '?'}size=50`, token)).data.items;
}

async function lend(token, memberDoc, bookTitles) {
  const member = (await call('GET', `/members?q=${memberDoc}`, token)).data.items[0];
  const ids = [];
  for (const title of bookTitles) {
    ids.push((await call('GET', `/books?q=${encodeURIComponent(title)}`, token)).data.items[0].id);
  }
  const r = await call('POST', '/loans', token, { member_id: member.id, items: ids.map((book_id) => ({ book_id })) });
  console.log(`  ${member.full_name} ← ${bookTitles.join(', ')}: ${r.status === 201 ? 'ok' : r.data.code}`);
  return r.data;
}

async function past() {
  const admin = await login(ADMIN);
  await ensureCatalog(admin);
  const lib = await login(LIBRARIAN);
  console.log('Préstamos en el pasado (quedarán vencidos):');
  await lend(lib, members[0].document_number, ['Cien años de soledad']);
  await lend(lib, members[1].document_number, ['Cosmos']);
  await lend(lib, members[2].document_number, ['El principito']);
}

async function now() {
  const lib = await login(LIBRARIAN);
  const titles = books.map((b) => b.title);
  const plan = [
    [3, [0, 10]], [4, [16]], [5, [18, 26]], [6, [33]], [7, [0]], [8, [27, 16]],
    [9, [6]], [3, [12]], [4, [19]], [5, [36]], [6, [0]], [7, [21]],
  ];
  console.log('Préstamos actuales:');
  const loans = [];
  for (const [m, bookIdx] of plan) {
    loans.push(await lend(lib, members[m].document_number, bookIdx.map((i) => titles[i])));
  }
  console.log('Devoluciones:');
  for (const loan of loans.slice(0, 4).filter((l) => l?.id)) {
    const r = await call('POST', `/loans/${loan.id}/items/${loan.items[0].id}/return`, lib);
    console.log(`  ${loan.items[0].book_title}: ${r.status === 200 ? 'devuelto' : r.data.code}`);
  }
}

async function check() {
  const admin = await login(ADMIN);
  const overdue = await allItems(admin, '/loans/overdue');
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const report = (await call('GET', `/reports/most-borrowed?from=${from}&to=${today}`, admin)).data;
  console.log(`Vencidos: ${overdue.length}`);
  overdue.forEach((o) => console.log(`  ${o.book_title} · ${o.member_name} · ${o.days_late} día(s)`));
  console.log(`Filas del reporte (${from} a ${today}): ${report.rows.length}`);
  report.rows.slice(0, 5).forEach((r) => console.log(`  ${r.times_borrowed} × ${r.book_title} (${r.category_name})`));
  if (overdue.length !== 3 || report.rows.length === 0) process.exitCode = 1;
}

const run = { past, now, check }[phase];
if (!run || !ADMIN.password) {
  console.error('Uso: ADMIN_PASSWORD=... node seed/seed.mjs --phase past|now  ó  --check');
  process.exit(2);
}
run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
