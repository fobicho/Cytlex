# Extensiones de Cytlex

> El **repositorio publicado** de extensiones vive en [`../docs/`](../docs/)
> (`docs/index.json`), servido por GitHub Pages en
> `https://fobicho.github.io/Cytlex/index.json`. Esta carpeta es el sandbox local
> con plantillas de ejemplo.

Una extensión es una **fuente** que aporta a la app las operaciones de
`catalog`, `detail` y `chapter`. Hay dos tipos:

- **`selector`** — solo configuración (URLs + selectores CSS). No requiere programar.
- **`module`** — un módulo JS que exporta una factory y devuelve la fuente.

El gestor de extensiones está en **Explorar › Extensiones**. Para ver las
disponibles se pega la **URL de un índice** (un array JSON de manifiestos) y se
pulsa «Cargar». La URL queda guardada en los ajustes.

## Índice

Un índice es un array JSON de manifiestos. Ejemplo: [`index.json`](./index.json).

```json
[
  { "id": "example-selectors", "name": "Sitio de ejemplo", "lang": "es", "version": "1.0.0",
    "type": "selector", "baseUrl": "https://example.com", "selectors": { } },
  { "id": "example-module", "name": "Ejemplo (módulo)", "lang": "es", "version": "1.0.0",
    "type": "module", "main": "example-module.js" }
]
```

En `type: "module"`, `main` puede ser una URL absoluta o una ruta relativa al
índice. El código se descarga y se ejecuta localmente en la app.

## Tipo `selector`

Cada campo es un string `"selector@atributo"`:

| Sintaxis              | Significado                              |
|-----------------------|------------------------------------------|
| `.title@text`         | texto del elemento (por defecto)         |
| `a@href`              | atributo `href`                          |
| `img@src`             | atributo `src`                           |
| `img@attr:data-src`   | atributo arbitrario                      |
| `@text`               | sin selector: usa el nodo raíz           |

Las URLs con `{q}`, `{genre}` y `{page}` se sustituyen automáticamente.

Esquema completo en [`example-selectors.json`](./example-selectors.json).

## Tipo `module`

```js
export default function createSource({ fetchText, parse }) {
  // fetchText(url) -> Promise<string>   (petición vía proceso principal, sin CORS)
  // parse(html)    -> Document         (DOMParser)
  return {
    id, name,
    catalog: async ({ q, genre, page }) => ({ items, totalPages, totalText }),
    detail:  async (url) => ({ title, cover, altTitles, genres, facts, sinopsis, chapters }),
    chapter: async (url) => ({ label, mangaUrl, pages, options, prev, next })
  };
}
```

Plantilla completa en [`example-module.js`](./example-module.js).

## Formatos de datos

- `catalog` → `{ items: [{ url, title, cover, type, lastChapter }], totalPages, totalText }`
- `detail` → `{ title, cover, altTitles, genres: [], facts: { estado, tipo, autor, vistas }, sinopsis, chapters: [{ title, url, date }] }`
- `chapter` → `{ label, mangaUrl, pages: [url], options: [{ title, url }], prev, next }`

## Cómo probarlas

Sirve esta carpeta por HTTP (por ejemplo `npx serve extensions`) o súbela a un
repo y usa la URL cruda del `index.json`. Luego, en la app: **Explorar ›
Extensiones › pega la URL del índice › Cargar › Instalar**.

> Seguridad: una extensión es código que corre dentro de la app. Instala solo
> desde fuentes en las que confíes.
