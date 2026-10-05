import { useEffect, useState } from 'react';
import { Trash2, Download, RefreshCw, AlertTriangle, Loader2, ArrowUpCircle } from 'lucide-react';
import { extensions, DEFAULT_INDEX_URL } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Dialog } from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Badge } from './ui/badge.jsx';
import { useToast } from './Toast.jsx';
import { cn } from '../lib/utils.js';

function ExtensionCard({ m, action, badge }) {
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
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" title={m.name}>{m.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {m.version && <span className="text-[11px] text-muted-foreground">v{m.version}</span>}
            {badge}
          </div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </Card>
  );
}

export default function ExtensionsPanel() {
  const { toast } = useToast();
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [available, setAvailable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [updating, setUpdating] = useState(false);

  const repoUrl = settings.get().extIndexUrl || DEFAULT_INDEX_URL;
  const refresh = () => setInstalled(extensions.installed());

  const checkUpdates = async () => {
    try {
      setUpdates(await extensions.checkUpdates(repoUrl));
    } catch {
      setUpdates([]);
    }
  };

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
      checkUpdates();
      loadAvailable();
    })();
  }, []);

  useEffect(() => {
    const onGo = () => {
      checkUpdates();
      loadAvailable();
    };
    window.addEventListener('cytlex:go-extensions', onGo);
    return () => window.removeEventListener('cytlex:go-extensions', onGo);
  }, []);

  const doUpdateAll = async () => {
    setUpdating(true);
    setErr('');
    try {
      const r = await extensions.updateAll(repoUrl);
      refresh();
      await checkUpdates();
      if (r.fallos.length) {
        toast({
          title: 'Actualización parcial',
          description: `${r.ok} actualizadas, ${r.fallos.length} fallaron.`,
          variant: 'error'
        });
      } else {
        toast({
          title: r.ok === 1 ? '1 extensión actualizada' : `${r.ok} extensiones actualizadas`,
          variant: 'success'
        });
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setUpdating(false);
  };

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
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-sm font-medium">Instaladas</h3>
          {updates.length > 0 && (
            <Button variant="secondary" size="sm" onClick={doUpdateAll} disabled={updating}>
              {updating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowUpCircle className="w-4 h-4 mr-2" />
              )}
              Actualizar todo
              <span className="opacity-70 ml-2">{updates.length}</span>
            </Button>
          )}
        </div>
        {installed.length === 0 ? (
          <EmptyState
            compact
            face="（・_・）"
            title="No hay extensiones instaladas"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {installed.map(({ manifest: m }) => {
              const upd = updates.find((u) => u.id === m.id);
              return (
                <ExtensionCard
                  key={m.id}
                  m={upd ? { ...m, version: upd.to } : m}
                  badge={upd ? (
                    <Badge title={`De v${upd.from} a v${upd.to}`}>Actualizable</Badge>
                  ) : null}
                  action={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-transparent hover:text-destructive"
                      title="Desinstalar"
                      aria-label="Desinstalar"
                      disabled={busy === m.id}
                      onClick={() => setConfirmRemove(m)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  }
                />
              );
            })}
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
              compact
              face="（・_・;）"
              tone="error"
              title="No se pudieron cargar las extensiones"
              action={<Button size="sm" onClick={loadAvailable}>Reintentar</Button>}
            />
          )
        ) : available.length === 0 ? (
          <EmptyState
            compact
            face="ヽ(・∀・)ﾉ"
            title="No quedan extensiones por instalar"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {available.map((m) => (
              <ExtensionCard
                key={m.id}
                m={m}
                action={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-transparent hover:text-foreground"
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

      {confirmRemove && (
        <Dialog open onClose={() => setConfirmRemove(null)} title="Desinstalar extensión" hideDivider bodyClassName="p-5">
          <p className="text-sm text-muted-foreground">
            ¿Seguro que quieres desinstalar «{confirmRemove.name}»? Dejará de estar disponible en Cytlex.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const id = confirmRemove.id;
                setConfirmRemove(null);
                await doUninstall(id);
              }}
            >
              Desinstalar
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

