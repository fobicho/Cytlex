export default function MangaCard({ m, progress, sourceId = 'leercapitulo' }) {
  const detailHash = `#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sourceId)}`;
  const status = m.status || m.lastChapter || (progress ? 'En progreso' : '');
  return (
    <div>
      <a href={detailHash} aria-label={m.title} title={m.title}>
        <div className="relative rounded-xl overflow-hidden bg-muted/50 border border-border/50 shadow-sm">
          <img
            loading="lazy"
            src={m.cover}
            alt={m.title}
            referrerPolicy="no-referrer"
            className="w-full aspect-[5/7] object-cover bg-black"
          />
          {status && (
            <span className="absolute left-2 bottom-2 inline-flex items-center gap-1.5 max-w-[calc(100%-16px)] rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate">{String(status).slice(0, 28)}</span>
            </span>
          )}
        </div>
      </a>
      <div className="pt-2 px-1">
        <a
          className="block text-[13.5px] font-semibold leading-snug line-clamp-2"
          href={detailHash}
          title={m.title}
        >
          {m.title}
        </a>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {[m.type, m.lastChapter].filter(Boolean).join(' · ') || '\u00a0'}
        </div>
      </div>
    </div>
  );
}
