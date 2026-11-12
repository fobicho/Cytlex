export default function createSource({ fetchText, parse }) {
  const base = 'https://onfmangas.com';
  let onfCookie = '';

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
          for (const [key, nested] of Object.entries(parsed)) {
            if (!/(?:pages?|images?|reader|chapter|data|result|items)/i.test(key)) continue;
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

  const imageUrl = (page, depth = 0) => {
    if (typeof page === 'string') return page;
    if (!page || typeof page !== 'object' || depth > 4) return '';
    if (Array.isArray(page)) return page.map((item) => imageUrl(item, depth + 1)).find(Boolean) || '';

    const preferredKeys = [
      'url', 'src', 'image', 'img', 'source', 'original', 'fallback',
      'srcUrl', 'pageUrl', 'imageUrl', 'image_url', 'src_url', 'img_url',
      'fileUrl', 'file_url', 'originalUrl', 'original_url', 'webp', 'path', 'file'
    ];
    for (const key of preferredKeys) {
      const value = page[key];
      const found = typeof value === 'string' ? value : imageUrl(value, depth + 1);
      if (found) return found;
    }

    for (const [key, value] of Object.entries(page)) {
      if (!/(?:url|src|image|img|file|page|original|fallback|webp|path)/i.test(key)) continue;
      const found = typeof value === 'string' ? value : imageUrl(value, depth + 1);
      if (found) return found;
    }
    return '';
  };

  function isCookieChallenge(html) {
    return html.slice(0, 8192).includes('Verificando');
  }

  function solveCookieChallenge(html) {
    const script = parse(html).querySelector('script')?.textContent?.trim();
    if (!script) return Promise.resolve('');

    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'display:none';
    const id = `onf-${Date.now()}-${Math.random()}`;
    const scriptLiteral = JSON.stringify(script).replace(/</g, '\\u003c');

    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        frame.remove();
        resolve(value);
      };
      const onMessage = (event) => {
        if (event.source !== frame.contentWindow || event.data?.id !== id) return;
        finish(typeof event.data.cookie === 'string' ? event.data.cookie : '');
      };
      const timeout = setTimeout(() => finish(''), 3000);
      window.addEventListener('message', onMessage);
      frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><script>(()=>{try{const source=${scriptLiteral};const run=new Function('window','document','location','setTimeout',source+'\\n;return document.cookie;');const cookie=run({location:{}},{cookie:null},{},fn=>fn());parent.postMessage({id:${JSON.stringify(id)},cookie},'*')}catch(error){parent.postMessage({id:${JSON.stringify(id)},error:String(error)},'*')}})();</script>`;
      (document.body || document.documentElement).append(frame);
    }).then((raw) => {
      const cookie = String(raw || '').split(';', 1)[0].trim();
      return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+=[A-Za-z0-9!#$%&'()*+,.\/:=?@_`|~-]{1,2048}$/.test(cookie) ? cookie : '';
    });
  }

  function assignedPagePayloads(html) {
    const payloads = [];
    const names = /(?:window\.)?(?:_hexP|[\w$]*(?:pages|images|pagelist|imagelist|pagedata|imagedata))\s*=/ig;
    let match;
    while ((match = names.exec(html))) {
      let index = names.lastIndex;
      while (/\s/.test(html[index] || '')) index += 1;
      const first = html[index];
      if (first === '"' || first === "'" || first === '`') {
        const quote = first;
        const start = ++index;
        let escaped = false;
        for (; index < html.length; index += 1) {
          const char = html[index];
          if (!escaped && char === quote) break;
          if (!escaped && char === '\\') escaped = true;
          else escaped = false;
        }
        if (index < html.length) payloads.push(html.slice(start, index));
      } else if (/^atob\s*\(/i.test(html.slice(index))) {
        const encoded = html.slice(index).match(/^atob\s*\(\s*(["'`])([\s\S]*?)\1\s*\)/i);
        if (encoded) payloads.push(encoded[2]);
      } else if (first === '[' || first === '{') {
        const start = index;
        const stack = [];
        let quote = '';
        let escaped = false;
        for (; index < html.length; index += 1) {
          const char = html[index];
          if (quote) {
            if (!escaped && char === quote) quote = '';
            if (!escaped && char === '\\') escaped = true;
            else escaped = false;
            continue;
          }
          if (char === '"' || char === "'") { quote = char; continue; }
          if (char === '[' || char === '{') stack.push(char);
          else if (char === ']' || char === '}') {
            stack.pop();
            if (!stack.length) { payloads.push(html.slice(start, index + 1)); break; }
          }
        }
      }
      names.lastIndex = Math.max(names.lastIndex, index + 1);
    }
    return payloads;
  }

  const imageElementUrl = (image) => {
    if (!image) return '';
    for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-srcset', 'srcset', 'src']) {
      const raw = (image.getAttribute(attr) || '').trim();
      const value = ['data-srcset', 'srcset'].includes(attr)
        ? raw.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || ''
        : raw;
      if (!value || /^(?:data:|javascript:|about:|#)/i.test(value)
        || /(?:placeholder|default|blank|spacer|pixel)\.(?:gif|png)(?:[?#]|$)/i.test(value)) continue;
      return abs(value);
    }
    return '';
  };

  const decodePageImages = (html, outer, chapterUrl) => {
    const viewer = outer.querySelector('#viewerContainer, #reader, #manga-reader, .viewer-container, .reader-container, .manga-pages, .chapter-reader');
    const payloadNode = outer.querySelector('[data-reader-pages], [data-page-list], [data-pages], [data-images], [data-pages-json], [data-chapter-pages], [data-image-list]');
    const encodedPages = viewer?.getAttribute('data-reader-pages')
      || viewer?.getAttribute('data-pages')
      || viewer?.getAttribute('data-images')
      || payloadNode?.getAttribute('data-reader-pages')
      || payloadNode?.getAttribute('data-page-list')
      || payloadNode?.getAttribute('data-pages')
      || payloadNode?.getAttribute('data-images')
      || payloadNode?.getAttribute('data-pages-json')
      || payloadNode?.getAttribute('data-chapter-pages')
      || payloadNode?.getAttribute('data-image-list');

    let pageList = decodePageList(encodedPages);
    if (!pageList) {
      for (const script of outer.querySelectorAll('script[type="application/json"]')) {
        const payload = script.textContent || '';
        if (!payload.includes('"src"')) continue;
        pageList = decodePageList(payload);
        if (pageList) break;
      }
    }
    if (!pageList) {
      for (const payload of assignedPagePayloads(html)) {
        pageList = decodePageList(payload);
        if (pageList) break;
      }
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

    // ONF has changed the reader wrapper more than once; its page images still
    // use the same CDN, so use those URLs if the wrapper selectors disappear.
    const cdnImages = [...outer.querySelectorAll('img')]
      .map(imageSource)
      .map((value) => value.split(',')[0].trim().split(/\s+/)[0])
      .map(resolvePageUrl)
      .filter((value) => {
        try { return new URL(value).hostname === 'd33y4i2dmzjqjh.cloudfront.net'; } catch { return false; }
      });
    if (cdnImages.length) return [...new Set(cdnImages)];

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
          cover: imageElementUrl(img),
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
      cover: imageElementUrl(coverImg),
      altTitles: '',
      genres,
      facts: { estado: '', status: '', tipo: '', autor: '', vistas: '' },
      sinopsis: desc.trim(),
      chapters: decodeChapters(html)
    };
  }

  async function chapter(chapterUrl) {
    const url = abs(chapterUrl);
    const requestOptions = { onfCookie, onfReferer: url };
    let html = await fetchText(url, undefined, requestOptions);
    if (isCookieChallenge(html)) {
      onfCookie = await solveCookieChallenge(html);
      if (!onfCookie) throw new Error('ONF solicitó una verificación anti-bot, pero Cytlex no pudo obtener la cookie de acceso. Inténtalo de nuevo más tarde.');
      html = await fetchText(url, undefined, { onfCookie, onfReferer: url });
    }
    const outer = parse(html);
    const pages = decodePageImages(html, outer, url);
    if (!pages.length) {
      const challengeMarkup = /cf-chl-|__cf_chl|challenge-platform|cdn-cgi\/challenge|cloudflare ray id|verificando/i.test(html);
      const visibleText = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ');
      const challengePhrase = visibleText.match(/(?:complete|solve|enter|verify|resuelve|completa|verifica)[^.!?]{0,48}captcha|captcha[^.!?]{0,48}(?:complete|solve|enter|verify|resuelve|completa|verifica)|verify (?:that )?you are human|checking your browser|just a moment|attention required|enable javascript and cookies|access denied|too many requests|demasiadas solicitudes|acceso temporalmente bloqueado|verificaci[oó]n de seguridad|security check|verificando/i);
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
