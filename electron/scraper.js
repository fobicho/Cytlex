import * as cheerio from 'cheerio';

export const BASE = 'https://leercapitulo.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1 Electron';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: BASE + '/',
      Accept: 'text/html',
      'Accept-Language': 'es-ES,es;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return await res.text();
}

const abs = (src) => {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  return BASE + src;
};

function parseCard($, el) {
  const card = $(el);
  const link = card.find('a.lc-card-cover').attr('href') || card.find('a.lc-card-name').attr('href') || '';
  const img = card.find('img').first();
  const title = card.find('.lc-card-name').text().trim();
  const cover = abs(img.attr('src') || '');
  const type = card.find('.lc-card-badge').text().trim();
  const lastChapter = card.find('.lc-chapter-link').text().trim();
  const lastChapterUrl = card.find('.lc-chapter-link').attr('href') || '';
  const status = card.find('.lc-muted').text().trim();
  return { title, url: link, cover, type, lastChapter, lastChapterUrl, status };
}

export async function fetchHome() {
  const html = await fetchHtml(BASE + '/');
  const $ = cheerio.load(html);
  const pick = (sectionTitle) => {
    // Home usa varias secciones; tomamos tarjetas genéricas de las primeras filas
    return [];
  };
  // Tendencias / Populares / Últimos: estructura con .lc-card o enlaces a /manga/
  const trending = [];
  $('a[href*="/manga/"]').each((_, a) => {
    const href = $(a).attr('href');
    const img = $(a).find('img');
    if (img.length && href && href.startsWith('/manga/') && trending.length < 24) {
      const title = img.attr('alt')?.replace('Portada de ', '') || $(a).text().trim().slice(0, 80);
      if (title && !trending.find((t) => t.url === href)) {
        trending.push({ title, url: href, cover: abs(img.attr('src') || '') });
      }
    }
  });

  // Últimos capítulos agregados: bloques con h3/a + lista de capítulos
  const latest = [];
  $('a[href^="/leer/"]').each((_, a) => {
    const href = $(a).attr('href');
    const text = $(a).text().trim();
    if (/^Capitulo/i.test(text) && href) {
      const parts = href.split('/').filter(Boolean); // leer, id, slug, num
      if (parts.length >= 4) {
        latest.push({ chapter: text, url: href, mangaId: parts[1], slug: parts[2], number: parts[3] });
      }
    }
  });

  return {
    trending: trending.slice(0, 24),
    latestChapters: latest.slice(0, 60)
  };
}

export async function fetchCatalog({ q = '', genre = '', theme = '', type = '', status = '', sort = 'az', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (genre) params.set('genre', genre);
  if (theme) params.set('theme', theme);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (sort) params.set('sort', sort);
  if (page > 1) params.set('page', String(page));
  const url = `${BASE}/manga/?${params.toString()}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const items = [];
  $('.lc-card').each((_, el) => {
    const c = parseCard($, el);
    if (c.title) items.push(c);
  });

  // Total páginas: último número en paginación
  let totalPages = 1;
  $('.pagination .page-link').each((_, el) => {
    const t = $(el).text().trim();
    const n = parseInt(t, 10);
    if (!isNaN(n) && n > totalPages) totalPages = n;
  });
  const totalText = $('.lc-section-title .lc-more').text() || '';
  return { items, totalPages, totalText, url };
}

export function parseMangaUrl(url) {
  // /manga/{id}/{slug}/ o URL completa
  const m = url.match(/\/manga\/([^/]+)\/([^/]+)\/?/);
  if (!m) return null;
  return { id: m[1], slug: m[2] };
}

export function parseChapterUrl(url) {
  const m = url.match(/\/leer\/([^/]+)\/([^/]+)\/([^/]+)\/?/);
  if (!m) return null;
  return { id: m[1], slug: m[2], number: m[3] };
}

export async function fetchDetail(mangaUrl) {
  const full = mangaUrl.startsWith('http') ? mangaUrl : BASE + mangaUrl;
  const html = await fetchHtml(full);
  const $ = cheerio.load(html);

  const title = $('h1.h3, h1').first().text().trim();
  const cover = abs($('.lc-cover-lg img').attr('src') || $('.lc-card-cover img').attr('src') || '');
  const altTitles = $('p.small.lc-muted').first().text().trim();
  const genres = [];
  $('a.badge[href*="genre="]').each((_, el) => genres.push($(el).text().trim()));
  const themes = [];
  $('a.badge[href*="theme="]').each((_, el) => themes.push($(el).text().trim()));

  const facts = {};
  $('.lc-facts li').each((_, li) => {
    const k = $(li).find('.k').text().trim().toLowerCase();
    const v = $(li).text().replace($(li).find('.k').text(), '').trim();
    if (k) facts[k] = v;
  });

  const sinopsis = $('#sinopsis p').text().trim() || $('section:has(h2:contains("Sinopsis")) p').text().trim();

  const chapters = [];
  $('#chapterList a.lc-chapter-row, a.lc-chapter-row[href*="/leer/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const num = $(el).find('.n').text().trim() || $(el).text().trim();
    const date = $(el).find('.d').text().trim();
    if (href) chapters.push({ title: num, url: href, date });
  });

  const info = parseMangaUrl(mangaUrl) || {};
  return { title, cover, altTitles, genres, themes, facts, sinopsis, chapters, ...info, url: mangaUrl };
}

export async function fetchChapter(chapterUrl) {
  const full = chapterUrl.startsWith('http') ? chapterUrl : BASE + chapterUrl;
  const html = await fetchHtml(full);
  const $ = cheerio.load(html);

  const pages = [];
  $('#lcPages img').each((_, img) => {
    const src = $(img).attr('data-src') || $(img).attr('src');
    if (src) pages.push(src.startsWith('http') ? src : abs(src));
  });

  const options = [];
  $('#chapterSelect option').each((_, o) => {
    options.push({ title: $(o).text().trim(), url: $(o).attr('value') });
  });

  const meta = parseChapterUrl(chapterUrl) || {};
  const mangaBack = $('.lc-reader-top a').first().attr('href') || '';
  const currentLabel = $('#lcChapterPill span').text().trim() || $('title').text().trim();

  // prev/next según orden del select (desc: más reciente primero)
  const idx = options.findIndex((o) => chapterUrl.includes(o.url) || o.url === chapterUrl);
  let prev = null, next = null;
  if (idx >= 0) {
    prev = options[idx + 1] || null; // capítulo anterior (más viejo)
    next = options[idx - 1] || null; // capítulo siguiente (más nuevo)
  }

  return { pages, options, mangaUrl: mangaBack, label: currentLabel, prev, next, ...meta, url: chapterUrl };
}
