export function attachHorizontalScrollFade(element) {
  if (!element) return () => {};

  let lastMask = null;
  const update = () => {
    const maxScroll = element.scrollWidth - element.clientWidth;
    const bounds = element.getBoundingClientRect();
    const activeBounds = element.querySelector('[aria-current="page"]')?.getBoundingClientRect();
    const activeAtLeft = activeBounds && activeBounds.left < bounds.left + 18 && activeBounds.right > bounds.left;
    const activeAtRight = activeBounds && activeBounds.right > bounds.right - 18 && activeBounds.left < bounds.right;
    const hasLeftOverflow = maxScroll > 1 && element.scrollLeft > 1 && !activeAtLeft;
    const hasRightOverflow = maxScroll > 1 && element.scrollLeft < maxScroll - 1 && !activeAtRight;
    const mask = !hasLeftOverflow && !hasRightOverflow
      ? 'none'
      : `linear-gradient(90deg, ${hasLeftOverflow ? 'transparent 0, #000 18px' : '#000 0'}, ${hasRightOverflow ? '#000 calc(100% - 18px), transparent 100%' : '#000 100%'})`;

    if (mask === lastMask) return;
    lastMask = mask;
    element.style.maskImage = mask;
    element.style.webkitMaskImage = mask;
  };
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);

  resizeObserver?.observe(element);
  Array.from(element.children).forEach((child) => resizeObserver?.observe(child));
  mutationObserver?.observe(element, { attributes: true, attributeFilter: ['class', 'aria-current'], characterData: true, childList: true, subtree: true });
  element.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();

  return () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    element.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    element.style.maskImage = '';
    element.style.webkitMaskImage = '';
  };
}
