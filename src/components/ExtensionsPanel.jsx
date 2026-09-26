import { useEffect, useState } from 'react';
import { Trash2, Download, RefreshCw, AlertTriangle, Puzzle } from 'lucide-react';
import { extensions, DEFAULT_INDEX_URL } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { Badge } from './ui/badge.jsx';
import { Input } from './ui/input.jsx';

function typeLabel(type) {
  if (type === 'selector') return 'selectores';
  if (type === 'module') return 'módulo';
  return 'integrada';
}

export default function ExtensionsPanel() {
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [indexUrl, setIndexUrl] = useState(() => settings.get().extIndexUrl || DEFAULT_INDEX_URL);
  const [available, setAvailable] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = () => setInstalled(extensions.installed());
  const setIndex = (v) => {
    setIndexUrl(v);
    settings.set({ extIndexUrl: v });
  };

  const loadAvailable = async () => {
    const url = indexUrl.trim();
    if (!url) return;
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
    if (indexUrl.trim()) loadAvailable();
    // eslint-disable-next-line
  }, []);

  const doInstall = async (m) => {
    setBusy(m.id);
    setErr('');
    try {
      await extensions.install(m, indexUrl.trim());
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
        <h3 className="text-sm font-medium mb-3">Instaladas ({installed.length})</h3>
        <div className="flex flex-col gap-3">
          {installed.map(({ manifest: m, builtin }) => (
            <Card key={m.id} className="hover:shadow-sm">
              <div className="p-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-secondary text-secondary-foreground grid place-items-center font-bold shrink-0">
                  {m.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{m.name}</span>
                    {m.lang && <Badge variant="outline">{m.lang}</Badge>}
                    {m.version && <Badge variant="outline">v{m.version}</Badge>}
                    <Badge variant="outline">{typeLabel(m.type)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.desc || m.baseUrl || ''}</div>
                </div>
                {builtin ? (
                  <Badge variant="success">Integrada</Badge>
                ) : (
                  <Button variant="ghost" size="sm" disabled={busy === m.id} onClick={() => doUninstall(m.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Desinstalar
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-3">Disponibles</h3>
        <Card className="mb-3 hover:shadow-sm">
          <div className="p-4 flex flex-col sm:flex-row gap-3">
            <Input
              className="bg-muted/50 border-none"
              placeholder="URL del índice de extensiones (JSON)…"
              value={indexUrl}
              onChange={(e) => setIndex(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadAvailable()}
            />
            <Button onClick={loadAvailable} disabled={loading || !indexUrl.trim()}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Cargar
            </Button>
          </div>
        </Card>

        {available === null ? (
          <p className="text-sm text-muted-foreground px-1">
            Pega la URL de un índice de extensiones y pulsa «Cargar» para ver las disponibles.
          </p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground px-1">No hay extensiones nuevas en ese índice.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {available.map((m) => (
              <Card key={m.id} className="hover:shadow-sm">
                <div className="p-4 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-muted text-muted-foreground grid place-items-center shrink-0">
                    <Puzzle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{m.name}</span>
                      {m.lang && <Badge variant="outline">{m.lang}</Badge>}
                      {m.version && <Badge variant="outline">v{m.version}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{m.desc || m.baseUrl || ''}</div>
                  </div>
                  <Button size="sm" disabled={busy === m.id} onClick={() => doInstall(m)}>
                    <Download className="w-4 h-4 mr-1" /> Instalar
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
