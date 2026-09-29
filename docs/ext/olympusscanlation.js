export default function createSource({ fetchText }) {
  const base = 'https://olympusxyz.com';
  const panel = 'https://panel.olympusxyz.com';
  const LIMIT_PAGES = 200;

  const getJson = async (url) => JSON.parse(await fetchText(url));
  const isComic = (s) => (s.type || 'comic').toLowerCase() === 'comic';

  const toItem = (s) => ({
    url: `${base}/series/${s.slug}`,
    title: s.name || '',
    cover: s.cover || '',
    type: s.type || 'comic'
  });

  const comicsOf = (data) => {
    const list = data?.data || [];
    const comics = list.filter(isComic);
    return comics.length ? comics : list;
  };

  async function catalog({ q = '', page = 1 } = {}) {
    if (q) {
      const data = await getJson(`${base}/api/series/list`);
      const items = comicsOf(data)
        .filter((s) => (s.name || '').toLowerCase().includes(q.toLowerCase()))
        .map(toItem);
      return { items, totalPages: 1, totalText: '' };
    }

    const data = await getJson(`${base}/api/rankings?page=${page}&period=total_ranking`);
    const items = comicsOf(data).map(toItem);
    const last = data?.last_page || data?.meta?.last_page || 0;
    const totalPages = last || (data?.next_page_url ? page + 1 : page);
    return { items, totalPages, totalText: '' };
  }

  async function detail(mangaUrl) {
    const slug = String(mangaUrl).split('/').filter(Boolean).pop();
    const chaptersUrl = (p) => `${panel}/api/series/${slug}/chapters?page=${p}&direction=desc&type=comic`;

    const [data, first] = await Promise.all([
      getJson(`${base}/api/series/${slug}?type=comic`),
      getJson(chaptersUrl(1))
    ]);
    const s = data?.data || {};

    const lastPage = Math.min(first?.meta?.last_page || 1, LIMIT_PAGES);
    const rest = lastPage > 1
      ? await Promise.all(Array.from({ length: lastPage - 1 }, (_, i) => getJson(chaptersUrl(i + 2))))
      : [];

    const chapters = [first, ...rest]
      .flatMap((res) => res?.data || [])
      .map((c) => ({
        url: `${base}/capitulo/${slug}/${c.id}`,
        title: c.name ? `Capítulo ${c.name}` : `Capítulo ${c.id}`,
        date: c.published_at || ''
      }));

    const status = s.status?.name || '';
    return {
      title: s.name || '',
      cover: s.cover || '',
      altTitles: '',
      genres: [...(s.genres || [])].map((g) => g.name).filter(Boolean),
      facts: { estado: status, status, tipo: s.type || '', autor: s.team?.name || '', vistas: '' },
      sinopsis: (s.summary || '').trim(),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const parts = String(chapterUrl).split('/').filter(Boolean);
    const id = parts.pop();
    const slug = parts.pop();
    const data = await getJson(`${base}/api/capitulo/comic-${slug}/${id}`);
    const ch = data?.chapter || {};
    return {
      label: ch.name ? `Capítulo ${ch.name}` : '',
      mangaUrl: `${base}/series/${slug}`,
      pages: (ch.pages || []).filter(Boolean),
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'olympusscanlation', name: 'Olympus Scanlation', catalog, detail, chapter };
}
