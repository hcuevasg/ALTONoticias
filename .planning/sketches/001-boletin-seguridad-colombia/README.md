---
sketch: 001
name: boletin-seguridad-colombia
question: "¿Cómo se estructura una versión ALTO del boletín diario de seguridad de Colombia (hoy provisto por ARES)?"
winner: "B"
tags: [boletin, colombia, layout, seguridad]
---

# Sketch 001: Boletín de Seguridad Colombia — versión ALTO

## Pregunta de diseño
¿Qué estructura debe tener el boletín de seguridad Colombia con identidad ALTO,
incorporando las 5 mejoras sobre el boletín ARES: priorización por severidad,
fuentes citadas con link, filtro de relevancia por sector, recomendaciones
orientadas al cliente privado y tendencias día contra día?

Contenido: hechos reales del boletín ARES del 11–12 de junio de 2026, reprocesados.
Las fuentes por ítem son ilustrativas (mock).

## Cómo verlo
open .planning/sketches/001-boletin-seguridad-colombia/index.html

## Variantes
- **A: Edición Editorial** — el boletín como una edición del Barrido de Prensa (hero con la alerta más accionable, tendencias, críticos con bloque de impacto, barrido a 2 columnas, recomendaciones). Camino de menor resistencia: reusa la plantilla y CSS actuales de NoticiasALTO.
- **B: Tablero de Inteligencia** — riesgo primero: semáforo regional + tendencias + mapa arriba; lista única de incidentes filtrable por severidad; recomendaciones en grilla por sector. Más producto de inteligencia, menos diario.
- **C: Informe Ejecutivo** — conserva el flujo del ARES (resumen ejecutivo → incidentes numerados → balance regional → recomendaciones) pero con orden por severidad, chips, fuentes y recomendaciones para clientes. Menor costo de cambio para el equipo de Colombia.

## Qué mirar al comparar
- ¿El hero editorial (A) comunica mejor "la alerta del día" que el semáforo (B) o el resumen (C)?
- ¿El filtro por severidad y el toggle de "descartados" (A y B) demuestran bien el valor del filtro de relevancia?
- ¿Los bloques "Impacto para clientes" (A) justifican su espacio frente al formato compacto (B/C)?
- ¿Cuánto pesa la familiaridad del formato ARES (C) para la adopción en Colombia?
