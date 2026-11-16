import React, { useEffect, useRef, useState } from 'react';
import {
  programacaoDoCanal,
  horaCurta,
  horarioDoPrograma,
  progressoDoPrograma,
  type AgoraEDepois
} from '../utils/programacao';

interface FaixaDoCanalProps {
  numero?: number;
  nome: string;
  logo?: string;
  categoria?: string;
  /** chave do guia de programacao do canal */
  epg?: string;
  /** muda de valor para a faixa reaparecer sem trocar de canal (ex.: OK) */
  reacender?: number;
  /** botoes do player na tela: a faixa sobe para nao ficar por cima deles */
  acimaDosControles?: boolean;
}

/** Quanto tempo a faixa fica na tela. Depois disso some e fica so a imagem. */
const SEGUNDOS_NA_TELA = 5;

/**
 * Faixa de identificacao do canal, como na TV por assinatura: aparece ao
 * trocar de canal com o nome e o programa que esta passando, e some sozinha.
 *
 * Antes o nome ficava fixo por cima do video o tempo todo, tampando a imagem.
 *
 * Margem em porcentagem da tela (vw/vh) e nao em pixel: a TV corta cerca de 5%
 * de cada borda (overscan) e a faixa colada na beirada perdia metade do texto.
 */
export const FaixaDoCanal: React.FC<FaixaDoCanalProps> = ({
  numero,
  nome,
  logo,
  categoria,
  epg,
  reacender = 0,
  acimaDosControles = false
}) => {
  const [visivel, setVisivel] = useState(true);
  const [logoFalhou, setLogoFalhou] = useState(false);
  const [guia, setGuia] = useState<AgoraEDepois>({});
  const timerRef = useRef<number | null>(null);

  // Cada troca de canal (ou OK) reacende a faixa e reinicia os 3 segundos.
  useEffect(() => {
    setVisivel(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setVisivel(false), SEGUNDOS_NA_TELA * 1000);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [numero, nome, reacender]);

  useEffect(() => {
    setLogoFalhou(false);
  }, [logo]);

  // Programa no ar: busca a cada troca de canal e de novo ao reacender, porque
  // o programa pode ter mudado enquanto a vovo assistia.
  useEffect(() => {
    let vivo = true;
    setGuia((anterior) => (reacender === 0 ? {} : anterior));
    programacaoDoCanal(epg).then((r) => {
      if (vivo) setGuia(r);
    });
    return () => {
      vivo = false;
    };
  }, [epg, reacender]);

  const agora = guia.agora;
  const depois = guia.depois;
  const progresso = agora ? progressoDoPrograma(agora) : null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-[60] transition-all duration-500 ease-out ${
        visivel ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      }`}
      style={{
        paddingLeft: 'max(1.5rem, 6vw)',
        paddingRight: 'max(1.5rem, 6vw)',
        paddingBottom: acimaDosControles ? 'calc(max(1.5rem, 6vh) + 5.5rem)' : 'max(1.5rem, 6vh)'
      }}
      aria-hidden={!visivel}
    >
      <div className="mx-auto flex w-full max-w-[64rem] items-center gap-4 overflow-hidden rounded-2xl border border-white/15 bg-black/85 px-5 py-3 shadow-2xl backdrop-blur-md">
        {typeof numero === 'number' && (
          <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-xl bg-sol-400 text-2xl font-black leading-none text-noite-900">
            {numero}
          </div>
        )}

        {logo && !logoFalhou && (
          <img
            src={logo}
            alt=""
            onError={() => setLogoFalhou(true)}
            className="h-14 w-14 shrink-0 rounded-lg bg-white/10 object-contain p-1"
          />
        )}

        {/* min-w-0 e o que deixa o truncate funcionar dentro do flex */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-black leading-tight text-white">{nome}</p>
          {agora ? (
            <>
              <p className="truncate text-lg font-bold leading-snug text-sol-400 sm:text-xl">
                Agora: {agora.titulo}
              </p>
              <p className="truncate text-sm font-bold leading-snug text-tinta-100 sm:text-base">
                {horarioDoPrograma(agora)}
              </p>
              {progresso !== null && (
                <div className="mt-1.5 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-sol-400 transition-all duration-300"
                    style={{ width: `${progresso}%` }}
                  />
                </div>
              )}
            </>
          ) : (
            categoria && <p className="truncate text-lg font-bold leading-tight text-tinta-300">{categoria}</p>
          )}
          {agora && depois && (
            <p className="mt-0.5 truncate text-sm font-semibold leading-tight text-tinta-300 sm:text-base">
              Depois ({horaCurta(depois.inicio)}): {depois.titulo}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
