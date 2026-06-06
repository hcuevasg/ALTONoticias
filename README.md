# ALTO · Barrido de Prensa Diario

Sistema desatendido que cada mañana (zona horaria **America/Santiago**) genera un
"diario" de inteligencia de prensa, lo publica en **GitHub Pages** y envía un
correo-teaser al cliente con el link a la edición del día.

## Dos productos
- **Diario de prensa** (público en Pages): Chile en los últimos días · Política — Chile
  y el mundo · Tendencias delictuales.
- **Boletín de Inteligencia ALTO** (solo en el correo, privado): clientes afectados con
  oportunidad comercial, nuevos modus operandi, y riesgo por industria.

## Modelo de embudo (detección → clasificación → oportunidad)
- **Nivel 1 · Detección (Fuentes.gs):** taxonomía en el Sheet. En vez de 1 búsqueda por
  cliente (no escala), se cruzan **clientes × amenazas por industria** en queries booleanas
  de Google News (`("Walmart" OR "Líder") (robo OR fraude)`), más temas delictuales y
  tendencias/MO. ~10-20 fetches cubren cientos de clientes.
- **Nivel 2 · Clasificación (Claude.gs):** filtra relevancia, atribuye el cliente (vía alias),
  descarta falsos positivos.
- **Nivel 3 · Oportunidad comercial (Claude.gs):** por cada hallazgo, el servicio ALTO a
  ofrecer. Convierte inteligencia en venta consultiva.
- Diseño visual: identidad de marca ALTO (rojo #E84244, azul #4174B9, Archivo + IBM Plex),
  dirección **Editorial Bold**.

## Arquitectura (dos runtimes)
- **Apps Script = cerebro.** Trigger temporal diario. Lee config (Google Sheet),
  hace fetch de RSS, deduplica, hace **una** llamada a la API de Anthropic,
  renderiza JSON→HTML, commitea a GitHub Pages vía API y envía el correo con MailApp.
- **GitHub Pages = el diario.** Sirve desde `/docs`. El CSS es un asset **estático
  versionado**, no se regenera cada día.

## Estructura
```
/docs                      <- GitHub Pages sirve desde acá
  index.html               <- edición de HOY (se sobreescribe cada día)
  archivo.html             <- histórico (lee ediciones/indice.json)
  /ediciones
    indice.json            <- manifiesto append-only (fecha + título + archivo)
    AAAA-MM-DD.html        <- ediciones fechadas, permanentes
  /assets
    estilos.css            <- diseño del diario (estático, versionado)
/apps-script               <- (Fases 1-6) orquestador y módulos .gs
/esquema
  contrato.json            <- JSON schema de la edición (referencia)
```

## Estado: COMPLETO ✅ (Fases 0–6, sistema autónomo)
El barrido corre solo cada mañana (7–8 am America/Santiago) vía trigger temporal.

El Sheet de fuentes tiene 5 pestañas: `Clientes` (nombre·industria·alias), `Amenazas`
(industria·términos), `Tendencias`, `FuentesGenerales`, `TemasDelictuales`. La lista de
clientes vive SOLO en el Sheet, nunca en el repo. El boletín (clientes) va SOLO al correo,
nunca a Pages (privacidad).

Módulos de `apps-script/` (se despliegan a mano en script.google.com — ver nota clasp):
- `Fuentes.gs` — lee el Sheet, arma queries cruzadas, fetch RSS paralelo (fetchAll), dedup.
- `Claude.gs` — 1 llamada (claude-sonnet-4-6), embudo N2-N3, anti-alucinación por id.
- `Render.gs` — JSON → 2 HTML (edición completa + correo topado), presupuesto del correo.
- `GitHub.gs` — publica index.html + ediciones/FECHA.html + indice.json vía API.
- `Correo.gs` — envía el digest con MailApp.
- `Codigo.gs` — orquestador `barridoDiario()` + trigger diario.
- `plantilla-edicion.html` — markup de la edición; `appsscript.json` — scopes + timezone.

`/docs` (GitHub Pages) y `esquema/contrato.json` versionados.

### Operación
- Correr a mano: `barridoDiario()`. Pausar: `desinstalarTriggerDiario()`.
- Re-agendar: `instalarTriggerDiario()`.

### Pendientes (post-MVP)
- Cablear el Google Sheet (Clientes / FuentesGenerales / TemasDelictuales) para
  editar fuentes sin tocar código y activar la sección de clientes.
- Decidir repo público vs privado antes de cargar clientes (nombres visibles en Pages).

## Secrets (en Script Properties, nunca en el repo)
`ANTHROPIC_API_KEY`, `GITHUB_PAT`, `GITHUB_REPO`, `SHEET_ID`, `CORREO_DESTINO`.

## Roadmap
- **Fase 0** — Scaffold + /docs estático ✅
- **Fase 1** — `Fuentes.gs`: fetch RSS + parse + dedup
- **Fase 2** — `Claude.gs`: prompt + API + JSON válido contra el contrato
- **Fase 3** — `Render.gs`: JSON → **dos** HTML (edición completa + correo topado),
  compartiendo el render por artículo; solo cambia el filtro/tope
- **Fase 4** — `GitHub.gs`: commit a /docs + append a indice.json
- **Fase 5** — `Correo.gs`: **digest completo** (no teaser) con read-time stamp arriba
- **Fase 6** — `Codigo.gs`: orquestación + trigger diario 7-8am Santiago

## Presupuesto del correo (control determinista del <5 min)
El correo es el **brief completo del día** (se lee solo), no un teaser. El límite de
tiempo **no se delega al modelo**: se impone en `Render.gs` con topes editables.

```js
// Tope al inicio de Render.gs — editable sin tocar lógica
const TOPE_CORREO = {
  titular_principal: 1,
  chile: 3,
  politica: 3,
  delictual: 3,
  clientes: 5            // sección de mayor valor → más espacio
};
const MAX_PALABRAS_BAJADA_CORREO = 30;
```

- Cada sección se ordena por `relevancia` desc y se corta según `TOPE_CORREO`.
- La bajada se trunca a `MAX_PALABRAS_BAJADA_CORREO` en el render (defensivo),
  además de pedir bajadas de ~30 palabras en el prompt de Claude.
- Se calcula **tiempo de lectura** = total_palabras / 200, redondeado, y se muestra
  arriba: `⏱ Lectura: ~N min`. Es la **señal de calibración**: si sale "~6 min"
  seguido, se baja un ítem el tope de las secciones amplias y listo.
- El correo cierra con botón **"Ver edición completa y archivo →"** a Pages (ahí está
  lo que no entró por los topes).
- HTML con **estilos inline** (compatibilidad Outlook). Sin CSS externo en el correo.
