import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { extensions, isAdultExtension } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { lastSearch, resultsScroll } from '../lib/searchState.js';
import MangaCard from '../components/MangaCard.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { useScale, px } from '../lib/useScale.js';

export default function Results() {
  const navigate = useNavigate();
  const loc = useLocation();
  const sourceId = new URLSearchParams(loc.search).get('s') || '';
  const group = lastSearch.results?.find((r) => r.id === sourceId);
  const manifest = group?.manifest || extensions.manifest(sourceId);
  const [coverSize, setCoverSize] = useState(() => Math.round(160 * (settings.get().uiScale || 1)));
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const scale = useScale();

  useEffect(() => settings.subscribe((s) => {
    setCoverSize(Math.round(160 * (s.uiScale || 1)));
    setShowAdultExtensions(!!s.showAdultExtensions);
  }), []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);
  const adultExtensionHidden = !showAdultExtensions && isAdultExtension(manifest);
  const items = group?.items || [];

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

  if (adultExtensionHidden)
    return (
      <EmptyState
        face="（・_・）"
        title="Extensión +18 oculta"
        description="Activa «Mostrar extensiones +18» en Ajustes > Extensiones para ver sus resultados."
        action={
          <Button
            variant="secondary"
            onClick={() => navigate('/explorar')}
            style={{ height: px(40, scale, 33), fontSize: px(14, scale, 12), paddingLeft: px(16, scale, 12), paddingRight: px(16, scale, 12) }}
          >
            Ir a Explorar
          </Button>
        }
      />
    );

  if (!group || !items.length)
    return (
      <EmptyState
        face="¯\\_(ツ)_/¯"
        title="Sin resultados"
        action={
          <Button
            variant="secondary"
            onClick={() => navigate('/explorar')}
            style={{
              height: px(40, scale, 33),
              fontSize: px(14, scale, 12),
              paddingLeft: px(16, scale, 12),
              paddingRight: px(16, scale, 12)
            }}
          >
            Ir a Explorar
          </Button>
        }
      />
    );

  return (
    <div className="min-h-full flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        className="self-start hover:bg-transparent hover:text-foreground"
        onClick={() => navigate('/explorar')}
        style={{
          marginTop: px(-8, scale, -6),
          marginLeft: px(-8, scale, -6),
          marginBottom: px(4, scale, 3),
          fontSize: px(14, scale, 12)
        }}
      >
        <ArrowLeft className="mr-1.5" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} /> Volver
      </Button>

      <div className="flex items-center" style={{ gap: px(10, scale, 8), marginBottom: `${Math.max(10, Math.round(16 * scale))}px` }}>
        <SourceBadge m={manifest} style={{ width: px(28, scale, 22), height: px(28, scale, 22), fontSize: `${Math.round(12 * scale)}px` }} />
        <h1 className="font-semibold" style={{ fontSize: `${Math.round(14 * scale)}px` }}>{manifest.name}</h1>
        <span className="text-muted-foreground" style={{ fontSize: `${Math.round(12 * scale)}px` }}>· {items.length}</span>
      </div>

      <motion.div
        className="grid gap-x-5 gap-y-8"
        style={{
          gridTemplateColumns: `repeat(auto-fill, ${cs}px)`,
          gap: `${Math.max(16, Math.round(20 * scale))}px ${Math.max(12, Math.round(20 * scale))}px`
        }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {items.map((m, i) => (
          <MangaCard key={i} m={m} sourceId={sourceId} from="resultados" coverSize={cs} />
        ))}
      </motion.div>
    </div>
  );
}
