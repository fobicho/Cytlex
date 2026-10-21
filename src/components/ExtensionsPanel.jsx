import { useEffect, useState, useRef } from 'react';
import { Trash2, Download, RefreshCw, AlertTriangle, Loader2, ArrowUpCircle } from 'lucide-react';
import { extensions } from '../lib/extensions.js';
import { extUpdates } from '../lib/extUpdates.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { useToast } from './Toast.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

function ExtensionCard({ m, action, updatable = false, scale = 1 }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = m.icon && imgOk;
  const iconSize = Number(px(40, scale, 32).replace('px', ''));
  return (
    <Card className={cn('hover:shadow-sm', updatable && 'cx-update-pulse')}>
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
            className="flex items-center min-w-0 overflow-hidden"
            style={{
              marginTop: px(2, scale, 1.5),
              gap: px(6, scale, 4),
              height: px(20, scale, 16)
            }}
          >
            {m.version && (
              <span
                className="text-muted-foreground leading-none truncate min-w-0"
                style={{ fontSize: px(11, scale, 9) }}
              >
                v{m.version}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </Card>
  );
}

let repoCache = { url: '', available: null, updates: null };

export default function ExtensionsPanel() {
  const { toast } = useToast();
  const scale = useScale();
  const initialRepo = (settings.get().extIndexUrl || '').trim();
  const cacheHit = !!initialRepo && initialRepo === repoCache.url && repoCache.available !== null;
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [available, setAvailable] = useState(() => (cacheHit ? repoCache.available : null));
  const [loading, setLoading] = useState(() => !cacheHit);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmInstall, setConfirmInstall] = useState(null);
  const [confirmUpdate, setConfirmUpdate] = useState(null);
  const [updates, setUpdates] = useState(() => (cacheHit ? repoCache.updates || [] : []));
  const [updating, setUpdating] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const confirmRef = useRef(null);
  const removeRef = useRef(null);
  const updateRef = useRef(null);
  const allRef = useRef(null);

  useEffect(() => {
    if (!confirmInstall) return;
    const onDown = (e) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target)) {
        setConfirmInstall(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmInstall]);

  useEffect(() => {
    if (!confirmRemove) return;
    const onDown = (e) => {
      if (removeRef.current && !removeRef.current.contains(e.target)) {
        setConfirmRemove(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmRemove]);

  useEffect(() => {
    if (!confirmUpdate || confirmUpdate === 'all') return;
    const onDown = (e) => {
      if (updateRef.current && !updateRef.current.contains(e.target)) {
        setConfirmUpdate(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmUpdate]);

  useEffect(() => {
    if (!confirmAll) return;
    const onDown = (e) => {
      if (allRef.current && !allRef.current.contains(e.target)) {
        setConfirmAll(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmAll]);

  const refresh = () => setInstalled(extensions.installed());

  const checkUpdates = async (url = repoUrl) => {
    if (!url) {
      setUpdates([]);
      return;
    }
    try {
      setUpdates(await extensions.checkUpdates(url));
    } catch {
      setUpdates([]);
    }
  };

  const loadAvailable = async (url = repoUrl) => {
    if (!url) {
      setAvailable([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      setAvailable(await extensions.available(url));
    } catch (e) {
      setErr(String(e?.message || e));
      setAvailable(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    if (!repoUrl) {
      setAvailable([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try { await extensions.sync(repoUrl); } catch {}
      refresh();
      await checkUpdates();
      await loadAvailable();
    })();
  }, [repoUrl]);

  useEffect(() => {
    if (repoUrl && available !== null) {
      repoCache = { url: repoUrl, available, updates };
    }
  }, [repoUrl, available, updates]);

  useEffect(() => {
    const onGo = () => {
      if (!repoUrl) return;
      checkUpdates();
      loadAvailable();
    };
    window.addEventListener('cytlex:go-extensions', onGo);
    return () => window.removeEventListener('cytlex:go-extensions', onGo);
  }, [repoUrl]);

  useEffect(() => settings.subscribe((s) => setRepoUrl((s.extIndexUrl || '').trim())), []);

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
              ref={allRef}
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (!confirmAll) {
                  setConfirmAll(true);
                  return;
                }
                setConfirmAll(false);
                await doUpdateAll();
              }}
              disabled={updating !== ''}
              className="whitespace-nowrap"
              style={{
                height: px(36, scale, 30),
                minWidth: px(176, scale, 140),
                fontSize: px(14, scale, 12),
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {updating === 'all' ? (
                  <motion.span
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center"
                  >
                    <Loader2
                      className="mr-2 animate-spin"
                      style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                    />
                    Actualizando...
                  </motion.span>
                ) : confirmAll ? (
                  <motion.span
                    key="confirm"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    ¿Seguro?
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="flex items-center"
                  >
                    <ArrowUpCircle
                      className="mr-2"
                      style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                    />
                    Actualizar todo
                    <span className="opacity-70 ml-2">{updates.length}</span>
                  </motion.span>
                )}
              </AnimatePresence>
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
                  m={m}
                  updatable={!!upd}
                  action={
                    <div className="flex items-center" style={{ gap: px(4, scale, 3) }}>
                      {upd && (
                        <div
                          ref={confirmUpdate?.id === m.id ? updateRef : null}
                          className="relative flex items-center justify-center"
                          style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-transparent hover:text-foreground"
                            title={`Actualizar a la v${upd.to}`}
                            aria-label={`Actualizar ${m.name}`}
                            disabled={updating !== ''}
                            onClick={() => setConfirmUpdate(upd)}
                            style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                          >
                            {updating === m.id ? (
                              <Loader2 className="animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            ) : (
                              <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            )}
                          </Button>
                          <AnimatePresence>
                            {confirmUpdate && confirmUpdate !== 'all' && confirmUpdate.id === m.id && (
                              <motion.div
                                key="confirm-update"
                                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                                transition={{ duration: 0.14, ease: 'easeOut' }}
                                className="absolute z-20 rounded-lg border border-border bg-card shadow-lg"
                                style={{ top: '100%', left: '50%', marginTop: px(6, scale, 4), padding: px(8, scale, 6) }}
                              >
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    const target = confirmUpdate;
                                    setConfirmUpdate(null);
                                    await doUpdateOne(target.id);
                                  }}
                                  disabled={updating !== ''}
                                  style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                                >
                                  Actualizar
                                </Button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                      <div
                        ref={confirmRemove?.id === m.id ? removeRef : null}
                        className="relative flex items-center justify-center"
                        style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                      >
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
                        <AnimatePresence>
                          {confirmRemove?.id === m.id && (
                            <motion.div
                              key="confirm-remove"
                              initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                              exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                              transition={{ duration: 0.14, ease: 'easeOut' }}
                              className="absolute z-20 rounded-lg border border-border bg-card shadow-lg"
                              style={{ top: '100%', left: '50%', marginTop: px(6, scale, 4), padding: px(8, scale, 6) }}
                            >
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={async () => {
                                  const id = confirmRemove.id;
                                  setConfirmRemove(null);
                                  await doUninstall(id);
                                }}
                                disabled={busy === m.id}
                                style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                              >
                                Desinstalar
                              </Button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
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
            onClick={() => loadAvailable()}
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

        {!repoUrl ? (
          <EmptyState
            compact
            face="（・_・）"
            tone="prompt"
            title="Sin repositorio configurado"
          />
        ) : available === null ? (
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
                  <div
                    ref={confirmInstall?.id === m.id ? confirmRef : null}
                    className="relative flex items-center justify-center"
                    style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-transparent hover:text-foreground"
                      title="Instalar"
                      aria-label="Instalar"
                      disabled={busy === m.id}
                      onClick={() => setConfirmInstall(m)}
                      style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                    >
                      <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    </Button>
                    <AnimatePresence>
                      {confirmInstall?.id === m.id && (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                          exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                          transition={{ duration: 0.14, ease: 'easeOut' }}
                          className="absolute z-20 rounded-lg border border-border bg-card shadow-lg"
                          style={{ top: '100%', left: '50%', marginTop: px(6, scale, 4), padding: px(8, scale, 6) }}
                        >
                          <Button
                            size="sm"
                            onClick={async () => {
                              setConfirmInstall(null);
                              await doInstall(m);
                            }}
                            disabled={busy === m.id}
                            style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                           >
                            Instalar
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
