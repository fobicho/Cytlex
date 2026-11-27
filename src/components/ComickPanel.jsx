import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Link2, Loader2, Search, Unlink } from 'lucide-react';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { Dialog } from './ui/dialog.jsx';
import { Input } from './ui/input.jsx';
import { comickList, COMICK_STATUS } from '../lib/comick.js';
import { comickSession } from '../lib/comickSession.js';
import { tracking } from '../lib/tracking.js';
import { useI18n } from '../lib/i18n.js';
import { useScale, fontPx } from '../lib/useScale.js';

function titleOf(entry) {
  return entry?.title || entry?.titles?.find((item) => item.is_default)?.title || entry?.titles?.[0]?.title || 'Título sin nombre';
}

function statusLabel(entry) {
  return COMICK_STATUS[entry?.status] || entry?.status_name || '—';
}

export default function ComickPanel({ mangaUrl, sourceId, title, open, onClose }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const scale = useScale();
  const [connected, setConnected] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('1');
  const [chapter, setChapter] = useState('');
  useEffect(() => comickSession.subscribe(() => {
    const current = comickSession.status();
    setConnected(current.connected);
    setCanWrite(current.canWrite);
  }), []);

  useEffect(() => tracking.subscribe(() => {
    const id = tracking.get(mangaUrl, sourceId)?.comickId;
    setSelected((current) => current?.hid === id ? current : library.find((entry) => entry.hid === id) || null);
  }), [mangaUrl, sourceId, library]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setError('');
    setQuery(title || '');
    const current = comickSession.status();
    setConnected(current.connected);
    setCanWrite(current.canWrite);
    if (!current.connected) {
      setLibrary([]);
      setSelected(null);
      return undefined;
    }
    setLoading(true);
    comickList.myLibrary({ fresh: true })
      .then((items) => {
        if (!alive) return;
        setLibrary(items);
        const id = tracking.get(mangaUrl, sourceId)?.comickId;
        setSelected(items.find((entry) => entry.hid === id) || null);
      })
      .catch((err) => { if (alive) setError(String(err?.message || err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, mangaUrl, sourceId]);

  useEffect(() => {
    setStatus(String(selected?.status || 1));
    setChapter(selected?.progress?.number == null ? '' : String(selected.progress.number));
  }, [selected?.hid]);

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return library.filter((entry) => !term || [entry.title, ...(entry.titles || []).map((item) => item.title)]
      .some((value) => String(value || '').toLocaleLowerCase().includes(term)));
  }, [library, query]);

  const save = async () => {
    if (!selected || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      const updated = await comickList.saveEntry({
        hid: selected.hid,
        status: Number(status),
        progress: chapter.trim() ? { number: chapter.trim() } : undefined
      });
      const next = updated || { ...selected, status: Number(status) };
      setSelected(next);
      setLibrary((items) => items.map((entry) => entry.hid === next.hid ? next : entry));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Seguimiento en Comick')}
      description={t('Vincula este manga con uno que ya sigues en Comick.')}
      className="max-w-xl max-h-[calc(100vh-3rem)] flex flex-col"
      bodyClassName="p-5 overflow-y-auto"
    >
      {!connected ? (
        <div className="py-5 text-center">
          <p className="text-sm text-muted-foreground mb-4">{t('Conecta Comick desde Ajustes para vincular y sincronizar el progreso.')}</p>
          <Button onClick={() => { onClose(); navigate('/ajustes?section=seguimiento'); }}>
            <Link2 className="w-4 h-4 mr-2" />{t('Ir a Ajustes')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />{t('Cargando tu biblioteca de Comick…')}
            </div>
          )}
          {!loading && !selected && (
            <>
              <p className="text-sm text-muted-foreground">{t('Elige un manga que ya esté en tu biblioteca de Comick.')}</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en tu biblioteca de Comick" className="pl-9" />
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border">
                {results.slice(0, 50).map((entry) => (
                  <button
                    key={entry.hid}
                    type="button"
                    onClick={() => {
                      tracking.linkComick(mangaUrl, sourceId, entry.hid);
                      setSelected(entry);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
                  >
                    {entry.cover_url ? <img src={entry.cover_url} alt="" className="h-12 w-9 rounded-sm object-cover" referrerPolicy="no-referrer" /> : <span className="h-12 w-9 rounded-sm bg-secondary" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{titleOf(entry)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{statusLabel(entry)}{entry.progress?.number != null ? ` · ${entry.progress.number}` : ''}</span>
                    </span>
                    <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {!results.length && !loading && <p className="p-4 text-sm text-muted-foreground">{t('No hay coincidencias. Sigue el manga primero en Comick.')}</p>}
              </div>
            </>
          )}
          {!loading && selected && (
            <>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                {selected.cover_url ? <img src={selected.cover_url} alt="" className="h-16 w-12 rounded-sm object-cover" referrerPolicy="no-referrer" /> : <span className="h-16 w-12 rounded-sm bg-secondary" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{titleOf(selected)}</div>
                  <div className="text-xs text-muted-foreground">{t('Vinculado a')} {title || t('este manga')}</div>
                </div>
                <Badge variant="outline">{statusLabel(selected)}</Badge>
                {selected.url && <a href={selected.url} target="_blank" rel="noreferrer" aria-label={t('Abrir en Comick')} className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>}
                <Button variant="ghost" size="icon" title={t('Desvincular')} aria-label={t('Desvincular')} onClick={() => { tracking.unlink(mangaUrl, sourceId, 'comick'); setSelected(null); }}>
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span>{t('Estado')}</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 w-full rounded-sm border border-border bg-background px-3">
                      {Object.entries(COMICK_STATUS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span>{t('Capítulo leído')}</span>
                    <Input value={chapter} onChange={(event) => setChapter(event.target.value)} inputMode="decimal" placeholder="—" />
                  </label>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button onClick={save} disabled={saving}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('Guardar seguimiento')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('La cuenta no concedió permiso de escritura. Vuelve a conectar Comick para editar o sincronizar el progreso.')}</p>
              )}
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive" style={{ fontSize: fontPx(13, scale) }}>{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
