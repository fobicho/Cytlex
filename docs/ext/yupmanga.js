export default function createSource({ fetchText, fetchPostText, parse }) {
  const base = 'https://www.yupmanga.com';
  const requestInterval = 1000;
  const chapterPageLimit = 100;
  const mangaCache = new Map();
  let requestQueue = Promise.resolve();
  let lastRequestAt = 0;

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absolute = (value, referer = base) => {
    try { return new URL(value, referer).href; } catch { return ''; }
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function scheduleRequest(run) {
    const request = requestQueue.then(async () => {
      const wait = requestInterval - (Date.now() - lastRequestAt);
      if (wait > 0) await delay(wait);
      lastRequestAt = Date.now();
      return run();
    });
    requestQueue = request.catch(() => {});
    return request;
  }

  function get(url, requestId, referer = `${base}/`, extraHeaders = {}) {
    return scheduleRequest(() => fetchText(url, requestId, {
      headers: {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        Referer: referer,
        ...extraHeaders
      }
    }));
  }

  function postForm(path, values, requestId, referer) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) body.set(key, String(value));
    return scheduleRequest(() => fetchPostText({
      url: `${base}${path}`,
      body: body.toString(),
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: base,
        Referer: referer
      }
    }, requestId));
  }

  function parseJson(raw, context) {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch {
      if (/cloudflare|attention required|challenge-platform/i.test(String(raw || ''))) {
        throw new Error('YupManga respondió con una verificación de Cloudflare.');
      }
      throw new Error(`YupManga devolvió una respuesta no válida al ${context}.`);
    }
  }

  function mangaIdFromUrl(value) {
    try { return new URL(value, base).searchParams.get('id') || ''; } catch { return ''; }
  }

  function chapterUrl(seriesId, chapterKey) {
    const url = new URL('/series.php', base);
    url.searchParams.set('id', seriesId);
    url.searchParams.set('chapter', chapterKey);
    return url.href;
  }

  function seriesFromCard(card) {
    const anchor = card.querySelector('a[href*="series.php?id="]') || card.querySelector('a[href]');
    const href = anchor?.getAttribute('href') || '';
    const id = mangaIdFromUrl(absolute(href));
    const title = clean(card.querySelector('h3, h2')?.textContent
      || card.querySelector('img[alt]')?.getAttribute('alt')
      || anchor?.getAttribute('title')
      || anchor?.textContent);
    if (!id || !title) return null;
    const image = card.querySelector('img');
    const cover = absolute(image?.getAttribute('data-src') || image?.getAttribute('data-lazy-src')
      || image?.getAttribute('src') || image?.getAttribute('content'));
    const chapterText = clean(card.textContent).match(/(?:cap[ií]tulo|chapter)\s*([\d.,]+)/i)?.[1] || '';
    return {
      url: `${base}/series.php?id=${encodeURIComponent(id)}`,
      title,
      cover,
      type: 'Manga',
      lastChapter: chapterText
    };
  }

  function catalogHasNext(doc, page) {
    return [...doc.querySelectorAll('a[href]')].some((anchor) => {
      const label = clean(anchor.textContent).toLocaleLowerCase('es');
      if (/^(siguiente|siguiente »|next|›|→)$/.test(label) || anchor.getAttribute('rel') === 'next') return true;
      try { return Number(new URL(anchor.href, base).searchParams.get('page')) > page; } catch { return false; }
    });
  }

  async function catalog({ q = '', page = 1, sort = '', __cytlexRequestId } = {}) {
    const query = clean(q);
    const currentPage = Math.max(1, Number(page) || 1);
    if (query && query.length < 3) throw new Error('YupManga requiere al menos 3 caracteres para buscar.');

    const target = new URL(query ? '/search.php' : sort === 'rating' || sort === 'views' ? '/top' : '/', base);
    if (query) target.searchParams.set('q', query);
    target.searchParams.set('page', String(currentPage));
    const html = await get(target.href, __cytlexRequestId);
    const doc = parse(html);
    const items = [...doc.querySelectorAll('div.comic-card')]
      .map(seriesFromCard)
      .filter(Boolean)
      .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);
    const hasMore = catalogHasNext(doc, currentPage);
    return {
      items,
      totalPages: hasMore ? currentPage + 1 : currentPage,
      totalText: ''
    };
  }

  function parseChapterCards(html, seriesId) {
    const doc = parse(html);
    return [...doc.querySelectorAll('div.comic-card')].map((card) => {
      const anchor = card.querySelector('a[data-chapter-key]') || card.querySelector('a[href]');
      const key = clean(anchor?.getAttribute('data-chapter-key')
        || card.getAttribute('data-chapter-key')
        || anchor?.getAttribute('href')?.match(/[?&](?:chapter_key|chapter)=([\d.]+)/i)?.[1]);
      const title = clean(card.querySelector('h3, h2')?.textContent || anchor?.textContent);
      if (!/^\d+(?:\.\d+)?$/.test(key) || !title) return null;
      return {
        title,
        url: chapterUrl(seriesId, key),
        date: clean(card.querySelector('time[datetime]')?.getAttribute('datetime')
          || card.querySelector('time')?.textContent),
        chapterNumber: Number.parseFloat(key)
      };
    }).filter(Boolean);
  }

  async function fetchChapters(seriesId, seriesUrl, requestId) {
    const chapters = [];
    for (let page = 1; page <= chapterPageLimit; page += 1) {
      const endpoint = new URL('/ajax/load_chapters.php', base);
      endpoint.search = new URLSearchParams({
        series_id: seriesId,
        page: String(page),
        order: 'oldest_first'
      }).toString();
      const raw = await get(endpoint.href, requestId, seriesUrl, { 'X-Requested-With': 'XMLHttpRequest' });
      const data = parseJson(raw, 'cargar capítulos');
      const pageChapters = parseChapterCards(data?.html || '', seriesId);
      chapters.push(...pageChapters);
      const current = Number(data?.currentPage) || page;
      const total = Number(data?.totalPages) || current;
      if (current >= total || pageChapters.length === 0) break;
    }
    const unique = [...new Map(chapters.map((item) => [item.url, item])).values()]
      .sort((a, b) => a.chapterNumber - b.chapterNumber);
    return unique.map(({ chapterNumber, ...item }) => item);
  }

  function rememberManga(seriesId, manga) {
    mangaCache.delete(seriesId);
    mangaCache.set(seriesId, manga);
    if (mangaCache.size > 60) mangaCache.delete(mangaCache.keys().next().value);
  }

  function statusFrom(text) {
    const status = clean(text).toLocaleLowerCase('es');
    if (status.includes('finaliz')) return 'Finalizado';
    if (status.includes('activo') || status.includes('public')) return 'En curso';
    if (status.includes('paus')) return 'En pausa';
    if (status.includes('abandon')) return 'Abandonado';
    return clean(text);
  }

  async function detail(url, requestId) {
    const seriesId = mangaIdFromUrl(url);
    if (!seriesId) throw new Error('No se pudo identificar la serie de YupManga.');
    const seriesUrl = `${base}/series.php?id=${encodeURIComponent(seriesId)}`;
    const html = await get(seriesUrl, requestId);
    const doc = parse(html);
    const container = doc.querySelector('main > div.container') || doc;
    const title = clean(container.querySelector('h1')?.textContent
      || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || doc.title);
    if (!title) throw new Error('YupManga no entregó el título de la serie.');

    const chapters = await fetchChapters(seriesId, seriesUrl, requestId);
    const cover = absolute(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || container.querySelector('img.object-cover, img[class*="cover" i]')?.getAttribute('src'));
    const genres = [...container.querySelectorAll('a.genre-tag')].map((item) => clean(item.textContent)).filter(Boolean);
    const statusText = clean(container.querySelector('span:has(i[title="Estado"])')?.textContent);
    const editorial = clean(container.querySelector('i[title="Editorial"]')?.parentElement?.textContent)
      .replace(/^(?:editorial)\s*/i, '');
    const type = clean(container.querySelector('i[title*="Tipo" i]')?.parentElement?.textContent)
      .replace(/^(?:tipo)\s*/i, '') || 'Manga';
    const synopsis = clean(container.querySelector('p#synopsisText')?.textContent
      || container.querySelector('[itemprop="description"]')?.textContent
      || doc.querySelector('meta[property="og:description"]')?.getAttribute('content'));
    const manga = {
      title,
      cover,
      genres,
      facts: {
        estado: statusFrom(statusText),
        status: statusFrom(statusText),
        tipo: type,
        editorial,
        capítulos: String(chapters.length)
      },
      sinopsis: synopsis,
      chapters
    };
    rememberManga(seriesId, { url: seriesUrl, title, chapters });
    return manga;
  }

  function challengeStyles(doc) {
    const css = [...doc.querySelectorAll('style')]
      .map((style) => style.textContent || '')
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const declarations = [];
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    rules.forEach((rule, index) => {
      const properties = rule[2].split(';').map((entry) => {
        const match = entry.split(':');
        if (match.length < 2) return null;
        const value = match.slice(1).join(':').trim();
        return {
          name: match[0].trim().toLowerCase(),
          value: value.replace(/\s*!important\s*/i, '').trim(),
          important: /!important/i.test(value)
        };
      }).filter((property) => property?.name && property.value);
      for (const rawSelector of rule[1].split(',')) {
        const selector = rawSelector.trim().match(/^#([\w-]+)\s*>?\s*([a-z]*)((?:\.[\w-]+)+)$/i);
        if (!selector) continue;
        declarations.push({
          id: selector[1],
          tag: selector[2].toLowerCase(),
          classes: selector[3].split('.').filter(Boolean),
          properties,
          index
        });
      }
    });

    const result = {};
    for (const target of doc.querySelectorAll('[id]')) {
      const matchingRules = declarations.filter((rule) => rule.id === target.id);
      if (!matchingRules.length) continue;
      result[target.id] = {
        children: [...target.children].map((child) => {
          const classes = [...child.classList];
          const matches = matchingRules.filter((rule) => (!rule.tag || rule.tag === child.tagName.toLowerCase())
            && rule.classes.every((name) => classes.includes(name)));
          const winners = new Map();
          for (const rule of matches) {
            const specificity = rule.classes.length * 10 + (rule.tag ? 1 : 0);
            for (const property of rule.properties) {
              const previous = winners.get(property.name);
              const priority = [Number(property.important), specificity, rule.index];
              if (!previous || priority[0] > previous.priority[0]
                || (priority[0] === previous.priority[0] && priority[1] > previous.priority[1])
                || (priority[0] === previous.priority[0] && priority[1] === previous.priority[1] && priority[2] >= previous.priority[2])) {
                winners.set(property.name, { value: property.value, priority });
              }
            }
          }
          return { style: Object.fromEntries([...winners].map(([name, item]) => [name, item.value])) };
        })
      };
    }
    return result;
  }

  function solveChallenge(challengeJs, doc) {
    const dom = challengeStyles(doc);
    try {
      const evaluate = new Function('dom', `
        const defaults = { order: '0', 'flex-grow': '0', 'flex-shrink': '1' };
        function node(value) {
          return { children: (value.children || []).map(node), style: value.style || {} };
        }
        const document = { getElementById: (id) => dom[id] ? node(dom[id]) : null };
        const window = {
          getComputedStyle: (element) => ({
            getPropertyValue: (property) => Object.prototype.hasOwnProperty.call(element.style, property)
              ? element.style[property]
              : (defaults[property] || '')
          })
        };
        window.document = document;
        return (function () { ${challengeJs} }).call(window);
      `);
      const answer = evaluate(dom);
      if (answer == null || answer === '') throw new Error('El desafío no devolvió una respuesta.');
      return String(answer);
    } catch (error) {
      throw new Error(`No se pudo resolver el desafío de YupManga: ${clean(error?.message || error)}`);
    }
  }

  async function completeInterstitial(html, readerUrl, chapterId, requestId) {
    const ticketMatch = String(html).match(/adTicket\s*=\s*(\{[^}]*\})/);
    if (!ticketMatch) return false;
    let ticket;
    try { ticket = JSON.parse(ticketMatch[1]); } catch { return false; }
    if (!ticket?.chapter || !ticket?.nonce) return false;
    const countdown = Number(String(html).match(/let\s+countdown\s*=\s*(\d+)/)?.[1]) || 8;
    await delay(Math.min(countdown, 30) * 1000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await postForm('/ajax/complete_ad_interstitial.php', {
          identifier: 'chapter_entrance',
          chapter: ticket.chapter,
          nonce: ticket.nonce
        }, requestId, readerUrl);
        return true;
      } catch (error) {
        if (error?.status !== 409 || attempt === 2) throw error;
        await delay(1500);
      }
    }
    return false;
  }

  async function chapter(url, requestId) {
    const parsed = new URL(url, base);
    const seriesId = parsed.searchParams.get('id') || '';
    const chapterKey = parsed.searchParams.get('chapter') || '';
    if (!seriesId || !/^\d+(?:\.\d+)?$/.test(chapterKey)) {
      throw new Error('No se pudo identificar la serie y el capítulo de YupManga.');
    }

    const seriesUrl = `${base}/series.php?id=${encodeURIComponent(seriesId)}`;
    const seriesHtml = await get(seriesUrl, requestId);
    const seriesDoc = parse(seriesHtml);
    const challenge = parseJson(await postForm('/ajax/get_challenge.php', {
      chapter_key: chapterKey,
      s: seriesId
    }, requestId, seriesUrl), 'preparar el capítulo');
    if (!challenge?.success || !challenge.challenge_id || !challenge.challenge_js) {
      throw new Error('YupManga no proporcionó el desafío necesario para abrir el capítulo.');
    }

    const answer = solveChallenge(challenge.challenge_js, seriesDoc);
    let access;
    try {
      access = parseJson(await postForm('/ajax/open_chapter.php', {
        chapter_key: chapterKey,
        s: seriesId,
        challenge_id: challenge.challenge_id,
        answer
      }, requestId, seriesUrl), 'abrir el capítulo');
    } catch (error) {
      if (error?.status === 429) throw new Error('YupManga alcanzó el límite de lecturas para visitantes. Inténtalo más tarde.');
      throw error;
    }
    if (!access?.success || !access.token || !access.chapter_id) {
      throw new Error(access?.error || access?.message || 'YupManga no autorizó la lectura de este capítulo.');
    }

    const reader = new URL('/reader_v2.php', base);
    reader.search = new URLSearchParams({ chapter: access.chapter_id, token: access.token, page: '1' }).toString();
    const readerUrl = reader.href;
    let readerHtml = await get(readerUrl, requestId, seriesUrl);
    if (/adTicket\s*=/.test(readerHtml)) {
      await completeInterstitial(readerHtml, readerUrl, access.chapter_id, requestId);
      readerHtml = await get(readerUrl, requestId, seriesUrl);
    }
    if (/cloudflare|attention required|challenge-platform/i.test(readerHtml) && !/totalPages\s*[:=]/i.test(readerHtml)) {
      throw new Error('YupManga respondió con una verificación de Cloudflare al abrir el capítulo.');
    }
    const scripts = [...parse(readerHtml).querySelectorAll('script')].map((script) => script.textContent || '').join('\n');
    const totalPages = Number((scripts + '\n' + readerHtml).match(/(?:readerApp\.)?totalPages\s*[:=]\s*(\d+)/i)?.[1]) || 0;
    if (!totalPages) throw new Error('YupManga no indicó cuántas páginas tiene el capítulo.');

    const remembered = mangaCache.get(seriesId);
    const options = remembered?.chapters || await fetchChapters(seriesId, seriesUrl, requestId);
    rememberManga(seriesId, { url: seriesUrl, title: remembered?.title || '', chapters: options });
    const index = options.findIndex((item) => new URL(item.url).searchParams.get('chapter') === chapterKey);
    const imageBase = new URL('/image-proxy-v2.php', base);
    const pages = Array.from({ length: totalPages }, (_, pageIndex) => {
      imageBase.search = new URLSearchParams({
        chapter: access.chapter_id,
        page: String(pageIndex + 1),
        token: access.token,
        context: 'reader'
      }).toString();
      return imageBase.href;
    });
    return {
      label: options[index]?.title || `Capítulo ${chapterKey}`,
      mangaUrl: seriesUrl,
      imageReferer: readerUrl,
      pages,
      options,
      prev: index > 0 ? options[index - 1] : null,
      next: index >= 0 && index + 1 < options.length ? options[index + 1] : null
    };
  }

  return { id: 'yupmanga', name: 'YupManga', catalog, detail, chapter };
}
