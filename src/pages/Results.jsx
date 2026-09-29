import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { extensions } from '../lib/extensions.js';
import { lastSearch, resultsScroll } from '../lib/searchState.js';
import MangaCard from '../components/MangaCard.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';

export default function Results() {
  const navigate = useNavigate();
  const loc = useLocation();
  const sourceId = new URLSearchParams(loc.search).get('s') || '';
  const group = lastSearch.results?.find((r) => r.id === sourceId);
  const manifest = group?.manifest || extensions.manifest(sourceId);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return undefined;

    let restoring = resultsScroll.has(sourceId) && resultsScroll.get(sourceId) > 0;
    let ticks = 0;
    let lastH = -1;
    let timer = null;
    let lastTop = main.scrollTop;

    const apply = () => {
      const saved = resultsScroll.get(sourceId);
      const max = main.scrollHeight - main.clientHeight;
      main.scrollTop = saved > 0 ? Math.min(saved, Math.max(0, max)) : 0;
      lastTop = main.scrollTop;
    };

    apply();
    const raf = requestAnimationFrame(() => requestAnimationFrame(apply));

    const settle = () => {
      if (ticks > 12) { restoring = false; return; }
      ticks += 1;
      const h = main.scrollHeight;
      if (h === lastH) { restoring = false; return; }
      lastH = h;
      apply();
      timer = setTimeout(settle, 120);
    };
    timer = setTimeout(settle, 120);

    const track = () => {
      if (restoring) return;
      lastTop = main.scrollTop;
      resultsScroll.set(sourceId, lastTop);
    };

    main.addEventListener('scroll', track, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      main.removeEventListener('scroll', track);
      resultsScroll.set(sourceId, lastTop);
    };
  }, [sourceId, group?.items.length]);

  if (!group || !group.items.length)
    return <EmptyState icon={BookOpen} title="Sin resultados" description="Vuelve a explorar para buscar mangas." />;

  return (
    <div className="min-h-full flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        className="-mt-2 -ml-2 mb-1 self-start hover:bg-transparent hover:text-foreground"
        onClick={() => navigate('/explorar')}
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" /> Volver
      </Button>

      <div className="flex items-center gap-2.5 mb-6">
        <SourceBadge m={manifest} className="w-9 h-9 text-sm" />
        <h1 className="text-lg font-bold">{manifest.name}</h1>
        <span className="text-sm text-muted-foreground">· {group.items.length}</span>
      </div>

      <motion.div
        className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {group.items.map((m, i) => (
          <MangaCard key={i} m={m} sourceId={sourceId} from="resultados" />
        ))}
      </motion.div>
    </div>
  );
}
