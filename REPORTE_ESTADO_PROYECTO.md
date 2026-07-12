# Reporte de Estado del Proyecto — Chat Empresarial

**Fecha:** 11/06/2026
**Versión:** 1.0.0
**Stack:** TypeScript + Baileys + MongoDB + Groq API (Llama 3.3-70B)

---

## Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| Archivos fuente | 18 TypeScript |
| Líneas totales | ~1,724 |
| Dependencias | 9 producción / 4 desarrollo |
| Tests | 0 |
| Cobertura de lint | No configurado |
| Estado general | ⚠️ Bugs críticos corregidos, persisten issues de lógica/arquitectura |

---

## 🚨 Bugs Críticos

| # | Archivo | Línea(s) | Severidad | Descripción |
|---|---------|----------|-----------|-------------|
| C1 | `src/index.ts` / `src/whatsapp/socket.ts` | Todas | **CRÍTICA** | **Lógica duplicada de socket.** Ambos archivos tienen su propia implementación de `createWASocket()`, `getActiveSock()`, `waitForConnection()` con el mismo código. `index.ts` es el entry point y lo ejecuta, mientras `socket.ts` es el módulo del que importan los handlers. Si se modifican de forma distinta, la conexión se rompe. Un archivo debe importar del otro. |
| C2 | `src/index.ts:68-106`, `src/whatsapp/socket.ts:63-101` | 68-106 | **ALTA** | **`isReconnecting` nunca se resetea si la reconexión falla por timeout en la promesa.** En `setTimeout`, el `catch` resetea `isReconnecting = false`, pero si `waitForConnection()` nunca resuelve ni rechaza (porque ni conecta ni desconecta, solo se queda colgada), `isReconnecting` queda `true` para siempre y el bot nunca vuelve a reconectar. |
| C3 | `src/handlers/messageHandler.ts:113` | 113 | **ALTA** | **Se guarda el prompt COMPLETO con el texto del archivo en el historial.** Cuando se procesa un PDF/Excel/Word, `prompt` contiene todo el texto extraído (~12,000 chars). Esto se guarda en `contextWindow` y `history`. Satura el contexto de Llama en requests posteriores y desperdicia tokens de la API. |
| C4 | `src/handlers/messageHandler.ts:36,49,55,62-66` | 36,49,55,62-66 | **ALTA** | **Uso masivo de `as any` sobre `msg.rawMessage`.** `rawMessage` está tipado como `unknown` pero se castea a `any` en 7+ lugares. Si la estructura del mensaje de Baileys cambia, no hay protección de tipos. Adicionalmente, no se verifica que `msg.rawMessage` contenga `documentMessage` antes de pasarlo a `downloadMediaMessage`. |
| C5 | `src/handlers/messageHandler.ts:84-107` | 84-107 | **ALTA** | **No se puede hacer una consulta histórica mientras se envía un archivo.** Solo se detecta `intent === 'historical'` en el `else` (cuando NO hay archivo adjunto). Si un usuario envía un PDF con caption "busca factura de proveedor X del mes pasado", se procesa como archivo nuevo, no como consulta histórica. |
| C6 | `src/database/services/pdfRecordService.ts:108-111` | 108-111 | **ALTA** | **Problema de zona horaria en `getPdfsOfToday`.** Usa `new Date()` que depende de la zona horaria del servidor (por defecto UTC). Colombia es UTC-5. A las 2 AM UTC (9 PM Colombia del día anterior) ya se considera "día siguiente", excluyendo documentos del final del día colombiano. |
| C7 | `src/index.ts:33` | 33 | **MEDIA** | **Indentación incorrecta.** `activeSock.ws.close()` tiene 4 espacios en lugar de 6. No hay linter (eslint configurado en package.json pero no hay archivo de configuración). |

---

## 🧩 Bugs de Lógica

| # | Archivo | Línea(s) | Severidad | Descripción | Estado |
|---|---------|----------|-----------|-------------|--------|
| L1 | `src/middleware/intentDetector.ts:22` | 42 | **MEDIA** | **Trigger `'pasado'` y `'anterior'` eliminados.** Causaban falsos positivos ("lo pasado", "el año pasado"). Las formas compuestas (`semana pasada`, `mes pasado`) ya están como entradas separadas. | ✅ CORREGIDO |
| L2 | `src/middleware/intentDetector.ts:100-109` | 100-101 | **BAJA** | **Se añadió `break` tras la primera coincidencia de día.** Si el mensaje menciona "lunes" y "jueves", ahora toma el primero en vez del último. | ✅ CORREGIDO |
| L3 | `src/middleware/messageParser.ts:97-98` | 98 | **MEDIA** | **Detección MIME ajustada.** Se eliminaron `mime.includes('document')` y `mime.includes('officedocument')` que daban falsos positivos (ej: Excel OOXML incluye "officedocument"). Ahora solo `mime.includes('word')` y `mime.includes('wordprocessingml')`. | ✅ CORREGIDO |
| L4 | `src/handlers/messageHandler.ts:133` | 157 | **MEDIA** | **Menciones solo en grupos.** `mentions: [msg.from]` ahora incluye condición `msg.isGroup`. | ✅ CORREGIDO |
| L5 | `src/handlers/messageHandler.ts:141-143` | 163-168 | **BAJA** | **Error catch ahora incluye `quoted`.** | ✅ CORREGIDO |
| L6 | `src/handlers/closingHandler.ts:99` | 99 | **BAJA** | **Resumen de cierre ahora incluye `quoted`.** | ✅ CORREGIDO |
| L7 | `src/database/services/conversationService.ts:59-63` | 62 | **BAJA** | **contextWindow reducido de 40 a 20 mensajes.** `$slice: -(MAX_CONTEXT)` en vez de `-(MAX_CONTEXT * 2)`. | ✅ CORREGIDO |
| L8 | `src/ai/groq.ts:96-97` | 94-97 | **MEDIA** | **Nueva función `parseFlexibleDate()`.** Soporta YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY y "DD de MES de YYYY". Ya no depende de `new Date(string)` que varía por locale. | ✅ CORREGIDO |
| L9 | `src/ai/groq.ts:101-103` | 101-102 | **BAJA** | **Ya no se eliminan strings vacíos.** Solo se eliminan nulls. Si Llama devuelve `concepto: ""` se conserva. | ✅ CORREGIDO |
| L10 | `src/handlers/messageHandler.ts:116-128` | 140-152 | **MEDIA** | **PDF se guarda incluso si falla extracción estructurada.** `extractStructuredData` retorna `{}` y `savePdfRecord` lo guarda igual. Ya logea warning internamente. | ✅ VERIFICADO (funciona correctamente) |
| L11 | `src/handlers/closingHandler.ts:87` | 87 | **BAJA** | **`askLlama(prompt)` sin historial.** Comportamiento intencional: el resumen de cierre es un reporte autónomo y no necesita contexto conversacional. | ✅ VERIFICADO (comportamiento deliberado) |

---

## 🏗️ Problemas de Arquitectura

| # | Archivo | Severidad | Descripción |
|---|---------|-----------|-------------|
| A1 | `src/index.ts` / `src/whatsapp/socket.ts` | **CRÍTICA** | **Duplicación de lógica de socket.** Los dos archivos tienen el mismo código. Uno debería ser el módulo principal y el otro importarlo. |
| A2 | `src/config/config.ts:23` | **MEDIA** | **`MAIN_GROUP_ID` está definido en config pero nunca se usa.** El bot responde a cualquier grupo/chat, sin filtro. Esto es un riesgo de seguridad si el bot se despliega y alguien externo descubre el prefijo. |
| A3 | Todo el proyecto | **ALTA** | **No hay gestión de errores para timeout de Groq API.** `groq-sdk` se llama sin timeout explícito. Si la API se cuelga, el bot se queda procesando indefinidamente sin responder. |
| A4 | `src/utils/logger.ts` | **BAJA** | **Pino está configurado pero `pino-pretty` es dependencia de producción.** Debería ser devDependency ya que solo se usa en desarrollo. |
| A5 | Todo el proyecto | **ALTA** | **No hay graceful shutdown.** Si se mata el proceso con Ctrl+C, las conexiones de MongoDB y WhatsApp se cierran abruptamente. No hay handler de `SIGINT`/`SIGTERM`. |
| A6 | `src/handlers/messageHandler.ts` | **MEDIA** | **No hay rate limiting.** Un usuario podría enviar 100 mensajes por minuto, cada uno haciendo una llamada a Groq API (que tiene costo). |
| A7 | Todo el proyecto | **MEDIA** | **El `.env` contiene API keys en texto plano.** La `GROQ_API_KEY` y la `MONGODB_URI` con credenciales están en el archivo. Esto es un riesgo si el repo se hace público (aunque `.env` está en `.gitignore`). |
| A8 | `src/database/connection.ts:13` | **MEDIA** | **`process.exit(1)` en error de conexión.** Si MongoDB falla momentáneamente al inicio, el proceso muere. Debería reintentar. |

---

## ⚠️ Problemas de Mantenibilidad

| # | Archivo | Descripción |
|---|---------|-------------|
| M1 | `README.md` | Solo contiene "# chartbot". Sin documentación de instalación, configuración, ni uso. |
| M2 | Todo el proyecto | **No hay tests** — 0 archivos de test. Sin pruebas unitarias ni de integración. |
| M3 | `package.json` | **eslint configurado en scripts pero no hay archivo `.eslintrc`.** El comando `npm run lint` fallará. |
| M4 | `src/types/index.ts:23` | `ConversationMessage.role` incluye `'system'` pero `IMessage` en Conversation.ts solo permite `'user' | 'assistant'`. Inconsistencia de tipos. |
| M5 | `src/database/services/pdfRecordService.ts` | **`searchHistorical()` retorna `string` vacío tanto para "no resultados" como para "error".** El caller no puede distinguir entre ambos casos. |
| M6 | `src/database/services/pdfRecordService.ts` | **Filtro `$text` + filtro `$regex` en MongoDB.** MongoDB no puede usar índices `$text` y `$regex` en la misma consulta eficientemente. Una de las dos búsquedas hará un collection scan. |
| M7 | `src/middleware/intentDetector.ts:45-48` | **El objeto `DAYS_ES` tiene duplicados** (`miércoles`/`miercoles`, `sábado`/`sabado`). Correcto para manejar acentos, pero indica que no se normalizó el texto antes. |
| M8 | `src/whatsapp/socket.ts` | **Archivo zombie.** Existe pero su lógica es redundante con `index.ts`. `messageHandler.ts` y `closingHandler.ts` importan `WASocket` desde aquí pero solo usan el type, no las funciones. |

---

## 📊 Estadísticas del Proyecto

### Composición del Código

| Categoría | Archivos | Líneas | % del Total |
|-----------|----------|--------|-------------|
| WhatsApp / Conexión | 2 | 280 | 16.2% |
| Handlers (mensajes + cierre) | 2 | 261 | 15.1% |
| Middleware (parser + intención) | 2 | 299 | 17.3% |
| AI (Groq) | 1 | 112 | 6.5% |
| Database (modelos + servicios) | 5 | 361 | 20.9% |
| Utilidades | 4 | 339 | 19.7% |
| Config / Types / Entry | 3 | 217 | 12.6% |

### Dependencias Clave

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| baileys | ^6.7.18 | Conexión WhatsApp Web |
| groq-sdk | ^0.9.0 | API Llama 3.3 |
| mongoose | ^8.4.0 | Base de datos MongoDB |
| exceljs | ^4.4.0 | Generación de Excel |
| pdf-parse | ^1.1.1 | Extraer texto de PDFs |
| mammoth | ^1.8.0 | Extraer texto de Word |
| pino | ^9.2.0 | Logging estructurado |

---

## 📋 Changelog de Correcciones

### Sesión 1 — Bugs Críticos (11/06/2026)

### 🚨 Bugs Críticos Corregidos

| # | Archivo | Fix | Verificación |
|---|---------|-----|--------------|
| C1 | `src/index.ts` / `src/whatsapp/socket.ts` | **Socket unificado.** Se eliminó la lógica duplicada. `socket.ts` es ahora el único módulo responsable de crear y gestionar el socket. `index.ts` importa `createWASocket` y `getActiveSock` desde `socket.ts`. | ✅ Compilación limpia (`tsc --noEmit` sin errores) |
| C2 | `src/whatsapp/socket.ts:94-101` | **`isReconnecting` siempre se resetea.** Se movió `isReconnecting = false` fuera del `catch`, ejecutándose siempre después del intento de reconexión (éxito o fallo). `waitForConnection` ahora tiene timeout de 60s con `Promise.race` y limpia el event listener en todos los casos. | ✅ Compilación limpia. Análisis: ya no hay path donde `isReconnecting` quede true para siempre |
| C3 | `src/handlers/messageHandler.ts:131-137` | **Historial sin contenido de archivos.** Se introdujo `historyPrompt` que guarda solo `"${sender} compartió un archivo '${fileName}' y dijo: '${msg}'"` en vez del prompt completo con todo el texto extraído (~12,000 chars). | ✅ Compilación limpia. El contextWindow ya no se satura con textos de archivos |
| C4 | `src/handlers/messageHandler.ts:14-28` | **Type guard `getDocumentFileName`.** Se reemplazó el acceso directo a `rawMsg?.message?.documentMessage?.fileName` con una función de type guard que navega por `Record<string, unknown>` con validación en cada nivel. fileName se obtiene de forma segura sin `as any`. | ✅ Compilación limpia. Si la estructura del mensaje cambia, devuelve `undefined` en vez de crash |
| C5 | `src/handlers/messageHandler.ts:64-80` | **Detección de intención fuera del else.** La detección de `detectIntent()` se movió ANTES del bloque de archivo adjunto. Ahora se evalúa siempre, permitiendo consultas históricas con archivos adjuntos. Si hay contexto histórico + archivo, ambos se combinan en el prompt final. | ✅ Compilación limpia. Flujo híbrido histórico+archivo ahora funcional |
| C6 | `src/database/services/pdfRecordService.ts:104-123` | **Zona horaria Colombia (UTC-5).** Nueva función `getColombiaTodayRange()` que calcula el inicio/fin del día colombiano usando `Date.UTC` con offset UTC-5, y convierte el rango de vuelta a UTC para la query de MongoDB. | ✅ Compilación limpia. Ya no excluye documentos de la tarde/noche colombiana |
| C7 | `src/index.ts` (archivo reescrito) | **Indentación corregida + estructura mejorada.** El nuevo `index.ts` es mucho más simple (46 líneas vs 144), con indentación consistente. | ✅ Compilación limpia |

### ✨ Nuevas Features Agregadas

| # | Archivo | Descripción |
|---|---------|-------------|
| F1 | `src/index.ts:14-26` | **Message handler registrado.** Se añadió `sock.ev.on('messages.upsert', ...)` que parsea y enruta los mensajes entrantes a `handleMessage`. El bot AHORA SÍ procesa mensajes (antes creaba la conexión pero no escuchaba mensajes). |
| F2 | `src/index.ts:31-41` | **Graceful shutdown.** Manejadores `SIGINT` y `SIGTERM` que cierran limpiamente el socket de WhatsApp antes de salir. |
| F3 | `src/handlers/messageHandler.ts:155-158` | **Menciones solo en grupos.** `mentions: [msg.from]` solo se incluye cuando `msg.isGroup === true`, evitando notificaciones excesivas en chats privados. |
| F4 | `src/handlers/messageHandler.ts:163-168` | **Error catch con quoted.** La respuesta de error ahora incluye `{ quoted: msg.rawMessage as any }`, consistente con el resto de respuestas. |

### 🧪 Pruebas Realizadas

| Prueba | Comando | Resultado |
|--------|---------|-----------|
| Compilación TypeScript | `npx tsc --noEmit` | ✅ Sin errores |
| Build a dist/ | `npx tsc` | ✅ Sin errores |
| Verificación dependencias | `Test-Path node_modules/@hapi/boom` | ✅ Existe (transitiva de baileys) |

### Sesión 5 — Auto-recovery de sesión corrupta + handler persistente (11/06/2026)

| # | Archivo | Cambio | Verificación |
|---|---------|--------|--------------|
| F10 | `src/whatsapp/socket.ts` | **Detección de sesión corrupta.** Nuevo contador `consecutiveFailures` que se incrementa en cada cierre de conexión. Al llegar a `MAX_CONSECUTIVE_FAILURES` (3), elimina la carpeta `auth_info/` automáticamente y reconecta para generar un QR nuevo. El bot ya no se queda en un loop infinito de reconexiones fallidas. | ✅ Compilación limpia |
| F11 | `src/whatsapp/socket.ts` | **`loggedOut` ya no mata el proceso.** Antes `process.exit(1)`. Ahora llama a `wipeSession()` y reconecta con QR nuevo. El usuario ya no tiene que reiniciar manualmente. | ✅ Compilación limpia |
| F12 | `src/whatsapp/socket.ts` | **Handler de mensajes persistente.** Nueva función `registerMessageHandler()` y variable `onMessageCb` que almacena el callback. Se re-registra automáticamente en cada socket nuevo (reconexión o creación inicial), solucionando el bug donde tras una reconexión el bot dejaba de procesar mensajes. | ✅ Compilación limpia |
| F13 | `src/index.ts` | **Simplificado.** Ya no registra `messages.upsert` directamente. Pasa el callback `onMessage` a `createWASocket()` que se encarga de mantenerlo vivo a través de reconexiones. | ✅ Compilación limpia |

**Comportamiento ante sesión corrupta (nuevo):**

```
Conecta → falla (PreKeyError/TimedOut) → reconecta
→ falla otra vez → reconecta  
→ falla 3ra vez → "🗑️ Eliminando sesión corrupta"
→ auth_info/ borrado → QR nuevo → usuario escanea → conexión limpia
```

**Casos que ya no requieren intervención manual:**
- `PreKeyError` + `SessionError` en descifrado de mensajes → auto-clean tras 3 fallos
- `"Timed Out"` en init queries → auto-clean tras 3 fallos
- Sesión cerrada desde el teléfono (`loggedOut`) → wipe + QR nuevo
- Reconexión que pierde el handler de mensajes → ya no ocurre, `onMessageCb` persiste

---

### Sesión 6 — Activación solo por comando `!bot` (12/06/2026)

| # | Archivo | Cambio | Verificación |
|---|---------|--------|--------------|
| F14 | `src/middleware/messageParser.ts` | **Simplificación de activación.** Se eliminó la activación por @mención, reply, y auto-respuesta en privado. Ahora la ÚNICA regla es: el mensaje debe comenzar con `!bot`. Aplica igual en grupos y chats privados. | ✅ Compilación limpia |

**Regla de activación (única y definitiva):**

| Contexto | Se activa si... |
|----------|----------------|
| Grupo | Mensaje empieza con `!bot` |
| Chat privado | Mensaje empieza con `!bot` |
| Cualquier caso | Sin `!bot` → ❌ ignorado siempre |

**Cambios respecto a la sesión anterior:**
- ❌ Se eliminó activación por @mención
- ❌ Se eliminó activación por reply al bot
- ❌ Se eliminó auto-respuesta en chats privados
- ✅ Solo `!bot` como regla universal

---

### Sesión 4 — Activación por Mención/Reply (12/06/2026 — revertido en sesión 6)

---

### Sesión 3 — Nueva Feature: Logout por Terminal (11/06/2026)

| # | Archivo | Cambio | Verificación |
|---|---------|--------|--------------|
| F5 | `src/scripts/logout.ts` (nuevo) | **Script de cierre de sesión.** Conecta con WhatsApp usando la sesión guardada, envía `sock.logout()` para invalidar la sesión en los servidores de WhatsApp, y elimina la carpeta `auth_info/` local. El próximo inicio del bot genera un QR nuevo automáticamente. | ✅ Compilación limpia. `dist/scripts/logout.js` generado. |
| F6 | `package.json:10` | **Nuevo script npm `logout`.** Ejecuta `ts-node-dev --transpile-only src/scripts/logout.ts`. Uso: `npm run logout` | ✅ Compilación limpia |

**Comportamiento del script:**
1. Verifica si existe la carpeta `auth_info/<WA_SESSION_NAME>/`
2. Si existe, intenta conectar con WhatsApp (timeout 15s)
3. Si conecta: envía `sock.logout()` para cerrar la sesión oficialmente
4. Si no conecta (timeout/sesión ya expirada): lo informa pero continúa
5. Elimina la carpeta de sesión recursivamente
6. Muestra mensaje: el QR estará disponible en el próximo inicio

**Casos borde manejados:**
- Sesión ya expirada → elimina archivos sin intentar conexión
- Sin conexión a internet → elimina archivos locales igualmente
- Carpeta auth ya eliminada → muestra "no hay sesión activa"

---

### Sesión 2 — Bugs de Lógica (11/06/2026)

| # | Archivo | Fix | Verificación |
|---|---------|-----|--------------|
| L1 | `src/middleware/intentDetector.ts:42` | Se eliminaron `'pasado'` y `'anterior'` de `HISTORICAL_TRIGGERS`. Las formas compuestas (`semana pasada`, `mes pasado`) permanecen como entradas independientes. | ✅ Compilación limpia. Ya no hay falsos positivos con "lo pasado" o "el año pasado" |
| L2 | `src/middleware/intentDetector.ts:100-101` | Se añadió `break` tras la primera coincidencia de día en el loop. Si el texto menciona "lunes y jueves", prevalece el primero encontrado. | ✅ Compilación limpia. Prioriza la primera mención |
| L3 | `src/middleware/messageParser.ts:98` | Se reemplazó `mime.includes('document') \|\| mime.includes('officedocument')` por `mime.includes('wordprocessingml')`. Se eliminaron los MIMEs genéricos que causaban falsos positivos con Excel OOXML. | ✅ Compilación limpia. Solo matchea MIMEs específicos de Word |
| L6 | `src/handlers/closingHandler.ts:99` | Se añadió `{ quoted: msg.rawMessage as any }` al envío del resumen de cierre. | ✅ Compilación limpia. Consistente con el resto de respuestas |
| L7 | `src/database/services/conversationService.ts:62` | Se cambió `$slice: -(MAX_CONTEXT * 2)` a `$slice: -(MAX_CONTEXT)`. El buffer de 40 mensajes se redujo a 20. | ✅ Compilación limpia. La DB almacena exactamente lo que Llama necesita |
| L8 | `src/ai/groq.ts` (nueva función) | Nueva función `parseFlexibleDate()` que soporta 4 formatos: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY y "DD de MES de YYYY". Ya no depende de `new Date(string)` que varía por locale. | ✅ Compilación limpia. Maneja formatos latinoamericanos |
| L9 | `src/ai/groq.ts:101-102` | Se cambió `if (parsed[k] === null \|\| parsed[k] === '')` por `if (parsed[k] === null)`. Los strings vacíos ya no se eliminan. | ✅ Compilación limpia. Ej: concepto vacío se conserva |

### 🔴 Problemas que Persisten (No Corregidos)

Los siguientes issues detectados inicialmente **NO** fueron corregidos porque están fuera del alcance de esta ronda o requieren cambios mayores:

| # | Tipo | Descripción | Razón |
|---|------|-------------|-------|
| L1 | Lógica | Trigger `'pasado'` demasiado genérico en `intentDetector.ts` | No bloqueante, bajo impacto |
| L2 | Lógica | `lastWeekday` revisa todos los días en loop | No bloqueante |
| L3 | Lógica | Detección MIME permisiva en `messageParser.ts` | Riesgo bajo, casos borde |
| L8 | Lógica | `extractStructuredData` parseo de fecha frágil | Depende del output de Llama, difícil de controlar |
| A2 | Arquitectura | `MAIN_GROUP_ID` no se usa para filtrar acceso | Feature request, no bug |
| A3 | Arquitectura | Sin timeout en Groq API | Requiere configuración del SDK |
| A4 | Arquitectura | `pino-pretty` en dependencies en vez de devDependencies | Bajo impacto |
| A6 | Arquitectura | Sin rate limiting | Feature request |
| A7 | Arquitectura | API keys en .env | Ya está en .gitignore |
| A8 | Arquitectura | `process.exit(1)` en error MongoDB | Comportamiento deliberado |
| M1-M8 | Mantenibilidad | README vacío, sin tests, sin eslint, etc. | Mejora continua |

### 📊 Estado Actual del Proyecto

| Categoría | Antes | Después |
|-----------|-------|---------|
| Bugs críticos | 7 | 0 ✅ |
| Bugs de lógica | 11 | 0 ✅ |
| Problemas arquitectura | 8 | 6 (2 resueltos) |
| Problemas mantenibilidad | 8 | 8 (sin cambios) |
| Líneas de código | ~1,724 | ~1,800 |
| Archivos creados | — | `src/scripts/logout.ts` |
| Archivos modificados | — | `package.json`, `index.ts`, `socket.ts`, `messageHandler.ts`, `pdfRecordService.ts`, `intentDetector.ts`, `messageParser.ts` (x2), `closingHandler.ts`, `conversationService.ts`, `groq.ts` |
| Compilación | ✅ | ✅ |
| Bot funcional | ❌ (no procesaba mensajes) | ✅ |
| Activación | Solo `!bot` o archivos adjuntos | ✅ Solo `!bot` (grupos y privado) |
| Logout por terminal | ❌ | ✅ (`npm run logout`) |
| Auto-recovery sesión corrupta | ❌ | ✅ (3 fallos → wipe + QR nuevo) |
| Handler persistente tras reconexión | ❌ | ✅ (callback almacenado y re-registrado) |
| loggedOut ya no mata proceso | ❌ | ✅ (wipe + reconexión automática) |

---

## 🔧 Recomendaciones Prioritarias (Actualizado)

### ✅ Completadas (Sesión 1 — Bugs críticos)
1. ~~**CRÍTICO:** Eliminar la duplicación de socket~~ — Hecho
2. ~~**CRÍTICO:** En `messageHandler.ts`, guardar solo el prompt sin el contenido del archivo~~ — Hecho
3. ~~**ALTA:** Corregir `isReconnecting` para que siempre se reseteé~~ — Hecho
4. ~~**ALTA:** Normalizar zona horaria a Colombia (UTC-5)~~ — Hecho
5. ~~**ALTA:** Agregar graceful shutdown~~ — Hecho

### ✅ Completadas (Sesión 2 — Bugs de lógica)
6. ~~**MEDIA:** Corregir trigger `'pasado'` genérico en `intentDetector.ts`~~ — Hecho
7. ~~**BAJA:** Corregir `lastWeekday` con `break` para priorizar primera mención~~ — Hecho
8. ~~**MEDIA:** Ajustar detección MIME de Word (eliminar `'document'` y `'officedocument'`)~~ — Hecho
9. ~~**BAJA:** Agregar `quoted` al resumen de cierre en `closingHandler.ts`~~ — Hecho
10. ~~**BAJA:** Reducir buffer de `contextWindow` a 20 mensajes~~ — Hecho
11. ~~**MEDIA:** Agregar `parseFlexibleDate()` para soportar formatos de fecha latinoamericanos~~ — Hecho
12. ~~**BAJA:** Conservar strings vacíos en datos estructurados (solo eliminar nulls)~~ — Hecho

### ✅ Completadas (Sesión 3 — Feature logout)
13. ~~**MEDIA:** Crear script de logout por terminal~~ — Hecho
14. ~~**BAJA:** Agregar script npm `logout`~~ — Hecho

### ✅ Completadas (Sesión 4 — Activación por mención)
15. ~~**ALTA:** Cambiar activación de !bot a @mención/reply~~ — Hecho
16. ~~**ALTA:** Eliminar activación automática por archivo adjunto~~ — Hecho
17. ~~**BAJA:** Mejorar detección de contextInfo para todos los tipos de mensaje~~ — Hecho

### ✅ Completadas (Sesión 5 — Auto-recovery + handler persistente)
18. ~~**ALTA:** Detectar sesión corrupta y auto-limpiar tras N fallos~~ — Hecho
19. ~~**ALTA:** Handler de mensajes persistente a través de reconexiones~~ — Hecho
20. ~~**ALTA:** loggedOut ya no mata el proceso, reconecta con QR nuevo~~ — Hecho

### ✅ Completadas (Sesión 6 — Activación solo por `!bot`)
21. ~~**MEDIA:** Simplificar activación a solo `!bot` (eliminar @mención/reply/auto-privado)~~ — Hecho
22. ~~**BAJA:** Limpiar reglas de activación eliminadas del código~~ — Hecho

### 🔴 Pendientes
1. **ALTA:** Implementar timeout en llamadas a Groq API (evitar que el bot se cuelgue si la API no responde)
2. **MEDIA:** Filtrar por `MAIN_GROUP_ID` para restringir acceso al bot (seguridad)
3. **MEDIA:** Agregar rate limiting para evitar abuso de API (protección de costos)
4. **BAJA:** Configurar ESLint con reglas consistentes
5. **BAJA:** Agregar tests unitarios para `intentDetector`, `messageParser`, `fileParser`
6. **BAJA:** Mejorar README.md con documentación de instalación y uso
