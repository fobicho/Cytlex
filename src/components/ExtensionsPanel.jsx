import { useEffect, useState } from 'react';
import { Trash2, Download, RefreshCw, AlertTriangle, Loader2, ArrowUpCircle } from 'lucide-react';
import { extensions, DEFAULT_INDEX_URL } from '../lib/extensions.js';
import { extUpdates } from '../lib/extUpdates.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Dialog } from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Badge } from './ui/badge.jsx';
import { useToast } from './Toast.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

function ExtensionCard({ m, action, badge, scale = 1 }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = m.icon && imgOk;
  const iconSize = Number(px(40, scale, 32).replace('px', ''));
  return (
    <Card className="hover:shadow-sm">
      <div
        className="flex items-center"
        style={{ padding: px(14, scale, 11), gap: px(12, scale, 9) }}
      >
        <div
          className="rounded-xl bg-secondary text-secondary-foreground grid place-items-center font-bold shrink-0 overflow-hidden"
          style={{
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            fontSize: px(16, scale, 13),
            borderRadius: px(12, scale, 9)
          }}
        >
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
          <div
            className="font-semibold truncate"
            title={m.name}
            style={{ fontSize: px(15, scale, 13) }}
          >
            {m.name}
          </div>
          <div
            className="flex items-center"
            style={{
              marginTop: px(2, scale, 1.5),
              gap: px(6, scale, 4),
              height: px(20, scale, 16)
            }}
          >
            {m.version && (
              <span
                className="text-muted-foreground leading-none"
                style={{ fontSize: px(11, scale, 9) }}
              >
                v{m.version}
              </span>
            )}
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
  const scale = useScale();
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [available, setAvailable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [updating, setUpdating] = useState('');

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
      await checkUpdates();
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

  const doUpdateOne = async (id) => {
    setUpdating(id);
    setErr('');
    try {
      const r = await extensions.updateAll(repoUrl, [id]);
      refresh();
      await checkUpdates();
      if (r.ok) {
        extUpdates.clear();
        toast({ title: 'Extensión actualizada', variant: 'success' });
      } else {
        setErr('No se pudo actualizar la extensión');
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setUpdating('');
  };

  const doUpdateAll = async () => {
    setUpdating('all');
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
        extUpdates.clear();
        toast({
          title: r.ok === 1 ? '1 extensión actualizada' : `${r.ok} extensiones actualizadas`,
          variant: 'success'
        });
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setUpdating('');
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

  const grid = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${px(240, scale, 200).replace('px', '')}px, 1fr))`,
    gap: px(12, scale, 9)
  };

  return (
    <div className="flex flex-col" style={{ gap: px(32, scale, 22) }}>
      {err && (
        <Card className="border-destructive/40 hover:shadow-sm">
          <div
            className="flex items-center"
            style={{ padding: px(16, scale, 11), gap: px(8, scale, 6), fontSize: px(14, scale, 12) }}
          >
            <AlertTriangle
              className="text-destructive shrink-0"
              style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
            />
            <span className="text-muted-foreground">{err}</span>
          </div>
        </Card>
      )}

      <section>
        <div
          className="flex items-center justify-between"
          style={{ gap: px(16, scale, 11), marginBottom: px(12, scale, 9), height: px(36, scale, 30) }}
        >
          <h3 className="font-medium" style={{ fontSize: px(14, scale, 12) }}>
            Instaladas
          </h3>
          {updates.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={doUpdateAll}
              disabled={updating !== ''}
              style={{
                height: px(36, scale, 30),
                fontSize: px(14, scale, 12),
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
              }}
            >
              {updating === 'all' ? (
                <Loader2
                  className="mr-2 animate-spin"
                  style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                />
              ) : (
                <ArrowUpCircle
                  className="mr-2"
                  style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                />
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
          <div className="grid" style={grid}>
            {installed.map(({ manifest: m }) => {
              const upd = updates.find((u) => u.id === m.id);
              return (
                <ExtensionCard
                  key={m.id}
                  scale={scale}
                  m={upd ? { ...m, version: upd.to } : m}
                  badge={upd ? (
                    <Badge
                      style={{
                        fontSize: px(11, scale, 9),
                        paddingLeft: px(8, scale, 6),
                        paddingRight: px(8, scale, 6),
                        lineHeight: px(16, scale, 13)
                      }}
                      title={`De v${upd.from} a v${upd.to}`}
                    >
                      Actualizable
                    </Badge>
                  ) : null}
                  action={
                    <div className="flex items-center" style={{ gap: px(4, scale, 3) }}>
                      {upd && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-transparent hover:text-foreground"
                          title={`Actualizar a la v${upd.to}`}
                          aria-label={`Actualizar ${m.name}`}
                          disabled={updating !== ''}
                          onClick={() => doUpdateOne(m.id)}
                          style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                        >
                          {updating === m.id ? (
                            <Loader2 className="animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                          ) : (
                            <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-transparent hover:text-destructive"
                        title="Desinstalar"
                        aria-label="Desinstalar"
                        disabled={busy === m.id}
                        onClick={() => setConfirmRemove(m)}
                        style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                      >
                        <Trash2 style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                      </Button>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div
          className="flex items-center justify-between"
          style={{ gap: px(16, scale, 11), marginBottom: px(12, scale, 9), height: px(36, scale, 30) }}
        >
          <h3 className="font-medium" style={{ fontSize: px(14, scale, 12) }}>
            Disponibles
          </h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadAvailable}
            disabled={loading}
            style={{
              height: px(36, scale, 30),
              fontSize: px(14, scale, 12),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          >
            <RefreshCw
              className={cn('mr-2', loading && 'animate-spin')}
              style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
            />
            Recargar
          </Button>
        </div>

        {available === null ? (
          loading ? (
            <div
              className="flex flex-col items-center text-muted-foreground"
              style={{ gap: px(12, scale, 9), padding: `${px(24, scale, 18)}px 0` }}
            >
              <Loader2 className="animate-spin" style={{ width: px(24, scale, 19), height: px(24, scale, 19) }} />
              <p style={{ fontSize: px(14, scale, 12) }}>Cargando extensiones...</p>
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
          <div className="grid" style={grid}>
            {available.map((m) => (
              <ExtensionCard
                key={m.id}
                scale={scale}
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
                    style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                  >
                    <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </section>

      {confirmRemove && (
        <Dialog open onClose={() => setConfirmRemove(null)} title="Desinstalar extensión" hideDivider bodyClassName="p-5">
          <p className="text-muted-foreground" style={{ fontSize: px(14, scale, 12) }}>
            ¿Seguro que quieres desinstalar «{confirmRemove.name}»? Dejará de estar disponible en Cytlex.
          </p>
          <div
            className="flex justify-end"
            style={{ gap: px(8, scale, 6), marginTop: px(20, scale, 14) }}
          >
            <Button
              variant="secondary"
              onClick={() => setConfirmRemove(null)}
              style={{
                height: px(36, scale, 30),
                fontSize: px(14, scale, 12),
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const id = confirmRemove.id;
                setConfirmRemove(null);
                await doUninstall(id);
              }}
              style={{
                height: px(36, scale, 30),
                fontSize: px(14, scale, 12),
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
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
