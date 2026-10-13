<div align="center">

<img src="./public/logo.svg" alt="Cytlex" width="120" />

# Cytlex

**Lector de manga de escritorio para Windows.**

Comodidad garantizada, inspirado en el gigante Tachiyomi como un port directo para Windows. Próximamente para celulares Android/iOS.

`Electron 44` · `React 19` · `Vite 8` · `Tailwind CSS` · `v0.1.0` · `MIT`

</div>

---

## Características

### Biblioteca
- Favoritos organizados por categorías.
- Vista en cuadrícula o lista compacta, con tamaño de portada ajustable.
- Actualizaciones manuales para refrescar los nuevos capítulos de una obra.

### Explorar
- Búsqueda simultánea en todas las extensiones instaladas.
- Resultados agrupados por fuente en carruseles horizontales.
- Listado completo de extensiones extraídas directamente del repo configurado.

### Lector
- Modo de lectura vertical o paginado.
- Barra flotante auto ocultable con: volver, selector de capítulo, selector de
página, cambio de modo y pantalla completa.
- Navegación mediante botones en pantalla y teclado.
- Descarga de paneles con clic derecho.

### Detalle de una obra
- Portada, autor, títulos alternativos, sinopsis expandible con máscara de degradado.
- Badges de estado, tipo y géneros.
- Añadir a biblioteca eligiendo categorías en un desplegable en línea.
- Lista de capítulos con estado leído/no leído, marcar leído/no leído, marcar todos los
  anteriores y orden ascendente/descendente.
- Panel AniList superpuesto para vincular la obra y editar su entrada.

### Seguimiento con AniList
- Sincronización de progreso automática.
- Página Tracking con la lista de AniList agrupada por estado, con progreso, puntuación
y enlace a la obra local.
- Formulario de entrada y navegador de personajes.

### Notificaciones
- Aviso de capítulos nuevos en la biblioteca, con intervalos configurables.
- Aviso de actualizaciones de extensiones.
- Notificaciones en segundo plano en Windows. Al hacer clic en la notificación, la
  app. se abre directamente en la obra.
- Anti-spam integrado.

### Interfaz
- Ventana sin bordes con barra de título personalizada y controles nativos.
- Escalado automático, la pantalla se adapta proporcionalmente al tamaño de la ventana.
- 6 temas distintos para personalizar la experiencia.
- Recordatorio de estado de ventana, con tamaño y posición persistente.

---

## Fuentes y extensiones

Listado de extensiones, configurable directamente en la pestaña de Ajustes:

```
https://fobicho.github.io/Cytlex/index.json
```

El índice es un array JSON de manifiestos que se publica por GitHub Pages.
Actualmente posee las siguientes fuentes:

| id | Nombre | Tipo |
|----|--------|------|
| `leercapitulo` | LeerCapitulo | module |
| `mangalect` | MangaLect | module |
| `onfmangas` | ONF Mangas | module |
| `olympusscanlation` | Olympus Scanlation | module |
| `zonatmo` | ZonaTMO | module |
| `mangaoni` | MangaOni | module |

MangaLect, ONF y Olympus se reescribieron a partir del catálogo de
[Keiyoushi](https://github.com/keiyoushi/extensions), en Cytlex funcionan
como módulos JS propios. Muchas gracias.

---

## Dónde se guardan los datos

### `localStorage` (renderer)

| Clave | Contenido |
|-------|-----------|
| `cytlex:settings:v1` | Ajustes. |
| `cytlex:favs` | Biblioteca de favoritos. |
| `cytlex:cats:v1` | Categorías de la biblioteca. |
| `cytlex:extensions:v1` | Extensiones instaladas: manifiesto + código. |
| `cytlex:progress:v1` | Progreso de lectura por capítulo. |
| `cytlex:tracking:v1` | Vínculos manga ↔ AniList. |
| `cytlex:chapterIndex:v1` | Índice de capítulos cacheado por obra. |
| `cytlex:ext-notified:v1` | Actualizaciones de extensiones ya avisadas. |
| `cytlex:chapterOrder:v2` | Orden de capítulos por obra. |
| `cytlex:anilistSeeded` | Marcas de progreso inicializadas desde AniList. |

---

## Arquitectura técnica

```
┌──────────────────────────────┐
│   Proceso principal Electron │
│  main.js ── ventana + IPC    │
│  preload.cjs ── puente       │
│  auth.cjs ── OAuth AniList   │
└───────────────┬──────────────┘
                │  window.cytlex  (contextBridge)
┌───────────────▼──────────────┐
│   Renderer React (Vite)      │
│  HashRouter · 7 vistas       │
│  lib/ (20 módulos)           │
│  localStorage (datos)        │
└──────────────────────────────┘
```

### API del puente (`window.cytlex`)

Expuesta con `contextIsolation: true` y `nodeIntegration: false`:

| Grupo | Métodos |
|-------|---------|
| HTTP | `httpGet(url)`, `httpHead(url)`, `httpPost(payload)` |
| Imágenes | `fetchImage(url)`, `downloadImage({ url, suggested })` |
| Notificaciones | `notify(payload)`, `notifySupported()`, `setBackgroundCheck(on, hours)`, `confirmTask()`, `onNotifyClick(cb)` |
| AniList | `authLogin()`, `authLogout()`, `authStatus()`, `authGql(payload)` |
| Ventana | `toggleFullscreen()`, `isFullscreen()`, `minimize()`, `toggleMaximize()`, `isMaximized()`, `close()`, `onMaximizedChange(cb)` |
| Fondo | `isBackground()`, `exitBackground()` |

---

## Seguridad

- El renderer corre con `contextIsolation: true` y `nodeIntegration: false`; todo pasa por el
  puente `contextBridge`.
- La sesión de AniList se almacena **cifrada** con `safeStorage` de Electron cuando está disponible.
- La ventana de login OAuth usa su propio `webPreferences` aislado.

> **Las extensiones son código que se descarga y ejecuta dentro de la aplicación.**
> Instala solo desde índices en los que confíes.

---

## Aviso legal

Cytlex no aloja ni distribuye ningún contenido de manga. Es un cliente que apunta a sitios
de terceros. Todo el contenido pertenece a sus autores y a los sitios que lo publican, y cada
fuente se usa bajo responsabilidad del usuario. Las extensiones son únicamente código de
interoperabilidad.

---

## Licencia

[MIT](./package.json) © fobicho
