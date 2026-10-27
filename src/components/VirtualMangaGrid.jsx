import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import MangaCard from './MangaCard.jsx';

const OVERSCAN_ROWS = 1;

export default function VirtualMangaGrid({ items, sourceId, coverSize, scale }) {
  const gridRef = useRef(null);
  const frameRef = useRef(0);
  const layoutRef = useRef(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [cardHeight, setCardHeight] = useState(coverSize * 1.5 + 28);
  const [range, setRange] = useState({ start: 0, end: 6 });
  const gapX = Math.max(12, Math.round(20 * scale));
  const gapY = Math.max(16, Math.round(20 * scale));
  const columns = Math.max(1, Math.floor((gridWidth + gapX) / (coverSize + gapX)));
  const rowStep = cardHeight + gapY;
  const totalRows = Math.ceil(items.length / columns);
  const startRow = Math.min(range.start, Math.max(0, totalRows - 1));
  const endRow = Math.min(totalRows, Math.max(startRow + 1, range.end));
  const startIndex = startRow * columns;
  const visibleItems = useMemo(
    () => items.slice(startIndex, Math.min(items.length, endRow * columns)),
    [items, startIndex, endRow, columns]
  );

  layoutRef.current = { columns, rowStep, totalRows };

  useLayoutEffect(() => {
    const updateRange = () => {
      frameRef.current = 0;
      const main = document.querySelector('main');
      const grid = gridRef.current;
      if (!main || !grid) return;
      const width = grid.parentElement?.clientWidth || main.clientWidth;
      setGridWidth((current) => current === width ? current : width);

      const firstCard = grid.querySelector('[data-virtual-card]');
      const measuredHeight = firstCard?.getBoundingClientRect().height || 0;
      if (measuredHeight) setCardHeight((current) => Math.abs(current - measuredHeight) < 1 ? current : measuredHeight);

      const { rowStep: currentRowStep, totalRows: currentTotalRows } = layoutRef.current || {};
      if (!currentRowStep || !currentTotalRows) {
        setRange((current) => current.start === 0 && current.end === 6 ? current : { start: 0, end: 6 });
        return;
      }
      const mainRect = main.getBoundingClientRect();
      const gridTop = grid.getBoundingClientRect().top - mainRect.top + main.scrollTop;
      const visibleTop = main.scrollTop - gridTop;
      const start = Math.max(0, Math.floor(visibleTop / currentRowStep) - OVERSCAN_ROWS);
      const end = Math.min(currentTotalRows, Math.ceil((visibleTop + main.clientHeight) / currentRowStep) + OVERSCAN_ROWS);
      setRange((current) => current.start === start && current.end === end ? current : { start, end });
    };
    const scheduleUpdate = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(updateRange);
    };
    const main = document.querySelector('main');
    if (!main) return undefined;
    main.addEventListener('scroll', scheduleUpdate, { passive: true });
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(main);
    if (gridRef.current?.parentElement) observer.observe(gridRef.current.parentElement);
    scheduleUpdate();
    return () => {
      main.removeEventListener('scroll', scheduleUpdate);
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [items.length, coverSize, scale, columns, rowStep]);

  const height = totalRows ? totalRows * rowStep - gapY : 0;
  return (
    <div ref={gridRef} style={{ height, position: 'relative' }}>
      <div
        className="grid absolute inset-x-0 top-0"
        style={{
          gridTemplateColumns: `repeat(${columns}, ${coverSize}px)`,
          gap: `${gapY}px ${gapX}px`,
          transform: `translateY(${startRow * rowStep}px)`
        }}
      >
        {visibleItems.map((manga, index) => (
          <div key={manga.url} data-virtual-card={index === 0 ? '' : undefined}>
            <MangaCard m={manga} sourceId={sourceId} from="fuentes" coverSize={coverSize} showAuthor={false} />
          </div>
        ))}
      </div>
    </div>
  );
}
