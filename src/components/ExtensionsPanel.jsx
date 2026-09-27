import { useEffect, useState } from 'react';
import { Trash2, Download, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { extensions, DEFAULT_INDEX_URL } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { cn } from '../lib/utils.js';

function ExtensionCard({ m, action }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = m.icon && imgOk;
  return (
    <Card className="hover:shadow-sm">
      <div className="p-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-secondary text-secondary-foreground grid place-items-center font-bold shrink-0 overflow-hidden">
          {showImg ? (
            <img
              src={m.icon}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              onError={() => setImgOk(false)}
            />
          ) : (
            (m.name?.[0] || '?').toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0 font-semibold truncate" title={m.name}>{m.name}</div>
        <div className="shrink-0">{action}</div>
      </div>
    </Card>
  );
}

export default function ExtensionsPanel() {
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [available, setAvailable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const repoUrl = settings.get().extIndexUrl || DEFAULT_INDEX_URL;
  const refresh = () => setInstalled(extensions.installed());

  const loadAvailable = async () => {
    setLoading(true);
    setErr('');
    try {
      setAvailable(await extensions.available(repoUrl));
    } catch (e) {
      setErr(String(e?.message || e));
      setAvailable(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      try { await extensions.sync(repoUrl); } catch {}
      refresh();
      loadAvailable();
    })();
    // eslint-disable-next-line
  }, []);

  const doInstall = async (m) => {
    setBusy(m.id);
    setErr('');
    try {
      await extensions.install(m, repoUrl);
      refresh();
      setAvailable((a) => (a ? a.filter((x) => x.id !== m.id) : a));
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setBusy('');
  };

  const doUninstall = async (id) => {
    setBusy(id);
    setErr('');
    try {
      await extensions.uninstall(id);
      refresh();
      await loadAvailable();
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setBusy('');
  };

  return (
    <div className="flex flex-col gap-8">
      {err && (
        <Card className="border-destructive/40 hover:shadow-sm">
          <div className="p-4 flex items-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            <span className="text-muted-foreground">{err}</span>
          </div>
        </Card>
      )}

      <section>
        <h3 className="text-sm font-medium mb-3">Instaladas</h3>
        {installed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay extensiones instaladas. Instálalas individualmente desde «Disponibles».
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {installed.map(({ manifest: m }) => (
              <ExtensionCard
                key={m.id}
                m={m}
                action={
                  <Button
                    variant="destructive"
                    size="icon"
                    title="Desinstalar"
                    aria-label="Desinstalar"
                    disabled={busy === m.id}
                    onClick={() => doUninstall(m.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-sm font-medium">Disponibles</h3>
          <Button variant="secondary" size="sm" onClick={loadAvailable} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} /> Recargar
          </Button>
        </div>

        {available === null ? (
          loading ? (
            <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Cargando extensiones...</p>
            </div>
          ) : (
            <EmptyState
              icon={Puzzle}
              title="No se pudieron cargar las extensiones"
              description="Revisa tu conexión e inténtalo de nuevo."
              action={<Button size="sm" onClick={loadAvailable}>Reintentar</Button>}
            />
          )
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">No quedan extensiones por instalar.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {available.map((m) => (
              <ExtensionCard
                key={m.id}
                m={m}
                action={
                  <Button
                    size="icon"
                    title="Instalar"
                    aria-label="Instalar"
                    disabled={busy === m.id}
                    onClick={() => doInstall(m)}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
