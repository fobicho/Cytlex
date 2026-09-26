import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, Play, Star, ChevronRight, Search, AlertTriangle, BookOpen } from 'lucide-react';
import { api } from '../lib/api.js';
import { lib } from '../lib/library.js';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Input } from '../components/ui/input.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';

function useQueryUrl() {
  const loc = useLocation();
  return new URLSearchParams(loc.search).get('u') || '';
}

function useSourceId() {
  const loc = useLocation();
  return new URLSearchParams(loc.search).get('s') || 'leercapitulo';
}

export default function Detail() {
  const mangaUrl = useQueryUrl();
  const sourceId = useSourceId();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [fav, setFav] = useState(false);
  const [cats, setCats] = useState([]);
  const [selectedCats, setSelectedCats] = useState([]);
  const [filter, setFilter] = useState('');
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    if (!mangaUrl) return;
    setD(null);
    const allCats = lib.cats();
    const existing = lib.fav(mangaUrl);
    setCats(allCats);
    setFav(!!existing);
    setSelectedCats(
      existing?.cats?.length ? existing.cats : allCats[0] ? [allCats[0].id] : []
    );
    api
      .detail(mangaUrl, sourceId)
      .then((r) => setD(r))
      .catch((e) => setErr(String(e)));
  }, [mangaUrl, sourceId]);

  const toggleCat = (id) => {
    setSelectedCats((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (fav) lib.updateFavCats(mangaUrl, next);
      return next;
    });
  };

  if (!mangaUrl)
    return <EmptyState icon={BookOpen} title="Sin manga seleccionado." />;
  if (err)
    return <EmptyState icon={AlertTriangle} title="No se pudo cargar" description={err} />;
  if (!d)
    return (
      <div className="w-full">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <p className="text-sm text-muted-foreground mt-3">Cargando detalle…</p>
      </div>
    );

  let chapters = d.chapters.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));
  if (asc) chapters = [...chapters].reverse();
  const firstChapter = d.chapters[0]?.url;

  return (
    <div className="min-h-full flex flex-col">
      <Button variant="ghost" size="sm" className="mb-6 self-start" onClick={() => { window.location.hash = '#/explorar'; }}>
        <ArrowLeft className="w-4 h-4 mr-1.5" /> Explorar
      </Button>

      <section className="relative rounded-2xl overflow-hidden border border-border">
        <div className="absolute inset-0">
          <img
            src={d.cover}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover blur-2xl brightness-[.45] saturate-150 scale-110"
          />
        </div>
        <div className="relative flex flex-col md:flex-row gap-5 p-6 bg-gradient-to-b from-black/10 to-black/50">
          <img
            className="w-40 md:w-[168px] aspect-[5/7] object-cover rounded-xl shadow-2xl shrink-0"
            src={d.cover}
            alt={d.title}
            referrerPolicy="no-referrer"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">{d.title}</h1>
            <div className="text-sm text-gray-300 mt-1">{d.altTitles?.slice(0, 160)}</div>

            <div className="flex flex-wrap gap-2 mt-3">
              {(d.facts.estado || d.facts.status) && (
                <Badge>{d.facts.estado || d.facts.status}</Badge>
              )}
              {d.facts.tipo && <Badge>{d.facts.tipo}</Badge>}
              {d.genres.slice(0, 6).map((g) => (
                <Badge key={g} variant="outline" className="text-gray-200 border-white/20">
                  {g}
                </Badge>
              ))}
            </div>

            <p className="text-sm text-gray-300 mt-3 max-w-2xl leading-relaxed">
              {d.sinopsis?.slice(0, 420)}
              {d.sinopsis?.length > 420 ? '…' : ''}
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              {firstChapter && (
                <Button
                  className="shadow-lg shadow-primary/30"
                  onClick={() => {
                    window.location.hash = `#/leer?u=${encodeURIComponent(firstChapter)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}`;
                  }}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Leer {d.chapters[0]?.title || ''}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  lib.toggleFav(
                    { url: mangaUrl, title: d.title, cover: d.cover, type: d.facts.tipo, sourceId },
                    selectedCats
                  );
                  setFav(!fav);
                }}
              >
                <Star className={`w-4 h-4 mr-2 ${fav ? 'fill-current text-amber-400' : ''}`} />
                {fav ? 'En biblioteca' : 'Añadir'}
              </Button>
            </div>

            {cats.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-gray-300 mb-2">Categorías</div>
                <div className="flex flex-wrap gap-2">
                  {cats.map((c) => {
                    const on = selectedCats.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCat(c.id)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                          on
                            ? 'bg-primary text-primary-foreground border-transparent'
                            : 'border-white/25 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        {on ? `✓ ${c.name}` : c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="text-xs text-gray-300 mt-3">
              {d.chapters.length} capítulos
              {d.facts.vistas ? ` · ${d.facts.vistas} vistas` : ''}
              {d.facts.autor ? ` · Por ${d.facts.autor}` : ''}
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between mt-10 mb-3">
        <h2 className="text-xl font-semibold">Capítulos ({d.chapters.length})</h2>
        <Button variant="ghost" size="sm" onClick={() => setAsc(!asc)}>
          {asc ? 'Más antiguos primero' : 'Más recientes primero'}
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 bg-muted/50 border-none"
          placeholder="Filtrar por número… Ej. 12"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        {chapters.slice(0, 300).map((c, i) => (
          <a
            key={i}
            className="flex items-center gap-4 rounded-xl border border-border bg-card p-3 min-h-[60px] hover:bg-accent/50 transition-colors"
            href={`#/leer?u=${encodeURIComponent(c.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}`}
          >
            <span className="w-11 h-11 rounded-2xl shrink-0 bg-secondary text-secondary-foreground grid place-items-center font-bold text-xs">
              {c.title.replace(/[^0-9.]/g, '').slice(0, 5) || '·'}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold truncate">{c.title}</span>
              <span className="block text-xs text-muted-foreground">{c.date}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        ))}
      </div>

      {chapters.length > 300 && (
        <p className="text-sm text-muted-foreground mt-3">
          Mostrando 300 de {chapters.length}. Usa el filtro para encontrar más.
        </p>
      )}
    </div>
  );
}
