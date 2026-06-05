# ALTO · Barrido de Prensa Diario

Sistema desatendido que cada mañana (zona horaria **America/Santiago**) genera un
"diario" de inteligencia de prensa, lo publica en **GitHub Pages** y envía un
correo-teaser al cliente con el link a la edición del día.

## Secciones fijas del diario
1. Chile en los últimos días
2. Política — Chile y el mundo
3. Tendencias delictuales
4. Monitoreo de clientes (lista predeterminada, sensible)

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

## Estado: Fase 0 ✅ (scaffold + /docs estático)
Lo construido hasta ahora:
- `docs/index.html` — placeholder de la edición de hoy.
- `docs/assets/estilos.css` — diseño del diario (estable).
- `docs/archivo.html` — lee `ediciones/indice.json` y lista el histórico.
- `docs/ediciones/indice.json` — manifiesto vacío (`[]`).
- `esquema/contrato.json` — contrato de la edición (referencia).

## Secrets (en Script Properties, nunca en el repo)
`ANTHROPIC_API_KEY`, `GITHUB_PAT`, `GITHUB_REPO`, `SHEET_ID`, `CORREO_DESTINO`.

## Roadmap
- **Fase 0** — Scaffold + /docs estático ✅
- **Fase 1** — `Fuentes.gs`: fetch RSS + parse + dedup
- **Fase 2** — `Claude.gs`: prompt + API + JSON válido contra el contrato
- **Fase 3** — `Render.gs`: JSON → HTML (descarta artículos sin url)
- **Fase 4** — `GitHub.gs`: commit a /docs + append a indice.json
- **Fase 5** — `Correo.gs`: teaser con MailApp
- **Fase 6** — `Codigo.gs`: orquestación + trigger diario 7-8am Santiago
