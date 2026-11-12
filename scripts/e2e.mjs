// Pruebas de punta a punta (E2E) contra una URL desplegada de Gym Andino.
// Uso:  node scripts/e2e.mjs [URL]      (por defecto https://gym-andino.onrender.com)
// Genera docs/pruebas/reporte-e2e.md y docs/pruebas/reporte-e2e.json con la evidencia.
// Nota: crea un socio y membresías de prueba con un DNI aleatorio (los datos de la demo se reinician solos).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || process.env.BASE_URL || 'https://gym-andino.onrender.com').replace(/\/$/, '');
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultados = [];
const dniPrueba = `9${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function llamar(metodo, ruta, { cuerpo, cookie, crudo } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + ruta, {
    method: metodo,
    redirect: 'manual',
    headers: {
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const ms = Math.round(performance.now() - t0);
  const texto = await res.text();
  let data = null;
  if (!crudo) { try { data = JSON.parse(texto); } catch { /* no es JSON */ } }
  return { status: res.status, data, texto, headers: res.headers, ms, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

async function caso(id, modulo, descripcion, esperado, fn) {
  let estado = 'Aprobado';
  let obtenido = '';
  let ms = 0;
  try {
    const r = await fn();
    obtenido = r.obtenido;
    ms = r.ms || 0;
    if (!r.ok) estado = 'Fallido';
  } catch (err) {
    estado = 'Fallido';
    obtenido = `Error: ${err.message}`;
  }
  resultados.push({ id, modulo, descripcion, esperado, obtenido, estado, ms });
  console.log(`${estado === 'Aprobado' ? 'OK   ' : 'FALLA'} ${id} ${descripcion} (${ms} ms)`);
}

const json = (o) => JSON.stringify(o);

// ---------------- ejecución ----------------
const inicio = new Date();
console.log(`Pruebas E2E contra ${BASE}`);

// Despierta el servicio (el plan gratuito se duerme) y mide el arranque en frío.
const calentamiento = await llamar('GET', '/api/salud');

await caso('E2E-01', 'General', 'Comprobación de salud del servicio', '200 y {"estado":"ok"}', async () => {
  const r = await llamar('GET', '/api/salud');
  return { ok: r.status === 200 && r.data?.estado === 'ok', obtenido: `${r.status} ${r.texto}`, ms: r.ms };
});

await caso('E2E-02', 'General', 'Página principal y cabeceras de seguridad', '200 con CSP, nosniff y X-Frame-Options DENY', async () => {
  const r = await llamar('GET', '/', { crudo: true });
  const csp = r.headers.get('content-security-policy') || '';
  const ok = r.status === 200 && csp.includes("default-src 'self'") && r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY';
  return { ok, obtenido: `${r.status}; CSP=${csp ? 'sí' : 'no'}; nosniff=${r.headers.get('x-content-type-options')}; frame=${r.headers.get('x-frame-options')}`, ms: r.ms };
});

// En producción, el firewall de la plataforma (Cloudflare delante de Render) puede rechazar
// ataques antes de que lleguen a la app. Se acepta si el ataque se rechaza sin filtrar nada,
// y se registra qué capa lo bloqueó. La protección propia de la app se prueba en local (CP-15).
const capa = (r) => (/cloudflare/i.test(r.headers.get('server') || '') || /cloudflare/i.test(r.texto) ? 'firewall Cloudflare' : 'app');

await caso('E2E-03', 'Seguridad', 'Salida de directorio en archivos estáticos', 'Rechazado (400/403/404) sin mostrar el código del servidor', async () => {
  const r = await llamar('GET', '/..%2fserver.js', { crudo: true });
  return { ok: [400, 403, 404].includes(r.status) && !r.texto.includes('require('), obtenido: `${r.status}, bloqueado por ${capa(r)}`, ms: r.ms };
});

await caso('E2E-04', 'General', 'Ruta inexistente de la API', '404 con mensaje', async () => {
  const r = await llamar('GET', '/api/no-existe');
  return { ok: r.status === 404 && !!r.data?.error, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-05', 'M1 Autenticación', 'Login con campos vacíos', '400 "Ingrese usuario y contraseña"', async () => {
  const r = await llamar('POST', '/api/login', { cuerpo: { usuario: '', clave: '' } });
  return { ok: r.status === 400, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-06', 'M1 Autenticación', 'Login con contraseña incorrecta', '401 con mensaje genérico', async () => {
  const r = await llamar('POST', '/api/login', { cuerpo: { usuario: 'recepcion', clave: 'incorrecta' } });
  return { ok: r.status === 401 && r.data?.error === 'Usuario o contraseña incorrectos', obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

let rec = '';
await caso('E2E-07', 'M1 Autenticación', 'Login correcto de recepción', '200 y cookie HttpOnly, Secure y SameSite=Strict', async () => {
  const r = await llamar('POST', '/api/login', { cuerpo: { usuario: 'recepcion', clave: 'Recepcion2026!' } });
  rec = r.cookie;
  const sc = r.headers.get('set-cookie') || '';
  const ok = r.status === 200 && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Strict/.test(sc);
  return { ok, obtenido: `${r.status}; rol=${r.data?.usuario?.rol}; cookie=${sc.replace(/sid=[^;]+/, 'sid=***')}`, ms: r.ms };
});

await caso('E2E-08', 'M1 Autenticación', 'Usuario actual con sesión', '200 con rol recepcion', async () => {
  const r = await llamar('GET', '/api/me', { cookie: rec });
  return { ok: r.status === 200 && r.data?.usuario?.rol === 'recepcion', obtenido: `${r.status} rol=${r.data?.usuario?.rol}`, ms: r.ms };
});

await caso('E2E-09', 'M1 Autenticación', 'API protegida sin sesión', '401', async () => {
  const r = await llamar('GET', '/api/socios');
  return { ok: r.status === 401, obtenido: String(r.status), ms: r.ms };
});

await caso('E2E-10', 'M1 Autenticación', 'Bloqueo tras 5 intentos fallidos', 'El 6.º intento devuelve 429', async () => {
  const usuario = `bloqueo${Date.now()}`;
  for (let i = 0; i < 5; i++) await llamar('POST', '/api/login', { cuerpo: { usuario, clave: 'x' } });
  const r = await llamar('POST', '/api/login', { cuerpo: { usuario, clave: 'x' } });
  return { ok: r.status === 429, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-11', 'M1 Autenticación', 'Recepción no puede ver reportes', '403', async () => {
  const r = await llamar('GET', '/api/reportes/resumen', { cookie: rec });
  return { ok: r.status === 403, obtenido: String(r.status), ms: r.ms };
});

await caso('E2E-12', 'M1 Autenticación', 'Recepción no puede crear planes', '403', async () => {
  const r = await llamar('POST', '/api/planes', { cookie: rec, cuerpo: { nombre: 'Prueba', duracion_dias: 10, precio: 50 } });
  return { ok: r.status === 403, obtenido: String(r.status), ms: r.ms };
});

await caso('E2E-13', 'M1 Autenticación', 'Recepción no puede desactivar socios', '403', async () => {
  const r = await llamar('DELETE', '/api/socios/1', { cookie: rec });
  return { ok: r.status === 403, obtenido: String(r.status), ms: r.ms };
});

await caso('E2E-14', 'M2 Socios', 'Registro con datos inválidos', '400 con 4 mensajes de validación', async () => {
  const r = await llamar('POST', '/api/socios', { cookie: rec, cuerpo: { nombre: 'Al', documento: '123', telefono: '12', email: 'x' } });
  return { ok: r.status === 400 && r.data?.detalles?.length === 4, obtenido: `${r.status}: ${(r.data?.detalles || []).join('; ')}`, ms: r.ms };
});

let socioId = 0;
await caso('E2E-15', 'M2 Socios', 'Registro de socio válido', '201 con estado sin_membresia', async () => {
  const r = await llamar('POST', '/api/socios', { cookie: rec, cuerpo: { nombre: 'Socio Prueba E2E', documento: dniPrueba, telefono: '987000111', email: 'e2e@example.com' } });
  socioId = r.data?.id;
  return { ok: r.status === 201 && r.data?.estado_membresia === 'sin_membresia', obtenido: `${r.status} id=${socioId} estado=${r.data?.estado_membresia}`, ms: r.ms };
});

await caso('E2E-16', 'M2 Socios', 'DNI duplicado', '409', async () => {
  const r = await llamar('POST', '/api/socios', { cookie: rec, cuerpo: { nombre: 'Otra Persona', documento: dniPrueba } });
  return { ok: r.status === 409, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-17', 'M2 Socios', 'Búsqueda por DNI', 'Devuelve exactamente el socio registrado', async () => {
  const r = await llamar('GET', `/api/socios?q=${dniPrueba}`, { cookie: rec });
  return { ok: r.status === 200 && r.data?.length === 1 && r.data[0].documento === dniPrueba, obtenido: `${r.status} resultados=${r.data?.length}`, ms: r.ms };
});

await caso('E2E-18', 'Seguridad', 'Búsqueda con inyección SQL', 'Sin datos indebidos: 0 resultados o rechazo del firewall', async () => {
  const r = await llamar('GET', `/api/socios?q=${encodeURIComponent("' OR 1=1 --")}`, { cookie: rec });
  const enApp = r.status === 200 && Array.isArray(r.data) && r.data.length === 0;
  const enFirewall = r.status === 403 && capa(r) === 'firewall Cloudflare' && !Array.isArray(r.data);
  return {
    ok: enApp || enFirewall,
    obtenido: enApp ? '200, 0 resultados (la consulta parametrizada no se altera)' : `${r.status}, bloqueado por ${capa(r)}`,
    ms: r.ms,
  };
});

await caso('E2E-19', 'M5 Ingreso', 'Ingreso de socio sin membresía', '409 acceso denegado', async () => {
  const r = await llamar('POST', '/api/asistencias', { cookie: rec, cuerpo: { documento: dniPrueba } });
  return { ok: r.status === 409, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-20', 'M4 Membresías', 'Venta con método de pago inválido', '400', async () => {
  const r = await llamar('POST', '/api/membresias', { cookie: rec, cuerpo: { socio_id: socioId, plan_id: 2, metodo_pago: 'bitcoin' } });
  return { ok: r.status === 400, obtenido: `${r.status} ${(r.data?.detalles || []).join('; ')}`, ms: r.ms };
});

let membresia1 = null;
await caso('E2E-21', 'M4 Membresías', 'Venta de plan mensual', '201 con vigencia de 30 días desde hoy', async () => {
  const r = await llamar('POST', '/api/membresias', { cookie: rec, cuerpo: { socio_id: socioId, plan_id: 2, metodo_pago: 'yape' } });
  membresia1 = r.data;
  const dias = (Date.parse(r.data?.fecha_fin) - Date.parse(r.data?.fecha_inicio)) / 86400000 + 1;
  return { ok: r.status === 201 && dias === 30, obtenido: `${r.status} ${r.data?.fecha_inicio} al ${r.data?.fecha_fin} (${dias} días)`, ms: r.ms };
});

let membresia2 = null;
await caso('E2E-22', 'M4 Membresías', 'Renovación encadenada', 'La nueva empieza el día siguiente al vencimiento', async () => {
  const r = await llamar('POST', '/api/membresias', { cookie: rec, cuerpo: { socio_id: socioId, plan_id: 2, metodo_pago: 'efectivo' } });
  membresia2 = r.data;
  const esperado = new Date(Date.parse(membresia1.fecha_fin) + 86400000).toISOString().slice(0, 10);
  return { ok: r.status === 201 && r.data?.fecha_inicio === esperado, obtenido: `${r.status} inicia ${r.data?.fecha_inicio} (esperado ${esperado})`, ms: r.ms };
});

await caso('E2E-23', 'M5 Ingreso', 'Ingreso con membresía vigente', '201 con días restantes', async () => {
  const r = await llamar('POST', '/api/asistencias', { cookie: rec, cuerpo: { documento: dniPrueba } });
  return { ok: r.status === 201 && r.data?.dias_restantes >= 29, obtenido: `${r.status} plan=${r.data?.plan} días=${r.data?.dias_restantes}`, ms: r.ms };
});

await caso('E2E-24', 'M5 Ingreso', 'Segundo ingreso el mismo día', '409 ya registró', async () => {
  const r = await llamar('POST', '/api/asistencias', { cookie: rec, cuerpo: { documento: dniPrueba } });
  return { ok: r.status === 409, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-25', 'M5 Ingreso', 'DNI no registrado', '404', async () => {
  const r = await llamar('POST', '/api/asistencias', { cookie: rec, cuerpo: { documento: '00000001' } });
  return { ok: r.status === 404, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-26', 'M5 Ingreso', 'DNI con formato inválido', '400', async () => {
  const r = await llamar('POST', '/api/asistencias', { cookie: rec, cuerpo: { documento: '12ab' } });
  return { ok: r.status === 400, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-27', 'M5 Ingreso', 'Ingreso con membresía vencida (socia de ejemplo)', '409', async () => {
  const r = await llamar('POST', '/api/asistencias', { cookie: rec, cuerpo: { documento: '40123987' } });
  return { ok: r.status === 409, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

let adm = '';
await caso('E2E-28', 'M6 Reportes', 'Reporte del administrador', '200 con ingresos, asistencia por día y horas pico', async () => {
  adm = (await llamar('POST', '/api/login', { cuerpo: { usuario: 'admin', clave: 'Admin2026!' } })).cookie;
  const r = await llamar('GET', '/api/reportes/resumen', { cookie: adm });
  const ok = r.status === 200 && typeof r.data?.ingresos === 'number' && Array.isArray(r.data?.porDia) && Array.isArray(r.data?.porHora);
  return { ok, obtenido: `${r.status} ingresos=S/ ${r.data?.ingresos} ventas=${r.data?.ventas} entradas=${r.data?.asistencias}`, ms: r.ms };
});

await caso('E2E-29', 'M6 Reportes', 'Rango de fechas inválido', '400', async () => {
  const r = await llamar('GET', '/api/reportes/resumen?desde=2026-05-10&hasta=2026-05-01', { cookie: adm });
  return { ok: r.status === 400, obtenido: `${r.status} ${r.data?.error}`, ms: r.ms };
});

await caso('E2E-30', 'M3 Planes', 'Plan con precio y duración inválidos', '400', async () => {
  const r = await llamar('POST', '/api/planes', { cookie: adm, cuerpo: { nombre: 'Malo', duracion_dias: 0, precio: -5 } });
  return { ok: r.status === 400 && r.data?.detalles?.length === 2, obtenido: `${r.status}: ${(r.data?.detalles || []).join('; ')}`, ms: r.ms };
});

await caso('E2E-31', 'M4 Membresías', 'Anulación por administrador', '200 y una segunda anulación devuelve 409', async () => {
  const a = await llamar('POST', `/api/membresias/${membresia2.id}/anular`, { cookie: rec, cuerpo: {} });
  const b = await llamar('POST', `/api/membresias/${membresia2.id}/anular`, { cookie: adm, cuerpo: {} });
  const c = await llamar('POST', `/api/membresias/${membresia2.id}/anular`, { cookie: adm, cuerpo: {} });
  return { ok: a.status === 403 && b.status === 200 && c.status === 409, obtenido: `recepción=${a.status}, admin=${b.status}, repetida=${c.status}`, ms: b.ms };
});

await caso('E2E-32', 'M1 Autenticación', 'Cierre de sesión invalida la cookie', '200 y luego 401', async () => {
  const a = await llamar('POST', '/api/logout', { cookie: rec, cuerpo: {} });
  const b = await llamar('GET', '/api/me', { cookie: rec });
  return { ok: a.status === 200 && b.status === 401, obtenido: `logout=${a.status}, me=${b.status}`, ms: a.ms };
});

await caso('E2E-33', 'Rendimiento', 'Tiempo de respuesta con el servicio despierto', 'Promedio menor a 1500 ms', async () => {
  const tiempos = resultados.map((r) => r.ms).filter((n) => n > 0);
  const prom = Math.round(tiempos.reduce((s, n) => s + n, 0) / tiempos.length);
  return { ok: prom < 1500, obtenido: `promedio ${prom} ms, máximo ${Math.max(...tiempos)} ms (arranque en frío: ${calentamiento.ms} ms)`, ms: prom };
});

// ---------------- reporte ----------------
const aprobados = resultados.filter((r) => r.estado === 'Aprobado').length;
const fin = new Date();
const fechaLima = (d) => d.toLocaleString('es-PE', { timeZone: 'America/Lima' });
const md = [
  '# Reporte de ejecución de pruebas E2E',
  '',
  `- **Sistema:** Gym Andino`,
  `- **Ambiente:** ${BASE}`,
  `- **Inicio:** ${fechaLima(inicio)} (hora de Lima)`,
  `- **Fin:** ${fechaLima(fin)}`,
  `- **Resultado:** ${aprobados} de ${resultados.length} casos aprobados (${Math.round((aprobados / resultados.length) * 100)} %)`,
  `- **DNI de prueba usado:** ${dniPrueba}`,
  '',
  'Generado automáticamente con `node scripts/e2e.mjs`.',
  '',
  '| ID | Módulo | Caso | Resultado esperado | Resultado obtenido | ms | Estado |',
  '|---|---|---|---|---|---|---|',
  ...resultados.map((r) => `| ${r.id} | ${r.modulo} | ${r.descripcion} | ${r.esperado} | ${String(r.obtenido).replace(/\|/g, '\\|')} | ${r.ms} | ${r.estado === 'Aprobado' ? '✅ Aprobado' : '❌ Fallido'} |`),
  '',
].join('\n');
const dir = join(RAIZ, 'docs', 'pruebas');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'reporte-e2e.md'), md);
writeFileSync(join(dir, 'reporte-e2e.json'), json({ base: BASE, inicio, fin, aprobados, total: resultados.length, resultados }) + '\n');
console.log(`\n${aprobados}/${resultados.length} aprobados. Reporte: docs/pruebas/reporte-e2e.md`);
process.exit(aprobados === resultados.length ? 0 : 1);
