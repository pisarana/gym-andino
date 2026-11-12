'use strict';
// Pruebas automáticas de la API. Ejecutar con: npm test
process.env.DB_FILE = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

async function api(metodo, ruta, cuerpo, cookie) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(usuario, clave) {
  const r = await api('POST', '/api/login', { usuario, clave });
  return r.cookie;
}

test('CP-01 login correcto devuelve usuario y cookie de sesión', async () => {
  const r = await api('POST', '/api/login', { usuario: 'admin', clave: 'Admin2026!' });
  assert.equal(r.status, 200);
  assert.equal(r.data.usuario.rol, 'admin');
  assert.match(r.cookie, /^sid=/);
});

test('CP-02 login con clave incorrecta devuelve 401 con mensaje genérico', async () => {
  const r = await api('POST', '/api/login', { usuario: 'recepcion', clave: 'mala' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'Usuario o contraseña incorrectos');
});

test('CP-03 se bloquea la cuenta tras 5 intentos fallidos', async () => {
  for (let i = 0; i < 5; i++) await api('POST', '/api/login', { usuario: 'bloqueado1', clave: 'x' });
  const r = await api('POST', '/api/login', { usuario: 'bloqueado1', clave: 'x' });
  assert.equal(r.status, 429);
});

test('CP-04 sin sesión la API protegida devuelve 401', async () => {
  assert.equal((await api('GET', '/api/socios')).status, 401);
});

test('CP-05 recepción no puede ver reportes ni crear planes (403)', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  assert.equal((await api('GET', '/api/reportes/resumen', null, c)).status, 403);
  assert.equal((await api('POST', '/api/planes', { nombre: 'Test', duracion_dias: 10, precio: 50 }, c)).status, 403);
});

test('CP-06 registrar socio valida DNI, teléfono y correo', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  const mal = await api('POST', '/api/socios', { nombre: 'Al', documento: '123', telefono: '12', email: 'x' }, c);
  assert.equal(mal.status, 400);
  assert.equal(mal.data.detalles.length, 4);
  const ok = await api('POST', '/api/socios', { nombre: 'Pedro Castillo Lima', documento: '12345678', telefono: '987000111' }, c);
  assert.equal(ok.status, 201);
  assert.equal(ok.data.estado_membresia, 'sin_membresia');
});

test('CP-07 no permite DNI duplicado (409)', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  const r = await api('POST', '/api/socios', { nombre: 'Otra Persona', documento: '45871236' }, c);
  assert.equal(r.status, 409);
});

test('CP-08 vender membresía calcula fechas y renovación continua', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  const a = await api('POST', '/api/membresias', { socio_id: 5, plan_id: 2, metodo_pago: 'yape' }, c); // Ana, sin membresía
  assert.equal(a.status, 201);
  const dias = (Date.parse(a.data.fecha_fin) - Date.parse(a.data.fecha_inicio)) / 86400000;
  assert.equal(dias, 29); // plan de 30 días
  const b = await api('POST', '/api/membresias', { socio_id: 5, plan_id: 2, metodo_pago: 'efectivo' }, c);
  const siguiente = new Date(Date.parse(a.data.fecha_fin) + 86400000).toISOString().slice(0, 10);
  assert.equal(b.data.fecha_inicio, siguiente);
});

test('CP-09 método de pago inválido devuelve 400', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  const r = await api('POST', '/api/membresias', { socio_id: 1, plan_id: 2, metodo_pago: 'bitcoin' }, c);
  assert.equal(r.status, 400);
});

test('CP-10 check-in permitido con membresía vigente y no se repite el mismo día', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  const r1 = await api('POST', '/api/asistencias', { documento: '45871236' }, c); // María: vigente
  assert.equal(r1.status, 201);
  assert.ok(r1.data.dias_restantes >= 0);
  const r2 = await api('POST', '/api/asistencias', { documento: '45871236' }, c);
  assert.equal(r2.status, 409);
});

test('CP-11 check-in rechazado con membresía vencida o inexistente', async () => {
  const c = await login('recepcion', 'Recepcion2026!');
  assert.equal((await api('POST', '/api/asistencias', { documento: '40123987' }, c)).status, 409); // Lucía: vencida
  assert.equal((await api('POST', '/api/asistencias', { documento: '12345678' }, c)).status, 409); // Pedro: sin membresía
  assert.equal((await api('POST', '/api/asistencias', { documento: '99999999' }, c)).status, 404); // no existe
});

test('CP-12 anular membresía es solo de admin y descuenta de los ingresos', async () => {
  const rec = await login('recepcion', 'Recepcion2026!');
  const adm = await login('admin', 'Admin2026!');
  const antes = (await api('GET', '/api/reportes/resumen', null, adm)).data.ingresos;
  const venta = await api('POST', '/api/membresias', { socio_id: 2, plan_id: 3, metodo_pago: 'tarjeta' }, rec);
  const conVenta = (await api('GET', '/api/reportes/resumen', null, adm)).data.ingresos;
  assert.equal(conVenta - antes, 240); // el plan trimestral cuesta S/ 240
  assert.equal((await api('POST', `/api/membresias/${venta.data.id}/anular`, {}, rec)).status, 403);
  assert.equal((await api('POST', `/api/membresias/${venta.data.id}/anular`, {}, adm)).status, 200);
  assert.equal((await api('POST', `/api/membresias/${venta.data.id}/anular`, {}, adm)).status, 409);
  const despues = (await api('GET', '/api/reportes/resumen', null, adm)).data.ingresos;
  assert.equal(despues, antes); // la venta anulada ya no suma a los ingresos
});

test('CP-13 reporte valida rango de fechas', async () => {
  const adm = await login('admin', 'Admin2026!');
  assert.equal((await api('GET', '/api/reportes/resumen?desde=2026-02-30&hasta=2026-03-01', null, adm)).status, 400);
  assert.equal((await api('GET', '/api/reportes/resumen?desde=2026-05-10&hasta=2026-05-01', null, adm)).status, 400);
  const ok = await api('GET', '/api/reportes/resumen', null, adm);
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.data.por_vencer));
});

test('CP-14 plan: valida precio y duración; admin puede crear', async () => {
  const adm = await login('admin', 'Admin2026!');
  assert.equal((await api('POST', '/api/planes', { nombre: 'Malo', duracion_dias: 0, precio: -5 }, adm)).status, 400);
  assert.equal((await api('POST', '/api/planes', { nombre: 'Semestral', duracion_dias: 180, precio: 450 }, adm)).status, 201);
  assert.equal((await api('POST', '/api/planes', { nombre: 'Semestral', duracion_dias: 180, precio: 450 }, adm)).status, 409);
});

test('CP-15 archivos estáticos: index servido y no hay salida del directorio público', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 403);
});
