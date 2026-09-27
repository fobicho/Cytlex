import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { extensions } from '../lib/extensions.js';
import { lastSearch } from '../lib/searchState.js';
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
    loc.pathname === '/resultados' && document.querySelector('main')?.scrollTo(0, 0);
  }, [loc.search]);

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
