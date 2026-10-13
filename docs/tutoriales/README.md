# Guías de uso de la Oficina Virtual

Las guías «para dummies» por rol. Cada una es una página estática que viaja con
el plugin en `frontend/public/ayuda/` y se abre desde el ícono del libro del
encabezado: quien aprueba solicitudes (jefes y RRHH) abre `ayuda/jefes.html`, que
enlaza a la básica; el resto abre `ayuda/colaboradores.html`.

| Rol | Fuente | Publicada en el plugin |
|---|---|---|
| Colaboradores | `guia-colaboradores.html` | `frontend/public/ayuda/colaboradores.html` |
| Jefes | `guia-jefes.html` (escenas en `escenas-jefes.js`) | `frontend/public/ayuda/jefes.html` |
| RRHH / administración | pendiente | |

## Cómo se arman las capturas

`estudio.js` abre la oficina real ya compilada (`frontend/dist`) en Playwright
contra una API **simulada**: el plano real de la oficina (`layout-ejemplo.json`,
solo zonas) y un equipo de 15 personas con nombres inventados. El reloj queda
fijo en el miércoles 25-nov-2026 10:15 (Costa Rica) para que las tomas no
cambien de un día a otro. Nada toca producción.

`escenas.js` arma cada pantalla, le pone las marcas naranjas numeradas (las
mismas que repite la leyenda de la guía) y la guarda en
`frontend/public/ayuda/capturas/`.

```bash
npm run build:frontend                      # la guía fotografía frontend/dist
node docs/tutoriales/escenas.js             # todas las escenas
node docs/tutoriales/escenas.js 10 11       # solo las que empiezan así
node docs/tutoriales/escenas-jefes.js       # las de jefes (21–28), con abrir({ rol: 'jefe' })
node docs/tutoriales/a-plugin.js            # fuentes → frontend/public/ayuda/*.html
npm run build:frontend                      # para que la guía nueva entre en ui/
```

Playwright se toma de `vla-system/node_modules` (ruta fija al principio de
`estudio.js`).

`a-plugin.js` convierte cada fuente (lista `GUIAS`) en un documento completo y
arma el índice fijo: el CSP de producción no deja correr scripts escritos dentro
de la página. Los enlaces entre guías se escriben con la URL pública del
artifact y ahí se cambian por la página de al lado.

Con `rol: 'jefe'` el estudio cambia de punto de vista: quien mira es Paula
Núñez, jefa de Ventas, con Ana, Bruno y Camila a cargo (bandeja, avisos, equipo
en Tiempos y cronómetros en rojo; ver `rutasJefe` en `estudio.js`).

## Trampas conocidas

- Los filtros del mapa se llaman igual que los estados («Permiso 1»): para
  elegir un estado hay que buscar dentro del menú (`div.w-52`).
- Las listas con scroll propio se recortan en la foto: quitarles el
  `max-height` antes de la toma.
- Un mismo texto aparece varias veces (por ejemplo el nombre de una zona):
  `etiquetar` prueba todas las coincidencias visibles.
- Las reglas que afirma la guía salen del código: permiso 1 h por mes
  (`TOPE_PERMISO_MES_MIN`), cita hasta 3 h, motivo de 10 letras como mínimo
  (`MIN_JUSTIFICATION`), motivo de rechazo de 5 (`MIN_MOTIVO`), límites del
  cronómetro, recordatorio de pendientes de más de 20 h (lunes a viernes 9:00).
  Si cambian ahí, hay que cambiar el texto.
