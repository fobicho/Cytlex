# Extensiones de Cytlex

Fuentes para el lector. La app no trae ninguna instalada: entras en **Explorar ›
Extensiones**, pulsas el icono de cada una y ya aparece en las búsquedas.

El índice que usa la app es este:
`https://fobicho.github.io/Cytlex/index.json`

Se publica con GitHub Pages desde la carpeta `docs/`, así que cualquier commit a
`main` lo actualiza solo.

## Fuentes

| id | Nombre | Tipo |
|----|--------|------|
| `mangalect` | MangaLect | module |
| `onfmangas` | ONF Mangas | module |
| `olympusscanlation` | Olympus Scanlation | module |
| `zonatmo` | ZonaTMO | module |
| `mangaoni` | MangaOni | module |

MangaLect, ONF y Olympus se escribieron a partir del catálogo de
[Keiyoushi](https://github.com/keiyoushi/extensions), que publica en Kotlin para
Mihon. Como Cytlex es Electron, el código no sirve tal cual y hubo que reescribir
cada fuente. ZonaTMO y MangaOni van directas contra su web.

## Añadir una fuente

Dos formas. La fácil es `selector`: declaras las URLs y los selectores CSS en el
manifiesto, sin escribir código. La otra es `module`, un archivo JS que exporta una
factory y devuelve la fuente.

La plantilla está en [`templates/`](./templates).

```json
[
  {
    "id": "mi-fuente",
    "name": "Mi Fuente",
    "lang": "es",
    "version": "1.0.0",
    "type": "module",
    "main": "ext/mi-fuente.js",
    "baseUrl": "https://ejemplo.com",
    "icon": "https://fobicho.github.io/Cytlex/icons/mi-fuente.png"
  }
]
```

Una fuente devuelve tres cosas:

| Método | Para qué |
|--------|----------|
| `catalog({ q, genre, page })` | el listado: items con `url`, `title`, `cover`, `type`, `lastChapter` |
| `detail(url)` | la ficha: título, cover, sinopsis, géneros, `facts` y los capítulos |
| `chapter(url)` | el lector: `pages` con las imágenes, y `options` con la lista de capítulos |

Dos detalles que rompen la app si no los respetas:

- `chapters` va **en orden de lectura**, capítulo 1 primero. El botón «Leer» abre
  directamente el primero.
- El `url` que devuelve `catalog` tiene que ser exactamente el mismo que espera
  `detail`, y el de cada capítulo tiene que ser estable entre llamadas. Se usan
  como clave para guardar el progreso de lectura.

Si la portada de tu fuente no carga, es el `Referer`: la app lo falsea para los
dominios conocidos en `hookImageHeaders()` (`electron/main.js`). Añade el tuyo ahí.

Un aviso que conviene tener presente al escribir una: una extensión es código que
se descarga y se ejecuta dentro de la app, sin sandbox. Instala solo desde sitios en
los que confíes.

## Legal

Aquí no hay nada de manga, solo código que apunta a sitios de terceros. El
contenido es de sus autores y de sus sitios, y usas cada fuente bajo tu
responsabilidad.
