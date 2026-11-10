export default function createSource({ fetchText, parse }) {
  const base = 'https://onfmangas.com';

  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };

  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  function decodePageList(value) {
    if (!value || typeof value !== 'string') return null;
    const raw = value.trim();
    const candidates = [raw];
    const compact = raw.replace(/\s+/g, '');

    if (/^(?:[0-9a-f]{2})+$/i.test(compact)) {
      const bytes = Uint8Array.from(compact.match(/.{2}/g) || [], (byte) => parseInt(byte, 16));
      candidates.push(new TextDecoder().decode(bytes));
    }
    try {
      const base64 = compact.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(compact.length / 4) * 4, '=');
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      candidates.push(new TextDecoder().decode(bytes));
    } catch {}

    const asPageList = (candidate) => {
      try {
        let parsed = candidate;
        for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth += 1) parsed = JSON.parse(parsed);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
          for (const key of ['pages', 'images', 'readerPages', 'data']) {
            const nested = parsed[key];
            if (Array.isArray(nested)) return nested;
            if (nested && (typeof nested === 'object' || typeof nested === 'string')) {
              const list = asPageList(nested);
              if (list) return list;
            }
          }
        }
      } catch {}
      return null;
    };

    for (const candidate of candidates) {
      const list = asPageList(candidate);
      if (list) return list;
    }
    return null;
  }

  const imageUrl = (page) => {
    if (typeof page === 'string') return page;
    if (!page || typeof page !== 'object') return '';
    return page.url || page.src || page.image || page.srcUrl || page.pageUrl
      || page.imageUrl || page.image_url || page.src_url || page.path || page.file || '';
  };

  const decodePageImages = (html, outer, chapterUrl) => {
    const viewer = outer.querySelector('#viewerContainer, #reader, #manga-reader, .viewer-container, .reader-container, .manga-pages, .chapter-reader');
    const encodedPages = viewer?.getAttribute('data-reader-pages')
      || viewer?.getAttribute('data-pages')
      || viewer?.getAttribute('data-images')
      || outer.querySelector('[data-reader-pages], [data-pages], [data-images], [data-pages-json]')?.getAttribute('data-reader-pages')
      || outer.querySelector('[data-reader-pages], [data-pages], [data-images], [data-pages-json]')?.getAttribute('data-pages')
      || outer.querySelector('[data-reader-pages], [data-pages], [data-images], [data-pages-json]')?.getAttribute('data-images')
      || outer.querySelector('[data-pages-json]')?.getAttribute('data-pages-json');

    let pageList = decodePageList(encodedPages);
    if (!pageList) {
      const hexPages = html.match(/\b(?:const|let|var)?\s*(?:window\.)?_hexP\s*=\s*["'`]([0-9a-fA-F\s_-]+)["'`]/i);
      if (hexPages) pageList = decodePageList(hexPages[1]);
    }

    const resolvePageUrl = (value) => {
      if (!value || typeof value !== 'string') return '';
      try {
        const resolved = new URL(value.trim(), chapterUrl);
        return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : '';
      } catch { return ''; }
    };

    const fromPayload = Array.isArray(pageList)
      ? pageList.map(imageUrl).map(resolvePageUrl).filter(Boolean)
      : [];
    if (fromPayload.length) return [...new Set(fromPayload)];

    const imageNodes = outer.querySelectorAll(
      '#viewerContainer img, #reader img, #manga-reader img, .viewer-container img, .reader-container img, .reader-page img, .page-container img, .page-item img, .manga-pages img, .chapter-reader img, img.manga-page, img[data-page-url]'
    );
    const imageSource = (img) => img.getAttribute('data-page-url') || img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.getAttribute('data-original') || img.getAttribute('data-original-src')
      || img.getAttribute('data-srcset') || img.getAttribute('srcset') || img.getAttribute('src') || '';
    const fromImages = [...imageNodes]
      .map((img) => imageSource(img).split(',')[0].trim().split(/\s+/)[0])
      .map(resolvePageUrl)
      .filter(Boolean);
    if (fromImages.length) return [...new Set(fromImages)];

    const noScript = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i)?.[1] || '';
    const fallbackImages = [...parse(noScript).querySelectorAll('img.manga-page')]
      .map(imageSource)
      .map((value) => value.split(',')[0].trim().split(/\s+/)[0])
      .map(resolvePageUrl)
      .filter(Boolean);
    return [...new Set(fallbackImages)];
  };

  function mapCards(doc) {
    return [...doc.querySelectorAll('.manga-card')]
      .map((el) => {
        const a = el.querySelector('a[href]');
        const img = el.querySelector('img');
        return {
          url: abs(a?.getAttribute('href')),
          title: text(el, '.manga-title') || (img?.getAttribute('alt') || '').trim(),
          cover: abs(img?.getAttribute('src') || img?.getAttribute('data-src')),
          author: text(el, '.manga-author, .card-author, .author'),
          type: text(el, '.card-badge')
        };
      })
      .filter((x) => x.url && x.title);
  }

  function decodeChapters(html) {
    const m = html.match(/_hex\s*=\s*"([0-9a-fA-F]+)"/);
    if (!m) return [];
    let list;
    try {
      const decoded = decodeURIComponent(m[1].replace(/(..)/g, '%$1'));
      list = JSON.parse(decoded);
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list
      .map((c) => {
        const num = c.numero != null && c.numero !== '' ? String(parseFloat(c.numero)) : '';
        const group = c.grupo_cap_nombres
          || (c.grupos_list || []).map((g) => g.nombre).filter(Boolean).join(', ')
          || '';
        return {
          url: abs(c.url),
          title: num ? `Capítulo ${num}` : (c.titulo || c.titulo_str || ''),
          group,
          date: c.fecha_str || c.fecha_subida || ''
        };
      })
      .filter((x) => x.url);
  }

  async function catalog({ q = '', __cytlexRequestId } = {}) {
    const url = q ? `${base}/buscar.php?q=${encodeURIComponent(q)}` : `${base}/`;
    const doc = parse(await fetchText(url, __cytlexRequestId));
    return { items: mapCards(doc), totalPages: 1, totalText: '' };
  }

  async function detail(mangaUrl) {
    const html = await fetchText(abs(mangaUrl));
    const doc = parse(html);
    const coverImg = doc.querySelector('img.manga-poster');
    const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    const genres = [...doc.querySelectorAll('.genre-tag')].map((e) => e.textContent.trim()).filter(Boolean);
    return {
      title: text(doc, 'h1.manga-title'),
      cover: abs(coverImg?.getAttribute('src')),
      altTitles: '',
      genres,
      facts: { estado: '', status: '', tipo: '', autor: '', vistas: '' },
      sinopsis: desc.trim(),
      chapters: decodeChapters(html)
    };
  }

  async function chapter(chapterUrl) {
    const url = abs(chapterUrl);
    const html = await fetchText(url);
    const outer = parse(html);
    const pages = decodePageImages(html, outer, url);
    if (!pages.length) {
      const challengeMarkup = /cf-chl-|__cf_chl|challenge-platform|cdn-cgi\/challenge|cloudflare ray id/i.test(html);
      const visibleText = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ');
      const challengePhrase = visibleText.match(/(?:complete|solve|enter|verify|resuelve|completa|verifica)[^.!?]{0,48}captcha|captcha[^.!?]{0,48}(?:complete|solve|enter|verify|resuelve|completa|verifica)|verify (?:that )?you are human|checking your browser|just a moment|attention required|enable javascript and cookies|access denied|too many requests|demasiadas solicitudes|acceso temporalmente bloqueado|verificaci[oó]n de seguridad|security check/i);
      const fullTitle = text(outer, 'title') || text(outer, 'h1');
      const responseTitle = fullTitle.slice(0, 100);
      const challengeTitle = /^(?:just a moment|attention required|security check|access denied|captcha|verify (?:that )?you are human)/i.test(fullTitle);
      const looksLikeOnfChapter = /cap[ií]tulo\s+[\d.]+/i.test(fullTitle) && /onf\s*manga/i.test(fullTitle);
      const blocked = !!challengePhrase || challengeTitle || (challengeMarkup && !looksLikeOnfChapter);
      const responseInfo = [
        challengePhrase?.[0] || (challengeTitle ? 'título de verificación' : challengeMarkup && !looksLikeOnfChapter ? 'marcas de desafío anti-bot' : ''),
        responseTitle && `título: «${responseTitle}»`
      ].filter(Boolean).join('; ');
      throw new Error(blocked
        ? `ONF devolvió una verificación o bloqueo en vez de las páginas del capítulo${responseInfo ? ` (${responseInfo})` : ''}. Inténtalo de nuevo más tarde.`
        : `ONF respondió, pero Cytlex no encontró la lista de páginas del capítulo${responseInfo ? ` (${responseInfo})` : ''}. Puede haber cambiado el formato del lector.`);
    }
    return {
      label: text(outer, 'h1') || '',
      mangaUrl: '',
      imageReferer: url,
      pages: [...new Set(pages)],
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'onfmangas', name: 'ONF Mangas', catalog, detail, chapter };
}
