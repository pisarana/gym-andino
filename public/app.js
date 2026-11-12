'use strict';
/* Gym Andino — interfaz (JavaScript sin frameworks).
   Todo el contenido dinámico se inserta con textContent (vía h()), nunca con innerHTML. */

const estado = { usuario: null, hoy: null, preSocio: null };
const raiz = document.getElementById('app');
let limpiezas = []; // temporizadores de la vista actual (reloj, pase)

// ---------- utilidades DOM ----------
function h(tag, props, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONOS = {
  ingreso: ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'M10 17l5-5-5-5', 'M15 12H3'],
  socios: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  membresias: ['M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M2 10h20', 'M6 15h4'],
  planes: ['M6.5 6.5h11', 'M6.5 17.5h11', 'M3 9v6', 'M21 9v6', 'M6.5 4v16', 'M17.5 4v16'],
  reportes: ['M3 3v18h18', 'M8 17v-5', 'M13 17V8', 'M18 17v-3'],
  buscar: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'M21 21l-4.3-4.3'],
  pantalla: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
};
function icono(nombre) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icono');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONOS[nombre]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin cuerpo */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'No se pudo completar la operación');
    err.status = res.status;
    err.detalles = (data && data.detalles) || [];
    if (res.status === 401 && ruta !== '/api/login') {
      estado.usuario = null;
      mostrarLogin('Tu sesión terminó. Ingresa nuevamente.');
    }
    throw err;
  }
  return data;
}

// ---------- formato ----------
const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const dinero = (n) => soles.format(Number(n) || 0);
const enteroSoles = (n) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 }).format(Number(n) || 0);
function fecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function sumarDias(f, n) {
  const [y, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
function iniciales(nombre) {
  return String(nombre).trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}
const primerNombre = (nombre) => String(nombre).trim().split(/\s+/)[0];
const esAdmin = () => estado.usuario && estado.usuario.rol === 'admin';

const ESTADOS = {
  vigente: 'Vigente', por_vencer: 'Por vencer', vencida: 'Vencida', sin_membresia: 'Sin membresía',
  inactivo: 'Inactivo', activa: 'Activa', anulada: 'Anulada', inactiva: 'Inactivo',
};
const insignia = (clave) => h('span', { class: `estado estado--${clave}` }, ESTADOS[clave] || clave);
const METODOS = { efectivo: 'Efectivo', yape: 'Yape', tarjeta: 'Tarjeta' };
const avatar = (nombre, est) => h('span', { class: 'avatar', 'data-estado': est || null, 'aria-hidden': 'true' }, iniciales(nombre));

let toastTimer;
function aviso(texto) {
  const t = document.getElementById('toast');
  t.textContent = texto;
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3500);
}

function alertaError(err) {
  return h('div', { class: 'alerta alerta--error', role: 'alert' },
    h('p', {}, err.message),
    err.detalles && err.detalles.length ? h('ul', {}, err.detalles.map((d) => h('li', {}, d))) : null);
}

let contadorId = 0;
function campo(etiqueta, control, ayuda) {
  if (!control.id) control.id = `c${++contadorId}`;
  return h('div', { class: 'campo' }, h('label', { for: control.id }, etiqueta), control, ayuda ? h('small', {}, ayuda) : null);
}

function tabla(columnas, filas, vacio, claseFila) {
  if (!filas.length) return h('p', { class: 'vacio' }, vacio);
  const clase = (c) => [c.clase, c.principal ? 'principal' : null].filter(Boolean).join(' ') || null;
  return h('table', { class: 'tabla' },
    h('thead', {}, h('tr', {}, columnas.map((c) => h('th', { scope: 'col', class: c.clase }, c.t)))),
    h('tbody', {}, filas.map((f) => h('tr', { class: claseFila ? claseFila(f) : null },
      columnas.map((c) => h('td', { 'data-label': c.t, class: clase(c) }, c.v(f)))))));
}

function persona(nombre, sub, est, onclick) {
  return h('div', { class: 'persona' },
    avatar(nombre, est),
    h('div', { class: 'persona__texto' },
      onclick ? h('button', { type: 'button', class: 'enlace', onclick }, nombre) : h('strong', {}, nombre),
      sub ? h('span', {}, sub) : null));
}

function abrirDialogo(titulo, ...contenido) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const d = h('dialog', { class: 'dialogo', 'aria-labelledby': 'dlg-titulo' },
    h('header', { class: 'dialogo__cab' },
      h('h2', { id: 'dlg-titulo' }, titulo),
      h('button', { type: 'button', class: 'btn btn--fantasma btn--chico', onclick: () => d.close() }, 'Cerrar')),
    h('div', { class: 'dialogo__cuerpo' }, contenido));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

// Envía un formulario mostrando errores en "zona" y bloqueando el botón mientras espera.
async function enviar(form, zona, accion) {
  const boton = form.querySelector('[type=submit]');
  zona.replaceChildren();
  if (boton) boton.disabled = true;
  try {
    return await accion();
  } catch (err) {
    if (err.status !== 401) zona.replaceChildren(alertaError(err));
    return undefined;
  } finally {
    if (boton) boton.disabled = false;
  }
}

// ---------- login ----------
function mostrarLogin(mensaje) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  limpiar();
  const zona = h('div', {}, mensaje ? h('div', { class: 'alerta alerta--aviso', role: 'status' }, h('p', {}, mensaje)) : null);
  const usuario = h('input', { name: 'usuario', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const clave = h('input', { name: 'clave', type: 'password', autocomplete: 'current-password' });
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const r = await enviar(form, zona, () => api('POST', '/api/login', { usuario: usuario.value, clave: clave.value }));
      if (r) iniciarApp();
      else clave.select();
    },
  },
  h('h1', {}, 'Iniciar sesión'),
  zona,
  campo('Usuario', usuario),
  campo('Contraseña', clave),
  h('button', { type: 'submit', class: 'btn btn--primario' }, 'Ingresar'));

  raiz.replaceChildren(h('main', { class: 'login' },
    h('section', { class: 'login__lado' },
      h('div', { class: 'login__logo' }, h('img', { src: 'logo.svg', alt: '' }), h('span', {}, 'Gym Andino')),
      h('div', {},
        h('p', { class: 'login__lema' }, 'Entrena a ', h('em', {}, 'otra altura')),
        h('p', { class: 'login__sub' }, 'Recepción, socios, membresías y control de ingreso del gimnasio.')),
      h('div', { class: 'franja', 'aria-hidden': 'true' })),
    h('section', { class: 'login__form' }, h('div', {}, form))));
  document.title = 'Iniciar sesión | Gym Andino';
  usuario.focus();
}

// ---------- estructura y navegación ----------
const RUTAS = {
  ingreso: { t: 'Ingreso', fn: vistaIngreso },
  socios: { t: 'Socios', fn: vistaSocios },
  membresias: { t: 'Membresías', fn: vistaMembresias },
  planes: { t: 'Planes', fn: vistaPlanes, admin: true },
  reportes: { t: 'Reportes', fn: vistaReportes, admin: true },
};

function rutaActual() {
  const r = location.hash.replace(/^#\/?/, '');
  return RUTAS[r] && (!RUTAS[r].admin || esAdmin()) ? r : 'ingreso';
}

function limpiar() {
  limpiezas.forEach((fn) => fn());
  limpiezas = [];
}

async function iniciarApp() {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (!r.ok) return mostrarLogin();
    const data = await r.json();
    estado.usuario = data.usuario;
    estado.hoy = data.hoy;
  } catch {
    raiz.replaceChildren(h('main', { class: 'vista' }, alertaError(new Error('No se pudo conectar con el servidor. Revisa tu conexión y recarga la página.'))));
    return;
  }
  const u = estado.usuario;
  raiz.replaceChildren(h('div', { class: 'app' },
    h('aside', { class: 'rail' },
      h('div', { class: 'franja', 'aria-hidden': 'true' }),
      h('a', { class: 'marca', href: '#/ingreso', 'aria-label': 'Gym Andino, ir a Ingreso' }, h('img', { src: 'logo.svg', alt: '' }), h('span', {}, 'Gym Andino')),
      h('div', { class: 'usuario' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(u.nombre)),
        h('div', { class: 'persona__texto' }, h('strong', {}, u.nombre), h('span', {}, u.rol === 'admin' ? 'Administrador' : 'Recepción')),
        h('button', { type: 'button', class: 'btn btn--chico', onclick: salir }, 'Salir'))),
    h('nav', { class: 'nav', 'aria-label': 'Secciones' },
      Object.entries(RUTAS).filter(([, r]) => !r.admin || esAdmin())
        .map(([clave, r]) => h('a', { href: `#/${clave}`, 'data-ruta': clave }, icono(clave), h('span', {}, r.t)))),
    h('main', { class: 'vista', id: 'vista', tabindex: '-1' })));
  navegar();
}

async function salir() {
  try { await api('POST', '/api/logout', {}); } catch { /* ignorar */ }
  estado.usuario = null;
  history.replaceState(null, '', location.pathname);
  mostrarLogin('Sesión cerrada.');
}

let navegacion = 0;
async function navegar() {
  if (!estado.usuario) return;
  const vista = document.getElementById('vista');
  if (!vista) return;
  limpiar();
  const clave = rutaActual();
  const id = ++navegacion;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.ruta === clave) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${RUTAS[clave].t} | Gym Andino`;
  vista.replaceChildren(h('p', { class: 'cargando' }, 'Cargando…'));
  try {
    const contenido = await RUTAS[clave].fn();
    if (id === navegacion) vista.replaceChildren(contenido);
  } catch (err) {
    if (err.status !== 401 && id === navegacion) vista.replaceChildren(alertaError(err));
  }
}
window.addEventListener('hashchange', navegar);
const recargar = () => navegar();

// ==========================================================================
// INGRESO: kiosko del mostrador
// ==========================================================================
async function vistaIngreso() {
  const reloj = h('p', { class: 'reloj', 'aria-hidden': 'true' });
  const fechaTxt = h('p', { class: 'fecha' });
  function tic() {
    const ahora = new Date();
    reloj.textContent = ahora.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
    fechaTxt.textContent = ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
  }
  tic();
  const intervalo = setInterval(tic, 10000);
  limpiezas.push(() => clearInterval(intervalo));

  const contador = h('strong', {}, '0');
  const feed = h('ul', { class: 'feed', 'aria-live': 'polite' });
  const feedCont = h('div', {});
  const feedTitulo = h('span', {});
  const pase = h('div', { class: 'pase', role: 'status', 'aria-live': 'polite' });

  const dni = h('input', {
    id: 'dni', name: 'documento', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: 'DNI',
    'aria-describedby': 'dni-ayuda',
    oninput: () => { dni.value = dni.value.replace(/\D/g, '').slice(0, 8); },
  });

  let temporizadorPase;
  limpiezas.push(() => clearTimeout(temporizadorPase));

  function enEspera() {
    pase.className = 'pase';
    pase.replaceChildren(h('div', { class: 'pase__espera' },
      h('img', { src: 'logo.svg', alt: '' }),
      h('div', {}, h('strong', {}, 'Listo para el siguiente'), h('p', {}, 'Ingresa el DNI del socio para registrar su entrada.'))),
    h('div', { class: 'franja', 'aria-hidden': 'true' }));
  }

  function mostrarPase({ tipo, veredicto, nombre, plan, dias, progreso, detalle, accion }) {
    clearTimeout(temporizadorPase);
    pase.className = `pase pase--${tipo}`;
    void pase.offsetWidth; // reinicia la animación de entrada
    pase.classList.add('pase--entra');
    const barra = progreso != null ? h('i', {}) : null;
    if (barra) barra.style.width = `${Math.max(4, Math.min(100, progreso))}%`;
    pase.replaceChildren(...[
      h('div', { class: 'pase__top' },
        nombre ? h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(nombre)) : null,
        h('p', { class: 'pase__veredicto' }, veredicto)),
      nombre ? h('p', { class: 'pase__nombre' }, nombre) : null,
      plan ? h('p', { class: 'pase__plan' }, plan) : null,
      dias != null ? h('p', { class: 'pase__dias' }, h('strong', {}, String(dias)),
        h('span', {}, dias === 0 ? 'último día' : dias === 1 ? 'día restante' : 'días restantes')) : null,
      barra ? h('div', { class: 'progreso', role: 'img', 'aria-label': `Membresía usada al ${Math.round(progreso)} %` }, barra) : null,
      detalle ? h('p', { class: 'pase__detalle' }, detalle) : null,
      accion ? h('div', { class: 'acciones' }, accion) : null,
    ].filter(Boolean));
    temporizadorPase = setTimeout(enEspera, tipo === 'error' ? 15000 : 9000);
  }

  function itemFeed(a, nuevo) {
    return h('li', { class: nuevo ? 'feed__nuevo' : null },
      persona(a.nombre, `DNI ${a.documento}`),
      h('time', { datetime: a.hora }, a.hora));
  }

  async function cargarFeed() {
    const filas = await api('GET', '/api/asistencias');
    contador.textContent = String(filas.length);
    feedTitulo.textContent = filas.length === 1 ? '1 ingreso' : `${filas.length} ingresos`;
    if (!filas.length) {
      feedCont.replaceChildren(h('p', { class: 'vacio' }, 'Aún nadie ha entrado hoy. El primer ingreso aparecerá aquí.'));
    } else {
      feed.replaceChildren(...filas.slice(0, 12).map((a, i) => itemFeed(a, i === 0 && feed.dataset.ultimo && Number(feed.dataset.ultimo) !== a.id)));
      feed.dataset.ultimo = String(filas[0].id);
      feedCont.replaceChildren(feed);
    }
  }

  async function registrar() {
    const valor = dni.value.trim();
    if (!/^\d{8}$/.test(valor)) {
      mostrarPase({ tipo: 'error', veredicto: 'Revisa el DNI', detalle: 'Debe tener exactamente 8 dígitos.' });
      dni.focus();
      return;
    }
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const r = await api('POST', '/api/asistencias', { documento: valor });
      const total = diasEntre(r.inicio, r.fin_plan) + 1;
      const usados = diasEntre(r.inicio, estado.hoy) + 1;
      const porVencer = r.dias_restantes <= 7;
      mostrarPase({
        tipo: porVencer ? 'aviso' : 'ok',
        veredicto: porVencer ? 'Pasa y renueva' : `¡A entrenar, ${primerNombre(r.socio)}!`,
        nombre: r.socio,
        plan: `Plan ${r.plan}, vence el ${fecha(r.vence)}`,
        dias: r.dias_restantes,
        progreso: (usados / total) * 100,
        detalle: porVencer ? 'Su membresía está por vencer. Ofrécele la renovación.' : null,
      });
      dni.value = '';
      await cargarFeed();
    } catch (err) {
      if (err.status === 401) return;
      if (err.status === 409 && /ya registró/i.test(err.message)) {
        mostrarPase({ tipo: 'aviso', veredicto: 'Ya ingresó hoy', detalle: 'Su entrada de hoy ya está registrada. No se cuenta dos veces.' });
        dni.value = '';
        return;
      }
      let accion = null;
      if (err.status === 409 && /vencida|inexistente/i.test(err.message)) {
        accion = h('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            const [s] = await api('GET', `/api/socios?q=${encodeURIComponent(valor)}`);
            if (s) { estado.preSocio = s.id; location.hash = '#/membresias'; }
          },
        }, 'Renovar membresía');
      }
      mostrarPase({
        tipo: 'error',
        veredicto: err.status === 404 ? 'DNI no registrado' : 'Acceso denegado',
        detalle: err.status === 404 ? 'No hay ningún socio con ese DNI. Regístralo en Socios.' : err.message,
        accion,
      });
    } finally {
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      dni.focus();
    }
  }

  const tecla = (texto, fn, clase) => h('button', { type: 'button', class: `tecla ${clase || ''}`, onclick: fn }, texto);
  const digito = (n) => tecla(String(n), () => { if (dni.value.length < 8) dni.value += n; dni.focus(); });
  const teclado = h('div', { class: 'teclado', role: 'group', 'aria-label': 'Teclado numérico' },
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(digito),
    tecla('Borrar', () => { dni.value = dni.value.slice(0, -1); dni.focus(); }, 'tecla--borrar'),
    digito(0),
    tecla('Entrar', () => form.requestSubmit(), 'tecla--entrar'));

  const form = h('form', { class: 'dni', novalidate: true, onsubmit: (e) => { e.preventDefault(); registrar(); } },
    h('label', { for: 'dni' }, 'DNI del socio'),
    dni,
    h('small', { id: 'dni-ayuda', class: 'oculto' }, 'Escribe los 8 dígitos y presiona Entrar'),
    h('button', { type: 'submit', class: 'btn btn--primario dni__enviar' }, 'Registrar ingreso'),
    teclado);

  const pantalla = document.fullscreenEnabled ? h('button', {
    type: 'button', class: 'btn btn--chico modo-kiosko',
    onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  }, icono('pantalla'), 'Modo kiosko') : null;

  enEspera();
  await cargarFeed();
  setTimeout(() => dni.focus(), 0);

  return h('div', {},
    h('div', { class: 'cabecera' },
      h('div', {}, h('h1', {}, 'Ingreso'), h('p', {}, 'Registra la entrada de cada socio con su DNI.')),
      pantalla),
    h('div', { class: 'kiosko' },
      h('section', { class: 'kiosko__entrada', 'aria-label': 'Registrar ingreso' },
        h('div', { class: 'kiosko__cab' },
          h('div', {}, reloj, fechaTxt),
          h('div', { class: 'contador' }, contador, h('span', {}, 'ingresos hoy'))),
        form),
      h('div', { class: 'kiosko__lateral' },
        pase,
        h('section', { class: 'panel', 'aria-labelledby': 'tit-hoy' },
          h('div', { class: 'bloque__cab feed__cab' }, h('h2', { id: 'tit-hoy' }, 'En el gym hoy'), feedTitulo),
          feedCont))));
}

// ==========================================================================
// SOCIOS
// ==========================================================================
async function vistaSocios() {
  const cont = h('div', { class: 'panel' });
  const resumen = h('p', {});
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre o DNI', 'aria-label': 'Buscar socio' });
  let t;
  async function cargar() {
    const filas = await api('GET', `/api/socios?q=${encodeURIComponent(buscar.value.trim())}`);
    const vigentes = filas.filter((s) => s.activo && ['vigente', 'por_vencer'].includes(s.estado_membresia)).length;
    if (!buscar.value) resumen.textContent = `${filas.length} socios, ${vigentes} con membresía vigente.`;
    cont.replaceChildren(tabla([
      {
        t: 'Socio', principal: true,
        v: (s) => persona(s.nombre, `DNI ${s.documento}`, s.activo ? s.estado_membresia : null, () => detalleSocio(s.id)),
      },
      { t: 'Celular', v: (s) => s.telefono || '—', clase: 'num' },
      { t: 'Membresía', v: (s) => insignia(s.activo ? s.estado_membresia : 'inactivo') },
      { t: 'Vence', v: (s) => fecha(s.vence), clase: 'num' },
    ], filas, buscar.value ? 'Ningún socio coincide con la búsqueda.' : 'Aún no hay socios. Registra el primero con Nuevo socio.',
    (s) => (s.activo ? null : 'inactivo')));
  }
  buscar.addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 250); });
  await cargar();
  return h('div', {},
    h('div', { class: 'cabecera' },
      h('div', {}, h('h1', {}, 'Socios'), resumen),
      h('button', { type: 'button', class: 'btn btn--primario', onclick: () => formSocio(null) }, 'Nuevo socio')),
    h('div', { class: 'herramientas buscador' }, icono('buscar'), buscar),
    cont);
}

function formSocio(socio) {
  const zona = h('div');
  const nombre = h('input', { name: 'nombre', maxlength: '80', autocomplete: 'off', value: socio ? socio.nombre : '' });
  const documento = h('input', { name: 'documento', inputmode: 'numeric', maxlength: '8', autocomplete: 'off', value: socio ? socio.documento : '' });
  const telefono = h('input', { name: 'telefono', type: 'tel', inputmode: 'numeric', maxlength: '9', value: socio ? socio.telefono || '' : '' });
  const email = h('input', { name: 'email', type: 'email', maxlength: '80', autocapitalize: 'none', value: socio ? socio.email || '' : '' });
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const datos = { nombre: nombre.value, documento: documento.value, telefono: telefono.value, email: email.value };
      const r = await enviar(form, zona, () => (socio ? api('PUT', `/api/socios/${socio.id}`, datos) : api('POST', '/api/socios', datos)));
      if (r) {
        dlg.close();
        aviso(socio ? 'Datos del socio guardados.' : `Socio registrado: ${r.nombre}`);
        if (socio) detalleSocio(socio.id);
        recargar();
      }
    },
  },
  zona,
  campo('Nombre completo', nombre),
  campo('DNI', documento, '8 dígitos'),
  campo('Celular (opcional)', telefono, '9 dígitos, empieza con 9'),
  campo('Correo (opcional)', email),
  h('div', { class: 'acciones' },
    h('button', { type: 'submit', class: 'btn btn--primario' }, socio ? 'Guardar cambios' : 'Registrar socio'),
    h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar')));
  const dlg = abrirDialogo(socio ? 'Editar socio' : 'Nuevo socio', form);
  nombre.focus();
}

async function detalleSocio(id) {
  let s;
  try { s = await api('GET', `/api/socios/${id}`); } catch (err) { if (err.status !== 401) aviso(err.message); return; }
  const est = s.activo ? s.estado_membresia : 'inactivo';

  const acciones = h('div', { class: 'acciones' },
    s.activo ? h('button', {
      type: 'button', class: 'btn btn--primario',
      onclick: () => { estado.preSocio = s.id; dlg.close(); if (location.hash === '#/membresias') recargar(); else location.hash = '#/membresias'; },
    }, s.estado_membresia === 'sin_membresia' ? 'Vender membresía' : 'Renovar') : null,
    h('button', { type: 'button', class: 'btn', onclick: () => formSocio(s) }, 'Editar datos'),
    esAdmin() ? h('button', {
      type: 'button', class: s.activo ? 'btn btn--peligro' : 'btn',
      onclick: async () => {
        if (s.activo && !confirm(`¿Desactivar a ${s.nombre}? No podrá ingresar al gimnasio ni comprar membresías.`)) return;
        try {
          if (s.activo) await api('DELETE', `/api/socios/${s.id}`);
          else await api('PUT', `/api/socios/${s.id}`, { nombre: s.nombre, documento: s.documento, telefono: s.telefono || '', email: s.email || '', activo: true });
          aviso(s.activo ? 'Socio desactivado.' : 'Socio reactivado.');
          detalleSocio(s.id);
          recargar();
        } catch (err) { if (err.status !== 401) aviso(err.message); }
      },
    }, s.activo ? 'Desactivar' : 'Reactivar') : null);

  const historial = tabla([
    { t: 'Plan', v: (m) => m.plan, principal: true },
    { t: 'Periodo', v: (m) => `${fecha(m.fecha_inicio)} al ${fecha(m.fecha_fin)}`, clase: 'num' },
    { t: 'Monto', v: (m) => dinero(m.monto), clase: 'num' },
    { t: 'Estado', v: (m) => insignia(m.estado) },
    ...(esAdmin() ? [{ t: '', v: (m) => (m.estado === 'activa' ? botonAnular(m, () => detalleSocio(s.id)) : '') }] : []),
  ], s.membresias, 'Todavía no compró ninguna membresía.');

  const ingresos = s.asistencias.length
    ? h('ul', { class: 'ingresos' }, s.asistencias.map((a) => h('li', { class: 'num' }, `${fecha(a.fecha)}, ${a.hora}`)))
    : h('p', { class: 'vacio' }, 'Sin ingresos registrados.');

  const dlg = abrirDialogo('Ficha del socio',
    h('div', { class: 'ficha__cab' },
      h('span', { class: 'avatar', 'data-estado': s.activo ? s.estado_membresia : null, 'aria-hidden': 'true' }, iniciales(s.nombre)),
      h('div', {}, h('h3', {}, s.nombre), insignia(est))),
    h('dl', { class: 'ficha' },
      h('dt', {}, 'Vence'), h('dd', { class: 'num' }, fecha(s.vence)),
      h('dt', {}, 'DNI'), h('dd', { class: 'num' }, s.documento),
      h('dt', {}, 'Celular'), h('dd', { class: 'num' }, s.telefono || '—'),
      h('dt', {}, 'Correo'), h('dd', {}, s.email || '—'),
      h('dt', {}, 'Socio desde'), h('dd', { class: 'num' }, fecha(s.fecha_registro))),
    acciones,
    h('section', { class: 'bloque' }, h('h2', {}, 'Membresías'), historial),
    h('section', { class: 'bloque' }, h('h2', {}, 'Últimos ingresos'), ingresos));
}

function botonAnular(m, despues) {
  return h('button', {
    type: 'button', class: 'btn btn--peligro btn--chico',
    onclick: async () => {
      if (!confirm(`¿Anular la membresía ${m.plan || ''} de ${dinero(m.monto)}? Dejará de contar en los ingresos y el socio perderá ese periodo.`)) return;
      try {
        await api('POST', `/api/membresias/${m.id}/anular`, {});
        aviso('Membresía anulada.');
        despues();
        recargar();
      } catch (err) { if (err.status !== 401) aviso(err.message); }
    },
  }, 'Anular');
}

// ==========================================================================
// MEMBRESÍAS: vender o renovar
// ==========================================================================
const duracionTxt = (d) => (d === 1 ? '1 día' : d === 365 ? '1 año' : d % 30 === 0 ? `${d / 30} ${d / 30 === 1 ? 'mes' : 'meses'}` : `${d} días`);

async function vistaMembresias() {
  const [socios, planes, ventas] = await Promise.all([
    api('GET', '/api/socios'), api('GET', '/api/planes'), api('GET', '/api/membresias'),
  ]);
  const activos = socios.filter((s) => s.activo);
  const preseleccion = estado.preSocio;
  estado.preSocio = null;

  const zona = h('div');
  const selSocio = h('select', { name: 'socio_id' },
    h('option', { value: '' }, 'Elige un socio'),
    activos.map((s) => h('option', { value: String(s.id) }, `${s.nombre} (DNI ${s.documento})`)));
  if (preseleccion) selSocio.value = String(preseleccion);

  const tiles = h('div', { class: 'planes' }, planes.map((p) =>
    h('label', { class: 'plan' },
      h('input', { type: 'radio', name: 'plan_id', value: String(p.id), checked: p.duracion_dias === 30 }),
      h('span', { class: 'plan__caja' },
        h('span', { class: 'plan__nombre' }, p.nombre),
        h('span', { class: 'plan__precio' }, h('small', {}, 'S/'), enteroSoles(p.precio)),
        h('span', { class: 'plan__dura' }, duracionTxt(p.duracion_dias))))));

  const metodos = h('div', { class: 'segmentado' }, Object.entries(METODOS).map(([v, t], i) =>
    h('label', {}, h('input', { type: 'radio', name: 'metodo_pago', value: v, checked: i === 0 }), h('span', {}, t))));

  const resumen = h('div', { class: 'resumen', 'aria-live': 'polite' });
  const form = h('form', {
    class: 'panel venta', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const plan = form.querySelector('input[name=plan_id]:checked');
      const metodo = form.querySelector('input[name=metodo_pago]:checked');
      const r = await enviar(form, zona, () => api('POST', '/api/membresias', {
        socio_id: selSocio.value, plan_id: plan ? plan.value : '', metodo_pago: metodo ? metodo.value : '',
      }));
      if (r) { aviso(`Pago registrado. Vigencia del ${fecha(r.fecha_inicio)} al ${fecha(r.fecha_fin)}.`); recargar(); }
    },
  },
  zona,
  campo('Socio', selSocio),
  h('fieldset', { class: 'campo' }, h('legend', {}, 'Plan'), tiles),
  h('fieldset', { class: 'campo' }, h('legend', {}, 'Método de pago'), metodos),
  resumen,
  h('button', { type: 'submit', class: 'btn btn--primario', style: null }, 'Registrar pago'));

  function actualizarResumen() {
    const s = activos.find((x) => String(x.id) === selSocio.value);
    const sel = form.querySelector('input[name=plan_id]:checked');
    const p = sel && planes.find((x) => String(x.id) === sel.value);
    if (!s || !p) {
      resumen.replaceChildren(h('span', {}, 'Elige socio y plan para ver el total y la vigencia.'));
      return;
    }
    const renueva = s.vence && s.vence >= estado.hoy;
    const inicio = renueva ? sumarDias(s.vence, 1) : estado.hoy;
    const fin = sumarDias(inicio, p.duracion_dias - 1);
    resumen.replaceChildren(
      h('div', {}, h('span', {}, renueva ? 'Renovación sin cortes' : 'Vigencia'), h('p', {}, `Del ${fecha(inicio)} al ${fecha(fin)}`)),
      h('strong', {}, dinero(p.precio)));
  }
  form.addEventListener('change', actualizarResumen);
  actualizarResumen();

  const lista = tabla([
    { t: 'Socio', principal: true, v: (m) => persona(m.socio, `Pagó el ${fecha(m.fecha_pago)}`, null, () => detalleSocio(m.socio_id)) },
    { t: 'Plan', v: (m) => m.plan },
    { t: 'Vigencia', v: (m) => `${fecha(m.fecha_inicio)} al ${fecha(m.fecha_fin)}`, clase: 'num' },
    { t: 'Monto', v: (m) => dinero(m.monto), clase: 'num' },
    { t: 'Método', v: (m) => METODOS[m.metodo_pago] },
    { t: 'Estado', v: (m) => insignia(m.estado) },
    ...(esAdmin() ? [{ t: '', v: (m) => (m.estado === 'activa' ? botonAnular(m, () => {}) : '') }] : []),
  ], ventas, 'Aún no se vendió ninguna membresía.');

  return h('div', {},
    h('div', { class: 'cabecera' }, h('div', {}, h('h1', {}, 'Membresías'), h('p', {}, 'Vende un plan nuevo o renueva el de un socio.'))),
    form,
    h('section', { class: 'bloque' }, h('h2', {}, 'Últimas ventas'), h('div', { class: 'panel' }, lista)));
}

// ==========================================================================
// PLANES (administrador)
// ==========================================================================
async function vistaPlanes() {
  const planes = await api('GET', '/api/planes?todos=1');
  const tarjeta = (p) => h('article', { class: `plan ${p.activo ? '' : 'plan--inactivo'}` },
    h('div', { class: 'plan__caja' },
      h('span', { class: 'plan__nombre' }, p.nombre),
      h('span', { class: 'plan__precio' }, h('small', {}, 'S/'), enteroSoles(p.precio)),
      h('span', { class: 'plan__dura' }, `${duracionTxt(p.duracion_dias)}, ${p.duracion_dias} ${p.duracion_dias === 1 ? 'día' : 'días'}`),
      h('div', {}, insignia(p.activo ? 'activa' : 'inactiva')),
      h('div', { class: 'acciones' },
        h('button', { type: 'button', class: 'btn btn--chico', onclick: () => formPlan(p) }, 'Editar'),
        h('button', {
          type: 'button', class: p.activo ? 'btn btn--peligro btn--chico' : 'btn btn--chico',
          onclick: async () => {
            try {
              await api('PUT', `/api/planes/${p.id}`, { nombre: p.nombre, duracion_dias: p.duracion_dias, precio: p.precio, activo: !p.activo });
              aviso(p.activo ? 'Plan desactivado. Ya no aparece en la venta.' : 'Plan activado.');
              recargar();
            } catch (err) { if (err.status !== 401) aviso(err.message); }
          },
        }, p.activo ? 'Desactivar' : 'Activar'))));
  return h('div', {},
    h('div', { class: 'cabecera' },
      h('div', {}, h('h1', {}, 'Planes'), h('p', {}, 'Precios y duración de las membresías que se venden.')),
      h('button', { type: 'button', class: 'btn btn--primario', onclick: () => formPlan(null) }, 'Nuevo plan')),
    planes.length ? h('div', { class: 'catalogo' }, planes.map(tarjeta)) : h('p', { class: 'vacio' }, 'No hay planes. Crea el primero.'));
}

function formPlan(plan) {
  const zona = h('div');
  const nombre = h('input', { name: 'nombre', maxlength: '40', value: plan ? plan.nombre : '' });
  const duracion = h('input', { name: 'duracion_dias', inputmode: 'numeric', value: plan ? String(plan.duracion_dias) : '' });
  const precio = h('input', { name: 'precio', inputmode: 'decimal', value: plan ? String(plan.precio) : '' });
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const datos = { nombre: nombre.value, duracion_dias: duracion.value, precio: precio.value.replace(',', '.') };
      const r = await enviar(form, zona, () => (plan ? api('PUT', `/api/planes/${plan.id}`, datos) : api('POST', '/api/planes', datos)));
      if (r) { dlg.close(); aviso(plan ? 'Plan guardado.' : `Plan creado: ${r.nombre}`); recargar(); }
    },
  },
  zona,
  campo('Nombre', nombre),
  campo('Duración en días', duracion, 'Entre 1 y 730'),
  campo('Precio en soles', precio),
  h('div', { class: 'acciones' },
    h('button', { type: 'submit', class: 'btn btn--primario' }, plan ? 'Guardar cambios' : 'Crear plan'),
    h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar')));
  const dlg = abrirDialogo(plan ? 'Editar plan' : 'Nuevo plan', form);
  nombre.focus();
}

// ==========================================================================
// REPORTES (administrador)
// ==========================================================================
// Barras de una sola serie: un tono, la barra máxima resaltada y nombrada en texto,
// tooltip por barra (hover y foco) y una tabla accesible con los mismos datos.
function graficoBarras({ titulo, datos, cada, nota }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const pico = datos.reduce((a, d) => (d.valor > a.valor ? d : a), datos[0] || { valor: 0 });
  const area = h('div', { class: 'grafico__area', role: 'img', 'aria-label': `${titulo}. ${nota(pico)}` },
    h('div', { class: 'grafico__guia', style: null }, h('span', {}, String(max))),
    datos.map((d) => {
      const pct = (d.valor / max) * 100;
      const b = h('button', {
        type: 'button', class: `barra ${d === pico && d.valor > 0 ? 'barra--pico' : ''}`, 'data-tip': d.tip, 'aria-label': d.tip, tabindex: '-1',
      }, h('i', {}));
      b.style.setProperty('--alto', `${pct}%`);
      b.firstChild.style.height = `${pct}%`;
      return b;
    }));
  area.firstChild.style.top = '0';
  const ejes = h('div', { class: 'grafico__ejes', 'aria-hidden': 'true' }, datos.map((d, i) => h('span', {}, i % cada === 0 ? d.etq : '')));
  const tablaOculta = h('table', { class: 'oculto' },
    h('caption', {}, titulo),
    h('tbody', {}, datos.map((d) => h('tr', {}, h('th', { scope: 'row' }, d.etq), h('td', {}, String(d.valor))))));
  return h('section', { class: 'panel grafico' },
    h('div', { class: 'bloque__cab' }, h('h2', {}, titulo)),
    area, ejes,
    pico.valor > 0 ? h('p', { class: 'grafico__nota' }, nota(pico)) : h('p', { class: 'grafico__nota' }, 'Sin ingresos en este periodo.'),
    tablaOculta);
}

async function vistaReportes() {
  const desde = h('input', { type: 'date', name: 'desde', value: sumarDias(estado.hoy, -20) });
  const hasta = h('input', { type: 'date', name: 'hasta', value: estado.hoy });
  const zona = h('div');
  const cont = h('div');

  async function cargar() {
    const r = await api('GET', `/api/reportes/resumen?desde=${encodeURIComponent(desde.value)}&hasta=${encodeURIComponent(hasta.value)}`);
    const kpi = (t, v, marca) => h('div', { class: `kpi ${marca ? 'kpi--marca' : ''}` }, h('dt', {}, t), h('dd', {}, v));

    const porDia = new Map(r.porDia.map((x) => [x.fecha, x.n]));
    const dias = [];
    for (let f = r.desde; f <= r.hasta && dias.length < 120; f = sumarDias(f, 1)) {
      dias.push({ etq: f.slice(8, 10), valor: porDia.get(f) || 0, tip: `${fecha(f)}: ${porDia.get(f) || 0} ingresos` });
    }
    const porHora = new Map(r.porHora.map((x) => [x.hora, x.n]));
    const horas = [];
    for (let hh = 5; hh <= 22; hh++) {
      const k = String(hh).padStart(2, '0');
      horas.push({ etq: `${hh}h`, valor: porHora.get(k) || 0, tip: `${k}:00 a ${k}:59: ${porHora.get(k) || 0} ingresos` });
    }

    cont.replaceChildren(
      h('dl', { class: 'kpis' },
        kpi('Ingresos por ventas', dinero(r.ingresos), true),
        kpi('Membresías vendidas', r.ventas),
        kpi('Entradas al gym', r.asistencias),
        kpi('Socios vigentes hoy', r.socios_vigentes)),
      h('div', { class: 'dos bloque' },
        graficoBarras({
          titulo: 'Asistencia por día', datos: dias, cada: Math.ceil(dias.length / 8),
          nota: (p) => `El día con más asistencia fue el ${p.tip.split(':')[0]}, con ${p.valor} ingresos.`,
        }),
        graficoBarras({
          titulo: 'Horas pico', datos: horas, cada: 3,
          nota: (p) => {
            const hora = parseInt(p.etq, 10);
            return `La hora más llena es de ${hora}:00 a ${hora + 1}:00, con ${p.valor} ingresos en el periodo.`;
          },
        })),
      h('div', { class: 'dos' },
        h('section', { class: 'bloque' }, h('h2', {}, 'Ventas por plan'), h('div', { class: 'panel' }, tabla([
          { t: 'Plan', v: (x) => x.plan, principal: true },
          { t: 'Ventas', v: (x) => x.ventas, clase: 'num' },
          { t: 'Ingresos', v: (x) => dinero(x.ingresos), clase: 'num' },
        ], r.porPlan, 'Sin ventas en el periodo.'))),
        h('section', { class: 'bloque' }, h('h2', {}, 'Ventas por método de pago'), h('div', { class: 'panel' }, tabla([
          { t: 'Método', v: (x) => METODOS[x.metodo] || x.metodo, principal: true },
          { t: 'Ventas', v: (x) => x.ventas, clase: 'num' },
          { t: 'Ingresos', v: (x) => dinero(x.ingresos), clase: 'num' },
        ], r.porMetodo, 'Sin ventas en el periodo.')))),
      h('section', { class: 'bloque' },
        h('div', { class: 'bloque__cab' }, h('h2', {}, 'Por vencer en 7 días'), h('span', {}, 'Llámalos para renovar')),
        h('div', { class: 'panel' }, tabla([
          { t: 'Socio', principal: true, v: (x) => persona(x.nombre, `DNI ${x.documento}`, 'por_vencer', () => detalleSocio(x.id)) },
          { t: 'Celular', v: (x) => x.telefono || '—', clase: 'num' },
          { t: 'Vence', v: (x) => fecha(x.vence), clase: 'num' },
        ], r.por_vencer, 'Ninguna membresía vence en los próximos 7 días.'))));
  }

  const form = h('form', {
    class: 'filtros', novalidate: true,
    onsubmit: async (e) => { e.preventDefault(); await enviar(form, zona, cargar); },
  }, campo('Desde', desde), campo('Hasta', hasta), h('button', { type: 'submit', class: 'btn' }, 'Ver reporte'));

  await cargar();
  return h('div', {},
    h('div', { class: 'cabecera' }, h('div', {}, h('h1', {}, 'Reportes'), h('p', {}, 'Ventas, asistencia y renovaciones pendientes.'))),
    form, zona, cont);
}

// ---------- arranque ----------
iniciarApp();
