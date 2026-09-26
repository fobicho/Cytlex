// Motor genérico de extensiones basadas en selectores CSS.
//
// Cada campo es un string "selector@atributo":
//   ".title@text"      -> texto del elemento
//   "a@href"           -> atributo href
//   "img@src"          -> atributo src
//   "img@attr:data-src"-> atributo arbitrario
//   ".cover"           -> si se omite @, se usa text
//   "@text"            -> sin selector: usa el propio nodo raíz

function splitSpec(spec) {
  if (!spec) return ['', 'text'];
  const i = spec.indexOf('@');
  if (i === -1) return [spec, 'text'];
  return [spec.slice(0, i), spec.slice(i + 1) || 'text'];
}

function readAttr(el, attr) {
  if (attr === 'html') return el.innerHTML;
  if (attr === 'href') return el.getAttribute('href') || '';
  if (attr === 'src') return el.getAttribute('src') || '';
  if (attr.startsWith('attr:')) return el.getAttribute(attr.slice(5)) || '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

export function buildSelectorSource(manifest, ctx) {
  const cfg = manifest.selectors || {};
  const base = manifest.baseUrl || '';

  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };

  const pick = (root, spec) => {
    if (!spec) return '';
    const [sel, attr] = splitSpec(spec);
    const el = sel ? root.querySelector(sel) : root;
    return el ? readAttr(el, attr) : '';
  };

  const pickAll = (root, spec) => {
    if (!spec) return [];
    const [sel, attr] = splitSpec(spec);
    if (!sel) return [];
    return [...root.querySelectorAll(sel)]
      .map((el) => readAttr(el, attr).trim())
      .filter(Boolean);
  };

  const page = (html) => ctx.parse(html);

  const buildUrl = (tpl, { q = '', genre = '', p = 1 }) =>
    abs(
      String(tpl)
        .replaceAll('{q}', encodeURIComponent(q))
        .replaceAll('{genre}', encodeURIComponent(genre))
        .replaceAll('{page}', String(p))
    );

  async function catalog({ q = '', genre = '', page: p = 1 } = {}) {
    const c = cfg.catalog || {};
    const tpl = q ? c.searchUrl : genre ? c.genreUrl : c.popularUrl;
    if (!tpl || !c.list) return { items: [], totalPages: 1, totalText: '' };

    const doc = page(await ctx.fetchText(buildUrl(tpl, { q, genre, p })));
    const items = [...doc.querySelectorAll(c.list)]
      .map((el) => ({
        url: abs(pick(el, c.url)),
        title: pick(el, c.title),
        cover: abs(pick(el, c.cover)),
        type: pick(el, c.type),
        lastChapter: pick(el, c.lastChapter)
      }))
      .filter((x) => x.url && x.title);

    const totalPages = c.totalPages ? parseInt(pick(doc, c.totalPages), 10) || p : p;
    return { items, totalPages, totalText: '' };
  }

  async function detail(mangaUrl) {
    const c = cfg.detail || {};
    const doc = page(await ctx.fetchText(abs(mangaUrl)));

    const chapters = [...(c.chapterList ? doc.querySelectorAll(c.chapterList) : [])]
      .map((el) => ({
        url: abs(pick(el, c.chapterUrl)),
        title: pick(el, c.chapterTitle),
        date: pick(el, c.chapterDate)
      }))
      .filter((x) => x.url);

    const status = pick(doc, c.status);
    return {
      title: pick(doc, c.title) || manifest.name,
      cover: abs(pick(doc, c.cover)),
      altTitles: pick(doc, c.altTitles),
      genres: pickAll(doc, c.genres),
      facts: {
        estado: status,
        status,
        tipo: pick(doc, c.type),
        autor: pick(doc, c.author),
        vistas: pick(doc, c.views)
      },
      sinopsis: pick(doc, c.sinopsis),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const c = cfg.chapter || {};
    const doc = page(await ctx.fetchText(abs(chapterUrl)));

    const options = c.options
      ? [...doc.querySelectorAll(c.options)].map((el) => ({
          title: pick(el, c.optionsTitle),
          url: abs(pick(el, c.optionsUrl))
        }))
      : [];

    return {
      label: pick(doc, c.label) || '',
      mangaUrl: c.mangaUrl ? abs(pick(doc, c.mangaUrl)) : '',
      pages: pickAll(doc, c.pages).map(abs),
      options,
      prev: null,
      next: null
    };
  }

  return { id: manifest.id, name: manifest.name, catalog, detail, chapter };
}
