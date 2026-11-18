export default function createSource({ fetchText, parse }) {
  const base = 'https://achymanga.online';
  const imageHost = 'cdn.achymanga.online';
  const readableTypes = new Set(['manga', 'manhwa', 'manhua', 'webtoon', 'comic', 'one_shot', 'doujinshi', 'oel']);

  const absolute = (value) => {
    if (!value) return '';
    try { return new URL(value, base).href; } catch { return ''; }
  };

  const text = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();

  function assertPublicPage(doc) {
    const title = text(doc.querySelector('title'));
    if (/just a moment|attention required/i.test(title) || doc.querySelector('#challenge-form, #cf-challenge-running')) {
      throw new Error('AchyManga presentó una verificación de Cloudflare. No se intentó resolverla.');
    }
  }

  function selectOptions(doc, name) {
    return [...doc.querySelectorAll(`select[name="${name}"] option`)]
      .map((option) => ({ value: option.value, label: text(option) }))
      .filter((option) => option.label);
  }

  function mapCards(doc) {
    return [...doc.querySelectorAll('a[data-series-card="true"]')]
      .map((card) => {
        const type = card.getAttribute('data-tipo') || '';
        const url = absolute(card.getAttribute('data-url') || card.getAttribute('href'));
        const title = card.getAttribute('data-title') || text(card);
        if (!url || !title || !readableTypes.has(type)) return null;
        return {
          url,
          title,
          cover: absolute(card.getAttribute('data-cover')),
          author: card.getAttribute('data-author') || '',
          type,
          lastChapter: card.getAttribute('data-ultimo') || card.getAttribute('data-caps') || ''
        };
      })
      .filter(Boolean);
  }

  async function catalog({
    q = '', genero = '', demografia = '', estado = '', tipo = '', idioma = 'es', orden = 'titulo'
  } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, genero, demografia, estado, tipo, idioma, orden })) {
      if (value) params.set(key, String(value));
    }
    const doc = parse(await fetchText(`${base}/catalogo?${params}`));
    assertPublicPage(doc);
    const items = mapCards(doc);
    return { items, totalPages: 1, totalText: items.length ? String(items.length) : '' };
  }

  async function catalogFilters() {
    const doc = parse(await fetchText(`${base}/catalogo`));
    assertPublicPage(doc);
    return [
      { id: 'genero', label: 'Género', type: 'select', options: selectOptions(doc, 'genero') },
      { id: 'demografia', label: 'Demografía', type: 'select', options: selectOptions(doc, 'demografia') },
      { id: 'estado', label: 'Estado', type: 'select', options: selectOptions(doc, 'estado') },
      { id: 'tipo', label: 'Tipo', type: 'select', options: selectOptions(doc, 'tipo').filter((option) => !option.value || readableTypes.has(option.value)) },
      { id: 'idioma', label: 'Idioma', type: 'select', defaultValue: 'es', options: selectOptions(doc, 'idioma') },
      { id: 'orden', label: 'Orden', type: 'select', options: selectOptions(doc, 'orden') }
    ];
  }

  function chapterOptions(doc, mangaUrl) {
    const manga = new URL(mangaUrl, base);
    const prefix = `${manga.origin}${manga.pathname.replace(/\/+$/, '')}/capitulo-`;
    const seen = new Set();
    return [...doc.querySelectorAll('a[href*="/capitulo-"]')]
      .map((anchor) => {
        const url = absolute(anchor.getAttribute('href'));
        if (!url || !url.startsWith(prefix) || seen.has(url)) return null;
        seen.add(url);
        const label = text(anchor.querySelector('span')) || text(anchor);
        const num = Number(anchor.getAttribute('data-num') || label.match(/[\d.]+/)?.[0] || url.match(/capitulo-([\d.]+)/)?.[1]);
        return { url, title: label || `Capítulo ${num}`, num };
      })
      .filter(Boolean)
      .sort((a, b) => (Number.isFinite(a.num) ? a.num : Infinity) - (Number.isFinite(b.num) ? b.num : Infinity));
  }

  async function detail(mangaUrl) {
    const url = absolute(mangaUrl);
    const doc = parse(await fetchText(url));
    assertPublicPage(doc);
    const heading = doc.querySelector('h1');
    const title = text(heading) || text(doc.querySelector('title')).split('—')[0].trim();
    const cover = doc.querySelector('.cover-box img[alt], main img[alt]') || doc.querySelector('.cover-box img');
    const synopsis = text(doc.querySelector('#sinopsis'));
    const author = text(heading?.parentElement?.querySelector('p'));
    const genres = [...doc.querySelectorAll('a[href*="genero="]')].map(text).filter(Boolean);
    const chapters = chapterOptions(doc, url).map(({ url: chapterUrl, title: chapterTitle, num }) => ({
      url: chapterUrl,
      title: chapterTitle,
      num
    }));

    return {
      title,
      cover: absolute(cover?.getAttribute('src')),
      altTitles: text(heading?.parentElement?.querySelector('p[title]')),
      genres,
      facts: { autor: author, estado: '', status: '', tipo: '', vistas: '' },
      sinopsis: synopsis,
      chapters
    };
  }

  function decodePages(doc) {
    const manifest = JSON.parse(doc.querySelector('#datos-manifiesto-d')?.textContent || '{}');
    const script = [...doc.querySelectorAll('script:not([src])')]
      .map((element) => element.textContent || '')
      .find((value) => value.includes('function decryptD') && value.includes('CLAVE_XOR')) || '';
    const keyMatch = script.match(/\bconst\s+CLAVE_XOR\s*=\s*(["'])(.*?)\1/s);
    if (!manifest.d || !keyMatch?.[2]) return [];

    let encoded = String(manifest.d).replace(/-/g, '+').replace(/_/g, '/');
    encoded += '='.repeat((4 - encoded.length % 4) % 4);
    const binary = atob(encoded);
    const key = new TextEncoder().encode(keyMatch[2]);
    const decoded = Uint8Array.from(binary, (character, index) => character.charCodeAt(0) ^ key[index % key.length]);
    const result = JSON.parse(new TextDecoder().decode(decoded));
    if (!Array.isArray(result)) return [];

    return result.map(absolute).filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === imageHost;
      } catch {
        return false;
      }
    });
  }

  async function chapter(chapterUrl) {
    const url = absolute(chapterUrl);
    const doc = parse(await fetchText(url));
    assertPublicPage(doc);
    let pages = [];
    try { pages = decodePages(doc); } catch {}
    if (!pages.length) throw new Error('AchyManga no publicó páginas legibles para este capítulo.');

    const mangaUrl = url.replace(/\/capitulo-[^/]+\/?(?:\?.*)?$/, '');
    const options = chapterOptions(doc, mangaUrl);
    const currentIndex = options.findIndex((option) => option.url === url);
    const current = currentIndex >= 0 ? options[currentIndex] : null;
    const previous = currentIndex > 0 ? options[currentIndex - 1] : null;
    const next = currentIndex >= 0 ? options[currentIndex + 1] || null : null;

    return {
      label: current?.title || `Capítulo ${url.match(/capitulo-([\d.]+)/)?.[1] || ''}`,
      mangaUrl,
      pages,
      pageTransforms: pages.map((page) => (/[?&]s=1\b|_s\.webp/i.test(page) ? 'scramble-4x4' : '')),
      imageReferer: url,
      options: options.map(({ url: optionUrl, title: optionTitle }) => ({ url: optionUrl, title: optionTitle })),
      prev: previous ? { title: previous.title, url: previous.url } : null,
      next: next ? { title: next.title, url: next.url } : null
    };
  }

  return { id: 'achymanga', name: 'AchyManga', catalog, catalogFilters, detail, chapter };
}
