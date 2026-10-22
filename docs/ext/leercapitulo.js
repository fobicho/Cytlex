const BASE = 'https://leercapitulo.co';

const abs = (u) => {
  if (!u) return '';
  try { return new URL(u, BASE).href; } catch { return u; }
};

const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

function parseMangaUrl(url) {
  const m = String(url || '').match(/\/manga\/([^/]+)\/([^/]+)\/?/);
  if (!m) return null;
  return { id: m[1], slug: m[2] };
}

function parseChapterUrl(url) {
  const m = String(url || '').match(/\/leer\/([^/]+)\/([^/]+)\/([^/]+)\/?/);
  if (!m) return null;
  return { id: m[1], slug: m[2], number: m[3] };
}

function chapterNumber(url) {
  const m = String(url || '').match(/\/leer\/[^/]+\/[^/]+\/([^/?#]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const isSideTrack = (n) => n != null && !Number.isInteger(n) && Math.round(n * 10) % 10 === 1;

function preferWholeChapters(list) {
  const nums = list.map((c) => chapterNumber(c.url));
  const whole = new Set(nums.filter((n) => n != null && Number.isInteger(n)));
  return list.filter((_, i) => {
    const n = nums[i];
    if (n == null || Number.isInteger(n)) return true;
    if (!isSideTrack(n)) return true;
    return !whole.has(Math.floor(n));
  });
}

function dedupeNames(value) {
  const parts = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';

  const seen = new Map();
  for (const name of parts) {
    const key = name.toLowerCase().replace(/[\s.]/g, '').split('').sort().join('');
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].join(', ');
}

export default function createSource({ fetchText, parse, head }) {
  const adultLabel = (value) => /(^|[^a-z0-9])(?:\+18|18\+|adulto?|hentai|erotica|erotico|xxx)(?=$|[^a-z0-9])/i.test(String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const extractPages = (doc) =>
    [...doc.querySelectorAll('#lcPages img')]
      .map((img) => img.getAttribute('data-src') || img.getAttribute('src') || '')
      .filter(Boolean)
      .map((src) => (src.startsWith('http') ? src : abs(src)));

  const parseCard = (el) => {
    const link = el.querySelector('a.lc-card-cover') || el.querySelector('a.lc-card-name');
    const img = el.querySelector('img');
    return {
      title: text(el, '.lc-card-name'),
      url: abs(link?.getAttribute('href')),
      cover: abs(img?.getAttribute('src')),
      type: text(el, '.lc-card-badge'),
      lastChapter: text(el, '.lc-chapter-link'),
      status: text(el, '.lc-muted'),
      adult: adultLabel(el.textContent)
    };
  };

  function construirCapitulo(doc, chapterUrl, pages) {
    const options = [...doc.querySelectorAll('#chapterSelect option')]
      .map((o) => ({
        title: (o.textContent || '').replace(/\s+/g, ' ').trim(),
        url: abs(o.getAttribute('value'))
      }))
      .filter((o) => o.url);
    const visibleOptions = preferWholeChapters(options);

    const meta = parseChapterUrl(chapterUrl) || {};
    const mangaBack = doc.querySelector('.lc-reader-top a')?.getAttribute('href') || '';
    const currentLabel = text(doc, '#lcChapterPill span') || text(doc, 'title');

    const idx = visibleOptions.findIndex((o) => chapterUrl.includes(o.url) || o.url === chapterUrl);
    let prev = null;
    let next = null;
    if (idx >= 0) {
      prev = visibleOptions[idx + 1] || null;
      next = visibleOptions[idx - 1] || null;
    }

    return {
      pages,
      options: visibleOptions,
      mangaUrl: abs(mangaBack),
      label: currentLabel,
      prev,
      next,
      ...meta,
      url: chapterUrl
    };
  }

  const nodeEstado = new Map();
  const NODE_TTL_MS = 30 * 60 * 1000;
  let ultimoNodoBueno = null;

  function estadoNodo(host) {
    const e = nodeEstado.get(host);
    if (!e) return undefined;
    if (Date.now() - e.at > NODE_TTL_MS) {
      nodeEstado.delete(host);
      return undefined;
    }
    return e.ok ? 'ok' : 'muerto';
  }

  function marcarNodo(host, ok) {
    nodeEstado.set(host, { ok, at: Date.now() });
    if (!ok && ultimoNodoBueno === host) ultimoNodoBueno = null;
  }

  const hostDe = (url) => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
  };

  const aNodo = (url, host) => {
    try {
      const u = new URL(url);
      u.hostname = host;
      return u.href;
    } catch {
      return url;
    }
  };

  async function comprobarNodo(url) {
    if (typeof head !== 'function') return true;
    try {
      const r = await head(url);
      if (!r || !r.status) return false;
      return r.ok || r.status < 500;
    } catch {
      return false;
    }
  }

  function nuevoHostDe(url) {
    const host = hostDe(url);
    const m = /^(es\d+s\d+)-(\d+)$/.exec(host.replace(/\.t34798ndc\.com$/, ''));
    if (!m) return [];
    const [, , sufijo] = m;
    const out = [];
    for (let s = 1; s <= 3; s++) {
      for (let r = 1; r <= 14; r++) {
        out.push(`es${s}s${r}-${sufijo}.t34798ndc.com`);
      }
    }
    return out;
  }

  async function pagesEnNodoBueno(pages) {
    if (!pages.length || typeof head !== 'function') return pages;
    const hostActual = hostDe(pages[0]);
    if (!hostActual) return pages;

    if (estadoNodo(hostActual) === 'ok') {
      ultimoNodoBueno = hostActual;
      return pages;
    }

    if (ultimoNodoBueno) return pages.map((p) => aNodo(p, ultimoNodoBueno));

    if (await comprobarNodo(pages[0])) {
      marcarNodo(hostActual, true);
      ultimoNodoBueno = hostActual;
      return pages;
    }
    marcarNodo(hostActual, false);

    const candidatos = nuevoHostDe(pages[0])
      .filter((host) => host !== hostActual && estadoNodo(host) !== 'muerto');
    const inicioBusqueda = Date.now();
    for (let i = 0; i < candidatos.length && Date.now() - inicioBusqueda < 15_000; i += 8) {
      const grupo = candidatos.slice(i, i + 8);
      const resultados = await Promise.all(grupo.map(async (host) => ({
        host,
        ok: await comprobarNodo(aNodo(pages[0], host))
      })));
      for (const { host, ok } of resultados) marcarNodo(host, ok);
      const bueno = resultados.find((r) => r.ok);
      if (bueno) {
        ultimoNodoBueno = bueno.host;
        return pages.map((p) => aNodo(p, bueno.host));
      }
    }

    return pages;
  }

  async function catalog({ q = '', genre = '', page = 1 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (genre) params.set('genre', genre);
    params.set('sort', 'az');
    if (page > 1) params.set('page', String(page));
    const url = `${BASE}/manga/?${params.toString()}`;

    const doc = parse(await fetchText(url));
    const items = [...doc.querySelectorAll('.lc-card')].map(parseCard).filter((c) => c.title);

    let totalPages = 1;
    for (const el of doc.querySelectorAll('.pagination .page-link')) {
      const n = parseInt((el.textContent || '').trim(), 10);
      if (!Number.isNaN(n) && n > totalPages) totalPages = n;
    }

    return { items, totalPages, totalText: text(doc, '.lc-section-title .lc-more') };
  }

  async function detail(mangaUrl) {
    const full = abs(mangaUrl);
    const doc = parse(await fetchText(full));

    const title = (doc.querySelector('h1.h3') || doc.querySelector('h1'))?.textContent.trim() || '';
    const coverImg = doc.querySelector('.lc-cover-lg img') || doc.querySelector('.lc-card-cover img');
    const altTitles = (doc.querySelector('p.small.lc-muted')?.textContent || '').trim();
    const genres = [...doc.querySelectorAll('a.badge[href*="genre="]')].map((el) => (el.textContent || '').trim());
    const themes = [...doc.querySelectorAll('a.badge[href*="theme="]')].map((el) => (el.textContent || '').trim());

    const facts = {};
    for (const li of doc.querySelectorAll('.lc-facts li')) {
      const kEl = li.querySelector('.k');
      const k = (kEl?.textContent || '').trim().toLowerCase();
      if (!k) continue;
      facts[k] = (li.textContent || '').replace(kEl.textContent || '', '').trim();
    }
    facts.autor = dedupeNames(facts.autor);
    facts.dibujo = dedupeNames(facts.dibujo);

    const sinopsis = text(doc, '#sinopsis p');

    const chapters = [...doc.querySelectorAll('#chapterList a.lc-chapter-row, a.lc-chapter-row[href*="/leer/"]')]
      .map((el) => {
        const href = el.getAttribute('href') || '';
        if (!href) return null;
        return {
          title: text(el, '.n') || (el.textContent || '').replace(/\s+/g, ' ').trim(),
          url: abs(href),
          date: text(el, '.d')
        };
      })
      .filter(Boolean);

    const info = parseMangaUrl(full) || {};
    return {
      title,
      cover: abs(coverImg?.getAttribute('src')),
      altTitles,
      genres,
      themes,
      adult: [...genres, ...themes, ...Object.values(facts)].some(adultLabel),
      facts,
      sinopsis,
      chapters: preferWholeChapters(chapters),
      ...info,
      url: mangaUrl
    };
  }

  async function chapter(chapterUrl) {
    const full = abs(chapterUrl);

    for (let ronda = 0; ronda < 3; ronda++) {
      const html = await fetchText(full).catch(() => null);
      if (!html) continue;

      const doc = parse(html);
      const raw = extractPages(doc);
      if (!raw.length) continue;

      const pages = await pagesEnNodoBueno(raw);
      const hostFinal = hostDe(pages[0]);
      if (hostFinal && estadoNodo(hostFinal) === 'muerto') continue;

      return construirCapitulo(doc, full, pages);
    }

    throw new Error(`No se pudo cargar el capítulo en ${chapterUrl}`);
  }

  return { id: 'leercapitulo', name: 'LeerCapitulo', catalog, detail, chapter };
}
