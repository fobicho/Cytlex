# Extensiones de Cytlex (repositorio)

Repositorio de extensiones de **Cytlex**, publicado con GitHub Pages desde esta
carpeta `docs/`.

- **URL del índice:** `https://fobicho.github.io/Cytlex/index.json`
- En la app: **Explorar › Extensiones** (se carga solo). También puedes pegar la
  URL a mano y pulsar «Cargar».

## Contenido

| id | Nombre | Idioma | Tipo |
|----|--------|--------|------|
| `mangalect` | MangaLect (LeerMangaEsp) | es | module |
| `onfmangas` | ONF Mangas | es | module |
| `olympusscanlation` | Olympus Scanlation | es | module |

Todas están basadas en el catálogo del repositorio de
[Keiyoushi](https://github.com/keiyoushi/extensions), reimplementadas para
Cytlex. Keiyoushi publica extensiones en **Kotlin/APK** para Mihon/Tachiyomi, que
no son compatibles con Cytlex (Electron/JS); aquí se reescriben como fuentes
nativas.

## Formato

Un índice es un **array JSON** de manifiestos. Hay dos tipos:

- **`selector`** — solo configuración (URLs + selectores CSS). No requiere código.
  Se describe con `selectors` inline. Ver [`templates/example-selectors.json`](./templates/example-selectors.json).
- **`module`** — un módulo JS (`"main"` relativo al índice) que exporta una
  factory y devuelve la fuente. Ver [`templates/example-module.js`](./templates/example-module.js).

```json
[
  {
    "id": "mi-fuente", "name": "Mi Fuente", "lang": "es", "version": "1.0.0",
    "type": "module", "main": "ext/mi-fuente.js", "baseUrl": "https://ejemplo.com"
  }
]
```

El contrato de una fuente es `catalog`, `detail` y `chapter`:

- `catalog({ q, genre, page }) → { items: [{ url, title, cover, type, lastChapter }], totalPages, totalText }`
- `detail(url) → { title, cover, altTitles, genres: [], facts: { estado, tipo, autor, vistas }, sinopsis, chapters: [{ title, url, date }] }`
- `chapter(url) → { label, mangaUrl, pages: [url], options: [], prev, next }`

## Aviso legal

Este repositorio **no aloja contenido**: solo define fuentes que apuntan a sitios
de terceros. Todo el contenido pertenece a sus respectivos autores y sitios.
Instala y usa las extensiones bajo tu propia responsabilidad.

## Añadir una extensión

1. Crea el manifiesto en [`index.json`](./index.json).
2. Si es `module`, añade el `.js` en [`ext/`](./ext).
3. Sube los cambios a `main` (Pages los publica desde `docs/`).
