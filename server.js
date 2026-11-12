'use strict';
// Servidor HTTP + API REST de Gym Andino. Sin dependencias externas (solo módulos de Node).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, verifyPassword, transaction, hoy, ahoraHora, sumarDias } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const PRODUCCION = process.env.NODE_ENV === 'production';
const SEGURA = PRODUCCION ? '; Secure' : ''; // en producción la app se sirve solo por HTTPS
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESION_MS = 8 * 60 * 60 * 1000;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 60 * 1000;

const sesiones = new Map(); // sid -> { usuario, exp }
const intentos = new Map(); // usuario -> { n, hasta }

// ---------- utilidades ----------
class ApiError extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

function enviarJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...cabecerasSeguridad(),
  });
  res.end(body);
}

function cabecerasSeguridad() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
  };
}

function leerCookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

function leerJson(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(new ApiError(415, 'El contenido debe ser application/json'));
    }
    let size = 0;
    const partes = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100 * 1024) {
        reject(new ApiError(413, 'La solicitud es demasiado grande'));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => {
      try {
        const b = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new Error();
        resolve(b);
      } catch {
        reject(new ApiError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const entero = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN);
const numero = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (s) => FECHA_RE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

function exigir(errores) {
  if (errores.length) throw new ApiError(400, 'Datos inválidos', errores);
}

// ---------- sesiones ----------
function usuarioActual(req) {
  const sid = leerCookies(req).sid;
  const s = sid && sesiones.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) {
    sesiones.delete(sid);
    return null;
  }
  return s.usuario;
}

function requiereLogin(u) {
  if (!u) throw new ApiError(401, 'Debe iniciar sesión');
}
function requiereAdmin(u) {
  requiereLogin(u);
  if (u.rol !== 'admin') throw new ApiError(403, 'No tiene permiso para esta acción');
}

// ---------- estado de membresía de un socio ----------
function estadoMembresia(maxFin) {
  const h = hoy();
  if (!maxFin) return 'sin_membresia';
  if (maxFin < h) return 'vencida';
  if (maxFin <= sumarDias(h, 7)) return 'por_vencer';
  return 'vigente';
}

const SQL_SOCIO = `
  SELECT s.*, (SELECT MAX(fecha_fin) FROM membresias m WHERE m.socio_id = s.id AND m.estado = 'activa') AS vence
  FROM socios s`;

function conEstado(s) {
  return s ? { ...s, estado_membresia: estadoMembresia(s.vence) } : s;
}

// ---------- validaciones ----------
function validarSocio(b) {
  const e = [];
  const nombre = texto(b.nombre);
  const documento = texto(b.documento);
  const telefono = texto(b.telefono);
  const email = texto(b.email);
  if (nombre.length < 3 || nombre.length > 80) e.push('El nombre debe tener entre 3 y 80 caracteres');
  if (!/^\d{8}$/.test(documento)) e.push('El DNI debe tener 8 dígitos');
  if (telefono && !/^9\d{8}$/.test(telefono)) e.push('El teléfono debe tener 9 dígitos y empezar con 9');
  if (email && (email.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) e.push('El correo no tiene un formato válido');
  exigir(e);
  return { nombre, documento, telefono: telefono || null, email: email || null };
}

function validarPlan(b) {
  const e = [];
  const nombre = texto(b.nombre);
  const duracion = entero(b.duracion_dias);
  const precio = numero(b.precio);
  if (nombre.length < 3 || nombre.length > 40) e.push('El nombre del plan debe tener entre 3 y 40 caracteres');
  if (!Number.isInteger(duracion) || duracion < 1 || duracion > 730) e.push('La duración debe ser un número entero de 1 a 730 días');
  if (!Number.isFinite(precio) || precio <= 0 || precio > 10000) e.push('El precio debe ser mayor que 0 y menor o igual a 10000');
  exigir(e);
  return { nombre, duracion_dias: duracion, precio: Math.round(precio * 100) / 100 };
}

function esUnico(err) {
  return /UNIQUE/i.test(String(err && err.message));
}

// ---------- rutas ----------
const rutas = [];
const ruta = (metodo, patron, fn) => rutas.push({ metodo, re: new RegExp(`^${patron}$`), fn });

ruta('POST', '/api/login', async (ctx) => {
  const b = await leerJson(ctx.req);
  const usuario = texto(b.usuario).toLowerCase();
  const clave = typeof b.clave === 'string' ? b.clave : '';
  if (!usuario || !clave) throw new ApiError(400, 'Ingrese usuario y contraseña');
  const reg = intentos.get(usuario);
  if (reg && reg.hasta > Date.now()) {
    throw new ApiError(429, 'Cuenta bloqueada temporalmente por intentos fallidos. Intente en 1 minuto.');
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario);
  if (!u || !verifyPassword(clave, u.clave_hash)) {
    // El contador se reinicia solo cuando un bloqueo anterior ya expiró.
    const previos = reg && !(reg.hasta > 0 && reg.hasta <= Date.now()) ? reg.n : 0;
    const n = previos + 1;
    intentos.set(usuario, { n, hasta: n >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0 });
    throw new ApiError(401, 'Usuario o contraseña incorrectos');
  }
  intentos.delete(usuario);
  const sid = crypto.randomBytes(32).toString('hex');
  const datos = { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol };
  sesiones.set(sid, { usuario: datos, exp: Date.now() + SESION_MS });
  ctx.cookie = `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESION_MS / 1000}${SEGURA}`;
  return { usuario: datos };
});

ruta('POST', '/api/logout', async (ctx) => {
  const sid = leerCookies(ctx.req).sid;
  if (sid) sesiones.delete(sid);
  ctx.cookie = `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SEGURA}`;
  return { ok: true };
});

// Comprobación de salud para la plataforma de despliegue (sin datos sensibles).
ruta('GET', '/api/salud', async () => {
  db.prepare('SELECT 1').get();
  return { estado: 'ok' };
});

ruta('GET', '/api/me', async (ctx) => {
  requiereLogin(ctx.user);
  return { usuario: ctx.user, hoy: hoy() };
});

// --- Socios ---
ruta('GET', '/api/socios', async (ctx) => {
  requiereLogin(ctx.user);
  const q = `%${ctx.url.searchParams.get('q') || ''}%`;
  const filas = db.prepare(`${SQL_SOCIO} WHERE (s.nombre LIKE ? OR s.documento LIKE ?) ORDER BY s.nombre`).all(q, q);
  return filas.map(conEstado);
});

ruta('GET', '/api/socios/(\\d+)', async (ctx, id) => {
  requiereLogin(ctx.user);
  const s = db.prepare(`${SQL_SOCIO} WHERE s.id = ?`).get(id);
  if (!s) throw new ApiError(404, 'Socio no encontrado');
  const membresias = db.prepare(`SELECT m.*, p.nombre AS plan FROM membresias m JOIN planes p ON p.id = m.plan_id
    WHERE m.socio_id = ? ORDER BY m.fecha_inicio DESC, m.id DESC`).all(id);
  const asistencias = db.prepare('SELECT fecha, hora FROM asistencias WHERE socio_id = ? ORDER BY fecha DESC LIMIT 15').all(id);
  return { ...conEstado(s), membresias, asistencias };
});

ruta('POST', '/api/socios', async (ctx) => {
  requiereLogin(ctx.user);
  const d = validarSocio(await leerJson(ctx.req));
  try {
    const r = db.prepare('INSERT INTO socios (nombre, documento, telefono, email, fecha_registro) VALUES (?,?,?,?,?)')
      .run(d.nombre, d.documento, d.telefono, d.email, hoy());
    ctx.status = 201;
    return conEstado(db.prepare(`${SQL_SOCIO} WHERE s.id = ?`).get(r.lastInsertRowid));
  } catch (err) {
    if (esUnico(err)) throw new ApiError(409, 'Ya existe un socio con ese DNI');
    throw err;
  }
});

ruta('PUT', '/api/socios/(\\d+)', async (ctx, id) => {
  requiereLogin(ctx.user);
  const b = await leerJson(ctx.req);
  const d = validarSocio(b);
  if (!db.prepare('SELECT id FROM socios WHERE id = ?').get(id)) throw new ApiError(404, 'Socio no encontrado');
  let activo = null;
  if (b.activo !== undefined) {
    requiereAdmin(ctx.user);
    activo = b.activo ? 1 : 0;
  }
  try {
    db.prepare('UPDATE socios SET nombre=?, documento=?, telefono=?, email=?, activo=COALESCE(?, activo) WHERE id=?')
      .run(d.nombre, d.documento, d.telefono, d.email, activo, id);
  } catch (err) {
    if (esUnico(err)) throw new ApiError(409, 'Ya existe un socio con ese DNI');
    throw err;
  }
  return conEstado(db.prepare(`${SQL_SOCIO} WHERE s.id = ?`).get(id));
});

ruta('DELETE', '/api/socios/(\\d+)', async (ctx, id) => {
  requiereAdmin(ctx.user);
  const r = db.prepare('UPDATE socios SET activo = 0 WHERE id = ?').run(id);
  if (!r.changes) throw new ApiError(404, 'Socio no encontrado');
  return { ok: true };
});

// --- Planes ---
ruta('GET', '/api/planes', async (ctx) => {
  requiereLogin(ctx.user);
  const todos = ctx.user.rol === 'admin' && ctx.url.searchParams.get('todos') === '1';
  return db.prepare(`SELECT * FROM planes ${todos ? '' : 'WHERE activo = 1'} ORDER BY duracion_dias`).all();
});

ruta('POST', '/api/planes', async (ctx) => {
  requiereAdmin(ctx.user);
  const d = validarPlan(await leerJson(ctx.req));
  try {
    const r = db.prepare('INSERT INTO planes (nombre, duracion_dias, precio) VALUES (?,?,?)').run(d.nombre, d.duracion_dias, d.precio);
    ctx.status = 201;
    return db.prepare('SELECT * FROM planes WHERE id = ?').get(r.lastInsertRowid);
  } catch (err) {
    if (esUnico(err)) throw new ApiError(409, 'Ya existe un plan con ese nombre');
    throw err;
  }
});

ruta('PUT', '/api/planes/(\\d+)', async (ctx, id) => {
  requiereAdmin(ctx.user);
  const b = await leerJson(ctx.req);
  const d = validarPlan(b);
  if (!db.prepare('SELECT id FROM planes WHERE id = ?').get(id)) throw new ApiError(404, 'Plan no encontrado');
  try {
    db.prepare('UPDATE planes SET nombre=?, duracion_dias=?, precio=?, activo=COALESCE(?, activo) WHERE id=?')
      .run(d.nombre, d.duracion_dias, d.precio, b.activo === undefined ? null : b.activo ? 1 : 0, id);
  } catch (err) {
    if (esUnico(err)) throw new ApiError(409, 'Ya existe un plan con ese nombre');
    throw err;
  }
  return db.prepare('SELECT * FROM planes WHERE id = ?').get(id);
});

ruta('DELETE', '/api/planes/(\\d+)', async (ctx, id) => {
  requiereAdmin(ctx.user);
  const r = db.prepare('UPDATE planes SET activo = 0 WHERE id = ?').run(id);
  if (!r.changes) throw new ApiError(404, 'Plan no encontrado');
  return { ok: true };
});

// --- Membresías (venta de un plan a un socio) ---
ruta('GET', '/api/membresias', async (ctx) => {
  requiereLogin(ctx.user);
  return db.prepare(`SELECT m.*, s.nombre AS socio, s.documento, p.nombre AS plan, u.nombre AS registrado_por
    FROM membresias m JOIN socios s ON s.id = m.socio_id JOIN planes p ON p.id = m.plan_id JOIN usuarios u ON u.id = m.usuario_id
    ORDER BY m.id DESC LIMIT 100`).all();
});

ruta('POST', '/api/membresias', async (ctx) => {
  requiereLogin(ctx.user);
  const b = await leerJson(ctx.req);
  const socioId = entero(b.socio_id);
  const planId = entero(b.plan_id);
  const metodo = texto(b.metodo_pago);
  const e = [];
  if (!Number.isInteger(socioId)) e.push('Seleccione un socio');
  if (!Number.isInteger(planId)) e.push('Seleccione un plan');
  if (!['efectivo', 'yape', 'tarjeta'].includes(metodo)) e.push('Seleccione un método de pago válido');
  exigir(e);
  const socio = db.prepare('SELECT * FROM socios WHERE id = ?').get(socioId);
  if (!socio) throw new ApiError(404, 'Socio no encontrado');
  if (!socio.activo) throw new ApiError(409, 'El socio está inactivo');
  const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(planId);
  if (!plan) throw new ApiError(404, 'Plan no encontrado o inactivo');

  const h = hoy();
  const { fin } = db.prepare("SELECT MAX(fecha_fin) AS fin FROM membresias WHERE socio_id = ? AND estado = 'activa'").get(socioId);
  // Si ya tiene una membresía vigente, la nueva empieza al día siguiente de su vencimiento (renovación).
  const inicio = fin && fin >= h ? sumarDias(fin, 1) : h;
  const fechaFin = sumarDias(inicio, plan.duracion_dias - 1);
  const r = db.prepare(`INSERT INTO membresias (socio_id, plan_id, usuario_id, fecha_inicio, fecha_fin, monto, metodo_pago, fecha_pago)
    VALUES (?,?,?,?,?,?,?,?)`).run(socioId, planId, ctx.user.id, inicio, fechaFin, plan.precio, metodo, h);
  ctx.status = 201;
  return db.prepare('SELECT * FROM membresias WHERE id = ?').get(r.lastInsertRowid);
});

ruta('POST', '/api/membresias/(\\d+)/anular', async (ctx, id) => {
  requiereAdmin(ctx.user);
  const m = db.prepare('SELECT * FROM membresias WHERE id = ?').get(id);
  if (!m) throw new ApiError(404, 'Membresía no encontrada');
  if (m.estado === 'anulada') throw new ApiError(409, 'La membresía ya está anulada');
  db.prepare("UPDATE membresias SET estado = 'anulada' WHERE id = ?").run(id);
  return { ok: true };
});

// --- Asistencia (check-in) ---
ruta('GET', '/api/asistencias', async (ctx) => {
  requiereLogin(ctx.user);
  const f = ctx.url.searchParams.get('fecha') || hoy();
  if (!fechaValida(f)) throw new ApiError(400, 'Fecha inválida (use AAAA-MM-DD)');
  return db.prepare(`SELECT a.id, a.socio_id, a.fecha, a.hora, s.nombre, s.documento FROM asistencias a JOIN socios s ON s.id = a.socio_id
    WHERE a.fecha = ? ORDER BY a.hora DESC, a.id DESC`).all(f);
});

ruta('POST', '/api/asistencias', async (ctx) => {
  requiereLogin(ctx.user);
  const b = await leerJson(ctx.req);
  const documento = texto(b.documento);
  if (!/^\d{8}$/.test(documento)) throw new ApiError(400, 'El DNI debe tener 8 dígitos');
  const socio = db.prepare('SELECT * FROM socios WHERE documento = ?').get(documento);
  if (!socio) throw new ApiError(404, 'No existe un socio con ese DNI');
  if (!socio.activo) throw new ApiError(409, 'El socio está inactivo');
  const h = hoy();
  const actual = db.prepare(`SELECT m.fecha_inicio, m.fecha_fin, p.nombre AS plan FROM membresias m JOIN planes p ON p.id = m.plan_id
    WHERE m.socio_id = ? AND m.estado = 'activa' AND m.fecha_inicio <= ? AND m.fecha_fin >= ?
    ORDER BY m.fecha_fin DESC LIMIT 1`).get(socio.id, h, h);
  if (!actual) throw new ApiError(409, 'Membresía vencida o inexistente. Debe renovar para ingresar.');
  // Si ya pagó una renovación, la vigencia total llega hasta el final de la última membresía.
  const { fin } = db.prepare("SELECT MAX(fecha_fin) AS fin FROM membresias WHERE socio_id = ? AND estado = 'activa'").get(socio.id);
  const hora = ahoraHora();
  try {
    db.prepare('INSERT INTO asistencias (socio_id, usuario_id, fecha, hora) VALUES (?,?,?,?)').run(socio.id, ctx.user.id, h, hora);
  } catch (err) {
    if (esUnico(err)) throw new ApiError(409, 'El socio ya registró su asistencia hoy');
    throw err;
  }
  const dias = Math.round((Date.parse(fin) - Date.parse(h)) / 86400000);
  ctx.status = 201;
  return {
    socio: socio.nombre,
    socio_id: socio.id,
    hora,
    plan: actual.plan,
    inicio: actual.fecha_inicio,
    fin_plan: actual.fecha_fin,
    vence: fin,
    dias_restantes: dias,
  };
});

// --- Reportes (solo administrador) ---
ruta('GET', '/api/reportes/resumen', async (ctx) => {
  requiereAdmin(ctx.user);
  const h = hoy();
  const desde = ctx.url.searchParams.get('desde') || sumarDias(h, -29);
  const hasta = ctx.url.searchParams.get('hasta') || h;
  if (!fechaValida(desde) || !fechaValida(hasta)) throw new ApiError(400, 'Fechas inválidas (use AAAA-MM-DD)');
  if (desde > hasta) throw new ApiError(400, 'La fecha "desde" no puede ser mayor que "hasta"');
  const tot = db.prepare(`SELECT COALESCE(SUM(monto),0) AS ingresos, COUNT(*) AS ventas FROM membresias
    WHERE estado='activa' AND fecha_pago BETWEEN ? AND ?`).get(desde, hasta);
  const porPlan = db.prepare(`SELECT p.nombre AS plan, COUNT(*) AS ventas, SUM(m.monto) AS ingresos FROM membresias m
    JOIN planes p ON p.id = m.plan_id WHERE m.estado='activa' AND m.fecha_pago BETWEEN ? AND ?
    GROUP BY p.id ORDER BY ingresos DESC`).all(desde, hasta);
  const porMetodo = db.prepare(`SELECT metodo_pago AS metodo, COUNT(*) AS ventas, SUM(monto) AS ingresos FROM membresias
    WHERE estado='activa' AND fecha_pago BETWEEN ? AND ? GROUP BY metodo_pago ORDER BY ingresos DESC`).all(desde, hasta);
  const asistencias = db.prepare('SELECT COUNT(*) AS n FROM asistencias WHERE fecha BETWEEN ? AND ?').get(desde, hasta).n;
  const vigentes = db.prepare(`SELECT COUNT(DISTINCT socio_id) AS n FROM membresias
    WHERE estado='activa' AND fecha_inicio <= ? AND fecha_fin >= ?`).get(h, h).n;
  const porVencer = db.prepare(`SELECT s.id, s.nombre, s.documento, s.telefono, MAX(m.fecha_fin) AS vence
    FROM socios s JOIN membresias m ON m.socio_id = s.id AND m.estado='activa'
    WHERE s.activo = 1 GROUP BY s.id HAVING vence >= ? AND vence <= ? ORDER BY vence`).all(h, sumarDias(h, 7));
  const porDia = db.prepare(`SELECT fecha, COUNT(*) AS n FROM asistencias WHERE fecha BETWEEN ? AND ?
    GROUP BY fecha ORDER BY fecha`).all(desde, hasta);
  const porHora = db.prepare(`SELECT substr(hora, 1, 2) AS hora, COUNT(*) AS n FROM asistencias WHERE fecha BETWEEN ? AND ?
    GROUP BY substr(hora, 1, 2) ORDER BY hora`).all(desde, hasta);
  return {
    desde, hasta, ...tot, porPlan, porMetodo, asistencias, socios_vigentes: vigentes, por_vencer: porVencer, porDia, porHora,
  };
});

// ---------- estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function servirEstatico(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, cabecerasSeguridad());
    return res.end('Solicitud inválida');
  }
  if (rel === '/') rel = '/index.html';
  const archivo = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!archivo.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, cabecerasSeguridad());
    return res.end('Acceso denegado');
  }
  fs.readFile(archivo, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...cabecerasSeguridad() });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...cabecerasSeguridad(),
    });
    res.end(data);
  });
}

// ---------- servidor ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, cabecerasSeguridad());
      return res.end('Método no permitido');
    }
    return servirEstatico(req, res, url.pathname);
  }
  const ctx = { req, url, user: usuarioActual(req), status: 200, cookie: null };
  try {
    let hallada = false;
    for (const r of rutas) {
      const m = r.re.exec(url.pathname);
      if (m && r.metodo === req.method) {
        hallada = true;
        const resultado = await r.fn(ctx, ...m.slice(1).map(Number));
        if (ctx.cookie) res.setHeader('Set-Cookie', ctx.cookie);
        return enviarJson(res, ctx.status, resultado);
      }
      if (m) hallada = true;
    }
    throw new ApiError(hallada ? 405 : 404, hallada ? 'Método no permitido' : 'Ruta no encontrada');
  } catch (err) {
    if (err instanceof ApiError) {
      return enviarJson(res, err.status, { error: err.message, detalles: err.detalles });
    }
    console.error(err);
    enviarJson(res, 500, { error: 'Error interno del servidor' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Gym Andino en http://localhost:${PORT}`));
}

module.exports = { server };
