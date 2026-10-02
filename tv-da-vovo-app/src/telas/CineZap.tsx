import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import canaisData from '../data/cine_zap.json';
import type { Channel, ChannelWithHealth } from '../types';
import { loadHealth, saveHealth, markConfirmed, markPlaybackFail, signalScore } from '../utils/health';
import type { HealthMap } from '../utils/health';
import { dedupe } from '../utils/channelList';
import { tv } from '../utils/tvBridge';
import { VideoPlayer } from '../components/VideoPlayer';

/** Numero do primeiro canal, no estilo da operadora: 101, 102, 103... */
const PRIMEIRO_NUMERO = 101;

/** Quantos canais mortos seguidos o app pula sozinho antes de parar e avisar. */
const MAXIMO_PULOS = 5;

const CHAVE_ULTIMO = 'tvdavovo_cine_ultimo';

/**
 * Cine Zap: TV de zapear (canais de filme, serie e desenho).
 *
 * Nao existe tela de grade na abertura. O app entra ja tocando um canal
 * sorteado e a troca e so cima e baixo, como numa TV de operadora. A grade de
 * canais continua a um OK de distancia, dentro do player. Voltar leva para a
 * tela inicial.
 */
export default function CineZap({ onVoltar }: { onVoltar: () => void }) {
  const canais = useMemo<Channel[]>(() => dedupe(canaisData as Channel[]), []);

  /**
   * Canal fixo para depuracao: com um numero aqui o app sempre abre no mesmo
   * canal, o que permite testar o mesmo canal no PC e na TV. Em uso normal
   * fica null e o canal e sorteado a cada abertura.
   */
  const CANAL_FIXO: number | null = null;

  // Volta no ultimo canal que a vovo estava vendo; na primeira vez, sorteia.
  const [indice, setIndice] = useState(() => {
    if (CANAL_FIXO !== null) return CANAL_FIXO;
    try {
      const ultimo = localStorage.getItem(CHAVE_ULTIMO);
      const achado = ultimo ? canais.findIndex((c) => c.id === ultimo) : -1;
      if (achado >= 0) return achado;
    } catch {
      /* sem memoria: sorteia */
    }
    return canais.length > 0 ? Math.floor(Math.random() * canais.length) : 0;
  });
  useEffect(() => {
    try {
      if (canais[indice]) localStorage.setItem(CHAVE_ULTIMO, canais[indice].id);
    } catch {
      /* sem espaco */
    }
  }, [canais, indice]);

  const [health, setHealth] = useState<HealthMap>(() => loadHealth());
  const healthRef = useRef<HealthMap>(health);
  const gravarTimerRef = useRef<number | null>(null);

  const [souTv, setSouTv] = useState(false);
  useEffect(() => {
    tv.getDeviceType().then((r) => {
      if (r?.isTv) setSouTv(true);
    });
  }, []);

  const salvarSaude = useCallback((proximo: HealthMap) => {
    healthRef.current = proximo;
    setHealth(proximo);
    // grava em rajada: zapear rapido chamaria o localStorage a cada canal
    if (gravarTimerRef.current !== null) return;
    gravarTimerRef.current = window.setTimeout(() => {
      gravarTimerRef.current = null;
      saveHealth(healthRef.current);
    }, 1500);
  }, []);

  /**
   * Canal em exibicao. NAO depende do mapa de saude de proposito: tocar marca
   * o canal como confirmado, o que mudava o mapa, o que recriava este objeto e
   * remontava o player. O resultado era a imagem aparecer e sumir em laco, sem
   * erro nenhum no log. A saude entra so na lista da gaveta, mais abaixo.
   */
  const canalAtual = useMemo<ChannelWithHealth | null>(() => {
    const canal = canais[indice];
    if (!canal) return null;
    return { ...canal, health: 'unknown', signalStrength: 0 };
  }, [canais, indice]);

  const listaComSaude = useMemo<ChannelWithHealth[]>(
    () =>
      canais.map((canal) => {
        const entrada = health[canal.url];
        return {
          ...canal,
          health: entrada?.status ?? 'unknown',
          signalStrength: entrada ? (entrada.signal ?? signalScore(entrada)) : 0,
          latencyMs: entrada?.latency_ms
        };
      }),
    [canais, health]
  );

  const pulosSeguidosRef = useRef(0);

  const trocarCanal = useCallback(
    (passo: number) => {
      if (canais.length === 0) return;
      setIndice((atual) => (atual + passo + canais.length) % canais.length);
    },
    [canais.length]
  );

  const irParaCanal = useCallback(
    (canal: Channel) => {
      const alvo = canais.findIndex((c) => c.url === canal.url);
      if (alvo >= 0) {
        pulosSeguidosRef.current = 0;
        setIndice(alvo);
      }
    },
    [canais]
  );

  const aoTocar = useCallback(
    (url: string) => {
      pulosSeguidosRef.current = 0;
      const proximo = { ...healthRef.current };
      proximo[url] = markConfirmed(proximo[url]);
      salvarSaude(proximo);
    },
    [salvarSaude]
  );

  const aoFalhar = useCallback(
    (url: string, erro: string) => {
      const proximo = { ...healthRef.current };
      proximo[url] = markPlaybackFail(proximo[url], erro);
      salvarSaude(proximo);
    },
    [salvarSaude]
  );

  /**
   * O canal acabou todas as fontes dele. Num app de zapear, parar numa tela de
   * erro e pior do que seguir: pula para o proximo sozinho. O contador evita
   * varrer a lista inteira quando quem caiu foi a internet.
   */
  const aoEsgotarFontes = useCallback(() => {
    if (pulosSeguidosRef.current >= MAXIMO_PULOS) return;
    pulosSeguidosRef.current += 1;
    window.setTimeout(() => trocarCanal(1), 1200);
  }, [trocarCanal]);

  if (!canalAtual) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-noite-900 px-8 text-center">
        <p className="text-2xl font-black text-tinta-100">Nenhum canal na lista deste app.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-tinta-100">
      <VideoPlayer
        channel={canalAtual}
        numero={PRIMEIRO_NUMERO + indice}
        primeiroNumero={PRIMEIRO_NUMERO}
        isTv={souTv}
        channelList={listaComSaude}
        onSelectChannel={(c) => irParaCanal(c as Channel)}
        onClose={onVoltar}
        onPrevChannel={() => trocarCanal(-1)}
        onNextChannel={() => trocarCanal(1)}
        onPlaybackOk={aoTocar}
        onPlaybackFail={aoFalhar}
        onChannelExhausted={aoEsgotarFontes}
      />

    </div>
  );
}
