import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import MangaCard from './MangaCard.jsx';

export default function VirtualMangaGrid({ items, sourceId, coverSize, scale, renderCard, active = true, overscanRows = 1, responsiveCards = false }) {
  const gridRef = useRef(null);
  const frameRef = useRef(0);
  const layoutRef = useRef(null);
  const gridTopRef = useRef(0);
  const shouldMeasureRef = useRef(false);
  const [gridWidth, setGridWidth] = useState(0);
  const [cardHeight, setCardHeight] = useState(coverSize * 1.5 + 28);
  const [range, setRange] = useState({ start: 0, end: 6 });
  const gapX = Math.max(12, Math.round(20 * scale));
  const gapY = Math.max(16, Math.round(20 * scale));
  const columns = Math.max(1, Math.floor((gridWidth + gapX) / (coverSize + gapX)));
  const cardWidth = responsiveCards && gridWidth > 0
    ? Math.floor((gridWidth - gapX * (columns - 1)) / columns)
    : coverSize;
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
    if (!active) return undefined;
    const updateRange = (measureLayout = false) => {
      frameRef.current = 0;
      const main = document.querySelector('main');
      const grid = gridRef.current;
      if (!main || !grid) return;
      const width = grid.parentElement?.clientWidth || main.clientWidth;
      if (width > 0 && width !== gridWidth) {
        setGridWidth(width);
        return;
      }

      if (measureLayout) {
        const firstCard = grid.querySelector('[data-virtual-card]');
        const zoomValue = getComputedStyle(document.documentElement).zoom;
        const parsedZoom = Number.parseFloat(zoomValue);
        const numericZoom = zoomValue.trim().endsWith('%') || parsedZoom > 10 ? parsedZoom / 100 : parsedZoom;
        const zoomFactor = Number.isFinite(parsedZoom)
          ? numericZoom
          : 1;
        const measuredRectHeight = firstCard?.firstElementChild?.getBoundingClientRect().height
          || firstCard?.getBoundingClientRect().height
          || 0;
        const measuredHeight = measuredRectHeight / Math.max(zoomFactor, 0.01);
        if (measuredHeight) setCardHeight((current) => Math.abs(current - measuredHeight) < 1 ? current : measuredHeight);

        const mainRect = main.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        gridTopRef.current = gridRect.top - mainRect.top + main.scrollTop;
      }

      const { rowStep: currentRowStep, totalRows: currentTotalRows } = layoutRef.current || {};
      if (!currentRowStep || !currentTotalRows) {
        setRange((current) => current.start === 0 && current.end === 6 ? current : { start: 0, end: 6 });
        return;
      }
      const visibleTop = main.scrollTop - gridTopRef.current;
      const start = Math.max(0, Math.floor(visibleTop / currentRowStep) - overscanRows);
      const end = Math.min(currentTotalRows, Math.ceil((visibleTop + main.clientHeight) / currentRowStep) + overscanRows);
      setRange((current) => current.start === start && current.end === end ? current : { start, end });
    };
    const scheduleUpdate = (measureLayout = false) => {
      shouldMeasureRef.current ||= measureLayout;
      if (!frameRef.current) {
        frameRef.current = requestAnimationFrame(() => {
          const shouldMeasure = shouldMeasureRef.current;
          shouldMeasureRef.current = false;
          updateRange(shouldMeasure);
        });
      }
    };
    const main = document.querySelector('main');
    if (!main) return undefined;
    main.addEventListener('scroll', scheduleUpdate, { passive: true });
    const observer = new ResizeObserver(() => scheduleUpdate(true));
    observer.observe(main);
    if (gridRef.current?.parentElement) observer.observe(gridRef.current.parentElement);
    updateRange(true);
    return () => {
      main.removeEventListener('scroll', scheduleUpdate);
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [items.length, coverSize, scale, columns, rowStep, gridWidth, active, overscanRows, responsiveCards]);

  const height = totalRows ? totalRows * rowStep - gapY : 0;
  return (
    <div ref={gridRef} style={{ height, position: 'relative' }}>
      <div
        className="grid absolute inset-x-0 top-0"
        style={{
          transform: `translate3d(0, ${startRow * rowStep}px, 0)`,
          gridTemplateColumns: responsiveCards ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(${columns}, ${coverSize}px)`,
          gridAutoRows: `${cardHeight}px`,
          gap: `${gapY}px ${gapX}px`,
        }}
      >
        {visibleItems.map((manga, index) => (
          <div key={`${manga.sourceId || sourceId || ''}|${manga.url}`} data-virtual-card={index === 0 ? '' : undefined}>
            {renderCard
              ? renderCard(manga, cardWidth)
              : <MangaCard m={manga} sourceId={sourceId} from="fuentes" coverSize={cardWidth} showAuthor={false} />}
          </div>
        ))}
      </div>
    </div>
  );
}
