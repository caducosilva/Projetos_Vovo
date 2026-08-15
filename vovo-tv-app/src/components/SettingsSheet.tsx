import React, { useEffect, useRef, useState } from 'react';
import { Upload, Link2, Activity, Square, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { parseM3UContent } from '../utils/m3uParser';
import { checkForUpdate, installedVersionName, type AvailableUpdate } from '../utils/updater';
import { isNative } from '../utils/tvBridge';
import type { Channel } from '../types';
import { Sheet } from './Sheet';

interface SettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onImportChannels: (channels: Channel[]) => void;
  probeRunning: boolean;
  probeDone: number;
  probeTotal: number;
  healthCounts: { ok: number; doubt: number; dead: number; untested: number };
  onStartProbe: () => void;
  onStopProbe: () => void;
  onUpdateFound: (update: AvailableUpdate) => void;
}

type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;

/**
 * Ajustes e manutencao.
 *
 * Fica atras de um botao porque nada aqui e para a vovo: e o lugar onde quem
 * cuida do app importa lista, roda o teste de sinal e confere a versao. Manter
 * isso na tela principal era o que enchia o primeiro rolar de painel tecnico.
 */
export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  isOpen,
  onClose,
  onImportChannels,
  probeRunning,
  probeDone,
  probeTotal,
  healthCounts,
  onStartProbe,
  onStopProbe,
  onUpdateFound
}) => {
  const [url, setUrl] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [versao, setVersao] = useState('...');
  const [procurandoUpdate, setProcurandoUpdate] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) installedVersionName().then(setVersao);
  }, [isOpen]);

  const aplicar = (canais: Channel[], origem: string) => {
    if (canais.length === 0) {
      setAviso({ tipo: 'erro', texto: `Nenhum canal válido em ${origem}.` });
      return;
    }
    onImportChannels(canais);
    setAviso({ tipo: 'ok', texto: `${canais.length} canais adicionados.` });
  };

  const importarArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;

    setCarregando(true);
    setAviso(null);

    const leitor = new FileReader();
    leitor.onload = (evento) => {
      aplicar(parseM3UContent(String(evento.target?.result ?? '')), 'no arquivo');
      setCarregando(false);
    };
    leitor.onerror = () => {
      setAviso({ tipo: 'erro', texto: 'Não consegui ler o arquivo.' });
      setCarregando(false);
    };
    leitor.readAsText(arquivo);

    // Permite escolher o mesmo arquivo de novo depois de um erro
    e.target.value = '';
  };

  const importarUrl = async () => {
    const endereco = url.trim();
    if (!endereco) return;

    setCarregando(true);
    setAviso(null);
    try {
      const resposta = await fetch(endereco);
      if (!resposta.ok) throw new Error(`servidor respondeu ${resposta.status}`);
      aplicar(parseM3UContent(await resposta.text()), 'no endereço');
      setUrl('');
    } catch (error) {
      setAviso({
        tipo: 'erro',
        texto: `Não consegui baixar a lista: ${
          error instanceof Error ? error.message : 'endereço inválido'
        }`
      });
    } finally {
      setCarregando(false);
    }
  };

  const procurarAtualizacao = async () => {
    setProcurandoUpdate(true);
    setAviso(null);
    try {
      const nova = await checkForUpdate(true);
      if (nova) {
        onUpdateFound(nova);
        onClose();
      } else {
        setAviso({ tipo: 'ok', texto: 'O app já está na versão mais nova.' });
      }
    } finally {
      setProcurandoUpdate(false);
    }
  };

  const totalTestado = healthCounts.ok + healthCounts.doubt + healthCounts.dead;

  return (
    <Sheet isOpen={isOpen} title="Ajustes" onClose={onClose}>
      <div className="flex flex-col gap-6 pb-6">
        {aviso && (
          <div
            className={`flex items-center gap-3 rounded-2xl border-2 p-4 ${
              aviso.tipo === 'ok'
                ? 'border-vivo-400/40 bg-vivo-400/10 text-vivo-400'
                : 'border-morto-400/40 bg-morto-400/10 text-morto-400'
            }`}
            role="status"
          >
            {aviso.tipo === 'ok' ? (
              <CheckCircle2 className="h-7 w-7 shrink-0" strokeWidth={2.5} />
            ) : (
              <AlertCircle className="h-7 w-7 shrink-0" strokeWidth={2.5} />
            )}
            <p className="text-base leading-snug font-bold">{aviso.texto}</p>
          </div>
        )}

        <section>
          <h3 className="mb-3 text-xl font-black text-tinta-100">Lista de canais</h3>

          <input
            ref={inputArquivo}
            type="file"
            accept=".m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl"
            onChange={importarArquivo}
            className="hidden"
          />

          <button
            onClick={() => inputArquivo.current?.click()}
            disabled={carregando}
            className="mb-2.5 flex h-toque w-full items-center justify-center gap-2 rounded-2xl bg-sol-400 text-lg font-black text-noite-900 transition active:scale-95 disabled:opacity-50"
          >
            <Upload className="h-6 w-6" strokeWidth={2.5} />
            Abrir arquivo M3U
          </button>

          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://... lista.m3u"
              className="h-toque min-w-0 flex-1 rounded-2xl border-2 border-noite-500 bg-noite-700 px-4 text-base font-bold text-tinta-100 placeholder-tinta-500 outline-none focus:border-sol-400"
            />
            <button
              onClick={importarUrl}
              disabled={carregando || !url.trim()}
              className="flex h-toque w-toque shrink-0 items-center justify-center rounded-2xl border-2 border-noite-500 bg-noite-700 text-tinta-100 transition active:scale-95 disabled:opacity-40"
              aria-label="Baixar lista deste endereço"
            >
              <Link2 className="h-6 w-6" strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-xl font-black text-tinta-100">Teste de sinal</h3>
          <p className="mb-3 text-base leading-snug text-tinta-300">
            Roda sozinho em segundo plano e coloca os canais que funcionam na frente. Só rode na
            mão se quiser forçar agora.
          </p>

          {probeRunning ? (
            <button
              onClick={onStopProbe}
              className="flex h-toque w-full items-center justify-center gap-2 rounded-2xl border-2 border-morto-400/50 bg-morto-400/15 text-lg font-black text-morto-400 transition active:scale-95"
            >
              <Square className="h-6 w-6 fill-current" />
              Parar ({probeDone}/{probeTotal})
            </button>
          ) : (
            <button
              onClick={onStartProbe}
              className="flex h-toque w-full items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-700 text-lg font-black text-tinta-100 transition active:scale-95"
            >
              <Activity className="h-6 w-6" strokeWidth={2.5} />
              Testar agora
            </button>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-2 text-base font-bold sm:grid-cols-4">
            <div className="rounded-xl bg-noite-700 p-3">
              <dt className="text-tinta-500">Bons</dt>
              <dd className="text-xl font-black text-vivo-400">{healthCounts.ok}</dd>
            </div>
            <div className="rounded-xl bg-noite-700 p-3">
              <dt className="text-tinta-500">Fracos</dt>
              <dd className="text-xl font-black text-alerta-400">{healthCounts.doubt}</dd>
            </div>
            <div className="rounded-xl bg-noite-700 p-3">
              <dt className="text-tinta-500">Sem sinal</dt>
              <dd className="text-xl font-black text-morto-400">{healthCounts.dead}</dd>
            </div>
            <div className="rounded-xl bg-noite-700 p-3">
              <dt className="text-tinta-500">A testar</dt>
              <dd className="text-xl font-black text-tinta-300">{healthCounts.untested}</dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-tinta-500">{totalTestado} canais já testados.</p>
        </section>

        <section>
          <h3 className="mb-1 text-xl font-black text-tinta-100">Versão</h3>
          <p className="mb-3 text-base text-tinta-300">Vovó TV {versao}</p>

          {isNative && (
            <button
              onClick={procurarAtualizacao}
              disabled={procurandoUpdate}
              className="flex h-toque w-full items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-700 text-lg font-black text-tinta-100 transition active:scale-95 disabled:opacity-50"
            >
              <Download className="h-6 w-6" strokeWidth={2.5} />
              {procurandoUpdate ? 'Procurando...' : 'Procurar atualização'}
            </button>
          )}
        </section>
      </div>
    </Sheet>
  );
};
