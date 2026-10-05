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

function hostDe(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function aNodo(url, host) {
  try {
    const u = new URL(url);
    u.hostname = host;
    return u.href;
  } catch {
    return url;
  }
}

async function comprobarNodo(url) {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA, Referer: BASE + '/' },
      signal: AbortSignal.timeout(6000)
    });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function pagesEnNodoBueno(pages) {
  if (!pages.length) return pages;
  const hostActual = hostDe(pages[0]);
  if (!hostActual) return pages;

  if (estadoNodo(hostActual) === 'ok') {
    ultimoNodoBueno = hostActual;
    return pages;
  }

  if (ultimoNodoBueno) {
    return pages.map((p) => aNodo(p, ultimoNodoBueno));
  }

  if (await comprobarNodo(pages[0])) {
    marcarNodo(hostActual, true);
    ultimoNodoBueno = hostActual;
    return pages;
  }
  marcarNodo(hostActual, false);

  for (const host of nuevoHostDe(pages[0])) {
    if (host === hostActual || estadoNodo(host) === 'muerto') continue;
    if (await comprobarNodo(aNodo(pages[0], host))) {
      marcarNodo(host, true);
      ultimoNodoBueno = host;
      return pages.map((p) => aNodo(p, host));
    }
    marcarNodo(host, false);
  }

  return pages;
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

function extraerPaginas($, chapterUrl) {
  const pages = [];
  $('#lcPages img').each((_, img) => {
    const src = $(img).attr('data-src') || $(img).attr('src');
    if (src) pages.push(src.startsWith('http') ? src : abs(src));
  });
  return pages;
}

function construirCapitulo($, chapterUrl, pages) {
  const options = [];
  $('#chapterSelect option').each((_, o) => {
    options.push({ title: $(o).text().trim(), url: $(o).attr('value') });
  });
  const visibleOptions = preferWholeChapters(options);

  const meta = parseChapterUrl(chapterUrl) || {};
  const mangaBack = $('.lc-reader-top a').first().attr('href') || '';
  const currentLabel = $('#lcChapterPill span').text().trim() || $('title').text().trim();

  const idx = visibleOptions.findIndex((o) => chapterUrl.includes(o.url) || o.url === chapterUrl);
  let prev = null, next = null;
  if (idx >= 0) {
    prev = visibleOptions[idx + 1] || null;
    next = visibleOptions[idx - 1] || null;
  }

  return {
    pages,
    options: visibleOptions,
    mangaUrl: mangaBack,
    label: currentLabel,
    prev,
    next,
    ...meta,
    url: chapterUrl
  };
}

export async function fetchChapter(chapterUrl, opts = {}) {
  const rondas = opts.rondas ?? 3;
  const full = chapterUrl.startsWith('http') ? chapterUrl : BASE + chapterUrl;

  for (let ronda = 0; ronda < rondas; ronda++) {
    const html = await fetchHtml(full).catch(() => null);
    if (!html) continue;

    const $ = cheerio.load(html);
    const raw = extraerPaginas($, chapterUrl);
    if (!raw.length) continue;

    const pages = await pagesEnNodoBueno(raw);
    const hostFinal = hostDe(pages[0]);
    if (hostFinal && estadoNodo(hostFinal) === 'muerto') continue;

    return construirCapitulo($, chapterUrl, pages);
  }

  throw new Error(`No se pudo cargar el capÃ­tulo en ${chapterUrl}`);
}

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
    return [];
  };
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

  const latest = [];
  $('a[href^="/leer/"]').each((_, a) => {
    const href = $(a).attr('href');
    const text = $(a).text().trim();
    if (/^Capitulo/i.test(text) && href) {
      const parts = href.split('/').filter(Boolean);
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
  const m = url.match(/\/manga\/([^/]+)\/([^/]+)\/?/);
  if (!m) return null;
  return { id: m[1], slug: m[2] };
}

export function parseChapterUrl(url) {
  const m = url.match(/\/leer\/([^/]+)\/([^/]+)\/([^/]+)\/?/);
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

  facts.autor = dedupeNames(facts.autor);
  facts.dibujo = dedupeNames(facts.dibujo);

  const sinopsis = $('#sinopsis p').text().trim() || $('section:has(h2:contains("Sinopsis")) p').text().trim();

  const chapters = [];
  $('#chapterList a.lc-chapter-row, a.lc-chapter-row[href*="/leer/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const num = $(el).find('.n').text().trim() || $(el).text().trim();
    const date = $(el).find('.d').text().trim();
    if (href) chapters.push({ title: num, url: href, date });
  });

  const info = parseMangaUrl(mangaUrl) || {};
  return { title, cover, altTitles, genres, themes, facts, sinopsis, chapters: preferWholeChapters(chapters), ...info, url: mangaUrl };
}

