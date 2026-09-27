// Genera una miniatura local (data URL) de una portada para que la biblioteca
// cargue al instante sin depender de la red. Los bytes los trae el proceso
// principal (sin CORS) y el decodificado lo hace el renderer.
const THUMB_WIDTH = 240;
const MAX_DATAURL = 120000;

export async function makeCoverThumb(url) {
  if (typeof window === 'undefined' || !window.cytlex?.fetchImage || !url) return '';
  try {
    const fetched = await window.cytlex.fetchImage(url);
    if (!fetched?.base64) return '';

    const blob = await (await fetch(`data:${fetched.mime};base64,${fetched.base64}`)).blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objUrl;
      });
      if (!img.width) return '';

      const width = Math.min(THUMB_WIDTH, img.width);
      const height = Math.max(1, Math.round((img.height / img.width) * width));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      return dataUrl.length <= MAX_DATAURL ? dataUrl : '';
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch {
    return '';
  }
}
