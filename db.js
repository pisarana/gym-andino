'use strict';
// Base de datos SQLite (módulo integrado en Node 22+, sin dependencias externas).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'gym.db');
if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','recepcion')),
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS planes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  duracion_dias INTEGER NOT NULL CHECK (duracion_dias > 0),
  precio REAL NOT NULL CHECK (precio > 0),
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS socios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  documento TEXT NOT NULL UNIQUE,
  telefono TEXT,
  email TEXT,
  fecha_registro TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS membresias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  plan_id INTEGER NOT NULL REFERENCES planes(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','yape','tarjeta')),
  fecha_pago TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','anulada'))
);
CREATE TABLE IF NOT EXISTS asistencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  hora TEXT NOT NULL,
  UNIQUE (socio_id, fecha)
);
`);

// ---- Utilidades de fecha (zona horaria de Lima, formato AAAA-MM-DD) ----
function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}
function ahoraHora() {
  return new Date().toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour12: false, hour: '2-digit', minute: '2-digit' });
}
function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function hashPassword(clave) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(clave, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(clave, almacenado) {
  const [saltHex, hashHex] = String(almacenado).split(':');
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const real = crypto.scryptSync(clave, Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, real);
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Datos de prueba (solo si la base está vacía) ----
function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0) return;
  const h = hoy();

  const addUser = db.prepare('INSERT INTO usuarios (nombre, usuario, clave_hash, rol) VALUES (?,?,?,?)');
  addUser.run('Diego Salas', 'admin', hashPassword('Admin2026!'), 'admin');
  addUser.run('Rosa Quispe', 'recepcion', hashPassword('Recepcion2026!'), 'recepcion');

  const addPlan = db.prepare('INSERT INTO planes (nombre, duracion_dias, precio) VALUES (?,?,?)');
  addPlan.run('Pase diario', 1, 10);
  addPlan.run('Mensual', 30, 90);
  addPlan.run('Trimestral', 90, 240);
  addPlan.run('Anual', 365, 800);

  const addSocio = db.prepare('INSERT INTO socios (nombre, documento, telefono, email, fecha_registro) VALUES (?,?,?,?,?)');
  addSocio.run('María Huamán Torres', '45871236', '987654321', 'maria.huaman@example.com', sumarDias(h, -60));
  addSocio.run('Jorge Ramírez Soto', '71234598', '999111222', null, sumarDias(h, -45));
  addSocio.run('Lucía Paredes Vega', '40123987', '912345678', 'lucia.paredes@example.com', sumarDias(h, -90));
  addSocio.run('Carlos Mendoza Ruiz', '70987654', null, null, sumarDias(h, -20));
  addSocio.run('Ana Flores Díaz', '46789123', '955443322', 'ana.flores@example.com', sumarDias(h, -5));
  addSocio.run('Renzo Gutiérrez Alva', '72458813', '934882110', 'renzo.ga@example.com', sumarDias(h, -120));
  addSocio.run('Valeria Chávez Ríos', '48120974', '976220431', null, sumarDias(h, -75));
  addSocio.run('Diego Mamani Condori', '73390415', '951663920', null, sumarDias(h, -40));
  addSocio.run('Camila Rojas Pinto', '47012356', '988014527', 'camila.rojas@example.com', sumarDias(h, -33));
  addSocio.run('Luis Fernández Cáceres', '41887230', '965301884', null, sumarDias(h, -200));
  addSocio.run('Sofía Ccama Huallpa', '75520687', '913774052', 'sofia.ccama@example.com', sumarDias(h, -18));
  addSocio.run('Andrés Villanueva Paz', '70214869', null, null, sumarDias(h, -12));

  const addMem = db.prepare(`INSERT INTO membresias
    (socio_id, plan_id, usuario_id, fecha_inicio, fecha_fin, monto, metodo_pago, fecha_pago) VALUES (?,?,?,?,?,?,?,?)`);
  // [socio, plan, usuario, inicio (días desde hoy), fin, monto, método]
  // María: vigente; Jorge: por vencer; Lucía: vencida; Carlos: trimestral; Ana: sin membresía (casos de prueba)
  const membresias = [
    [1, 2, 2, -10, 19, 90, 'yape'],
    [2, 2, 2, -27, 2, 90, 'efectivo'],
    [3, 2, 2, -50, -21, 90, 'tarjeta'],
    [4, 3, 1, -20, 69, 240, 'tarjeta'],
    [6, 4, 1, -120, 244, 800, 'tarjeta'],
    [7, 3, 2, -75, 14, 240, 'yape'],
    [8, 2, 2, -24, 5, 90, 'efectivo'],
    [9, 2, 2, -3, 26, 90, 'yape'],
    [10, 4, 1, -200, 164, 800, 'tarjeta'],
    [11, 2, 2, -18, 11, 90, 'yape'],
    [12, 2, 2, -12, 17, 90, 'efectivo'],
  ];
  for (const [s, p, u, ini, fin, monto, metodo] of membresias) {
    addMem.run(s, p, u, sumarDias(h, ini), sumarDias(h, fin), monto, metodo, sumarDias(h, ini));
  }

  // Asistencias de los últimos 21 días (nunca hoy), con horas pico realistas de un gimnasio.
  const addAsis = db.prepare('INSERT INTO asistencias (socio_id, usuario_id, fecha, hora) VALUES (?,?,?,?)');
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const horas = ['06', '06', '07', '07', '07', '08', '09', '12', '13', '17', '18', '18', '18', '19', '19', '19', '20', '20', '21'];
  for (let d = 21; d >= 1; d--) {
    for (const [s, , , ini, fin] of membresias) {
      if (-d < ini || -d > fin || azar() > 0.55) continue;
      const hora = `${horas[Math.floor(azar() * horas.length)]}:${String(Math.floor(azar() * 60)).padStart(2, '0')}`;
      addAsis.run(s, 2, sumarDias(h, -d), hora);
    }
  }
}
seed();

module.exports = { db, hashPassword, verifyPassword, transaction, hoy, ahoraHora, sumarDias };
