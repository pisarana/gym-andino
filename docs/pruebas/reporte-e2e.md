# Reporte de ejecución de pruebas E2E

- **Sistema:** Gym Andino
- **Ambiente:** https://gym-andino.onrender.com
- **Inicio:** 12/11/2026, 12:02:30 a. m. (hora de Lima)
- **Fin:** 12/11/2026, 12:02:36 a. m.
- **Resultado:** 33 de 33 casos aprobados (100 %)
- **DNI de prueba usado:** 99878354

Generado automáticamente con `node scripts/e2e.mjs`.

| ID | Módulo | Caso | Resultado esperado | Resultado obtenido | ms | Estado |
|---|---|---|---|---|---|---|
| E2E-01 | General | Comprobación de salud del servicio | 200 y {"estado":"ok"} | 200 {"estado":"ok"} | 112 | ✅ Aprobado |
| E2E-02 | General | Página principal y cabeceras de seguridad | 200 con CSP, nosniff y X-Frame-Options DENY | 200; CSP=sí; nosniff=nosniff; frame=DENY | 117 | ✅ Aprobado |
| E2E-03 | Seguridad | Salida de directorio en archivos estáticos | Rechazado (400/403/404) sin mostrar el código del servidor | 400, bloqueado por firewall Cloudflare | 13 | ✅ Aprobado |
| E2E-04 | General | Ruta inexistente de la API | 404 con mensaje | 404 Ruta no encontrada | 138 | ✅ Aprobado |
| E2E-05 | M1 Autenticación | Login con campos vacíos | 400 "Ingrese usuario y contraseña" | 400 Ingrese usuario y contraseña | 146 | ✅ Aprobado |
| E2E-06 | M1 Autenticación | Login con contraseña incorrecta | 401 con mensaje genérico | 401 Usuario o contraseña incorrectos | 249 | ✅ Aprobado |
| E2E-07 | M1 Autenticación | Login correcto de recepción | 200 y cookie HttpOnly, Secure y SameSite=Strict | 200; rol=recepcion; cookie=sid=***; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800; Secure | 299 | ✅ Aprobado |
| E2E-08 | M1 Autenticación | Usuario actual con sesión | 200 con rol recepcion | 200 rol=recepcion | 225 | ✅ Aprobado |
| E2E-09 | M1 Autenticación | API protegida sin sesión | 401 | 401 | 226 | ✅ Aprobado |
| E2E-10 | M1 Autenticación | Bloqueo tras 5 intentos fallidos | El 6.º intento devuelve 429 | 429 Cuenta bloqueada temporalmente por intentos fallidos. Intente en 1 minuto. | 116 | ✅ Aprobado |
| E2E-11 | M1 Autenticación | Recepción no puede ver reportes | 403 | 403 | 118 | ✅ Aprobado |
| E2E-12 | M1 Autenticación | Recepción no puede crear planes | 403 | 403 | 116 | ✅ Aprobado |
| E2E-13 | M1 Autenticación | Recepción no puede desactivar socios | 403 | 403 | 119 | ✅ Aprobado |
| E2E-14 | M2 Socios | Registro con datos inválidos | 400 con 4 mensajes de validación | 400: El nombre debe tener entre 3 y 80 caracteres; El DNI debe tener 8 dígitos; El teléfono debe tener 9 dígitos y empezar con 9; El correo no tiene un formato válido | 115 | ✅ Aprobado |
| E2E-15 | M2 Socios | Registro de socio válido | 201 con estado sin_membresia | 201 id=14 estado=sin_membresia | 158 | ✅ Aprobado |
| E2E-16 | M2 Socios | DNI duplicado | 409 | 409 Ya existe un socio con ese DNI | 117 | ✅ Aprobado |
| E2E-17 | M2 Socios | Búsqueda por DNI | Devuelve exactamente el socio registrado | 200 resultados=1 | 123 | ✅ Aprobado |
| E2E-18 | Seguridad | Búsqueda con inyección SQL | Sin datos indebidos: 0 resultados o rechazo del firewall | 403, bloqueado por firewall Cloudflare | 26 | ✅ Aprobado |
| E2E-19 | M5 Ingreso | Ingreso de socio sin membresía | 409 acceso denegado | 409 Membresía vencida o inexistente. Debe renovar para ingresar. | 115 | ✅ Aprobado |
| E2E-20 | M4 Membresías | Venta con método de pago inválido | 400 | 400 Seleccione un método de pago válido | 123 | ✅ Aprobado |
| E2E-21 | M4 Membresías | Venta de plan mensual | 201 con vigencia de 30 días desde hoy | 201 2026-11-12 al 2026-12-11 (30 días) | 127 | ✅ Aprobado |
| E2E-22 | M4 Membresías | Renovación encadenada | La nueva empieza el día siguiente al vencimiento | 201 inicia 2026-12-12 (esperado 2026-12-12) | 132 | ✅ Aprobado |
| E2E-23 | M5 Ingreso | Ingreso con membresía vigente | 201 con días restantes | 201 plan=Mensual días=59 | 135 | ✅ Aprobado |
| E2E-24 | M5 Ingreso | Segundo ingreso el mismo día | 409 ya registró | 409 El socio ya registró su asistencia hoy | 120 | ✅ Aprobado |
| E2E-25 | M5 Ingreso | DNI no registrado | 404 | 404 No existe un socio con ese DNI | 117 | ✅ Aprobado |
| E2E-26 | M5 Ingreso | DNI con formato inválido | 400 | 400 El DNI debe tener 8 dígitos | 116 | ✅ Aprobado |
| E2E-27 | M5 Ingreso | Ingreso con membresía vencida (socia de ejemplo) | 409 | 409 Membresía vencida o inexistente. Debe renovar para ingresar. | 208 | ✅ Aprobado |
| E2E-28 | M6 Reportes | Reporte del administrador | 200 con ingresos, asistencia por día y horas pico | 200 ingresos=S/ 1050 ventas=10 entradas=86 | 118 | ✅ Aprobado |
| E2E-29 | M6 Reportes | Rango de fechas inválido | 400 | 400 La fecha "desde" no puede ser mayor que "hasta" | 119 | ✅ Aprobado |
| E2E-30 | M3 Planes | Plan con precio y duración inválidos | 400 | 400: La duración debe ser un número entero de 1 a 730 días; El precio debe ser mayor que 0 y menor o igual a 10000 | 118 | ✅ Aprobado |
| E2E-31 | M4 Membresías | Anulación por administrador | 200 y una segunda anulación devuelve 409 | recepción=403, admin=200, repetida=409 | 123 | ✅ Aprobado |
| E2E-32 | M1 Autenticación | Cierre de sesión invalida la cookie | 200 y luego 401 | logout=200, me=401 | 228 | ✅ Aprobado |
| E2E-33 | Rendimiento | Tiempo de respuesta con el servicio despierto | Promedio menor a 1500 ms | promedio 139 ms, máximo 299 ms (arranque en frío: 228 ms) | 139 | ✅ Aprobado |
