import { useEffect, useRef, useState } from 'react';
import { Tv, Clapperboard, ChevronLeft, ChevronRight } from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';
import { tv } from '../utils/tvBridge';

export type Destino = 'abertos' | 'cine';

interface InicioProps {
  onEscolher: (destino: Destino) => void;
}

const OPCOES: {
  destino: Destino;
  titulo: string;
  descricao: string;
  numero: string;
  Icone: typeof Tv;
  cor: string;
}[] = [
  {
    destino: 'abertos',
    titulo: 'TV Aberta',
    descricao: 'Globo, Record, SBT, Band e jornais',
    numero: '1',
    Icone: Tv,
    cor: 'bg-sol-400 text-noite-900'
  },
  {
    destino: 'cine',
    titulo: 'Cine Zap',
    descricao: 'Filmes, séries e desenhos',
    numero: '2',
    Icone: Clapperboard,
    cor: 'bg-cine-600 text-white'
  }
];

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia!';
  if (hora < 18) return 'Boa tarde!';
  return 'Boa noite!';
}

/**
 * Primeira tela: so duas escolhas, enormes, uma de cada cor.
 *
 * Pensada para o controle remoto: setas trocam, OK entra. O botao em foco fica
 * aceso e maior, o outro fica apagado, para nao haver duvida de qual esta
 * escolhido. As teclas 1 e 2 do controle tambem entram direto.
 */
export default function Inicio({ onEscolher }: InicioProps) {
  const [foco, setFoco] = useState(0);
  const focoRef = useRef(0);
  focoRef.current = foco;
  const [relogio, setRelogio] = useState(() => new Date());
  const [avisoSair, setAvisoSair] = useState(false);
  const ultimoVoltarRef = useRef(0);
  const avisoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setRelogio(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // Voltar duas vezes seguidas sai do app; uma vez so mostra o aviso
    const voltar = () => {
      const agora = Date.now();
      const desde = agora - ultimoVoltarRef.current;
      // o mesmo aperto pode chegar duas vezes (botao do Android + tecla)
      if (desde < 400) return;
      if (desde < 3000) {
        tv.exitApp();
        return;
      }
      ultimoVoltarRef.current = agora;
      setAvisoSair(true);
      if (avisoTimerRef.current !== null) window.clearTimeout(avisoTimerRef.current);
      avisoTimerRef.current = window.setTimeout(() => setAvisoSair(false), 3000);
    };

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFoco(0);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFoco(1);
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Select') {
        e.preventDefault();
        onEscolher(OPCOES[focoRef.current].destino);
      } else if (e.key === '1') {
        onEscolher('abertos');
      } else if (e.key === '2') {
        onEscolher('cine');
      } else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
        e.preventDefault();
        voltar();
      }
    };

    let cancelado = false;
    let remover: (() => void) | null = null;
    CapacitorApp.addListener('backButton', voltar)
      .then((h) => {
        if (cancelado) h.remove();
        else remover = () => h.remove();
      })
      .catch(() => undefined);

    window.addEventListener('keydown', aoTeclar);
    return () => {
      cancelado = true;
      if (remover) remover();
      window.removeEventListener('keydown', aoTeclar);
      if (avisoTimerRef.current !== null) window.clearTimeout(avisoTimerRef.current);
    };
  }, [onEscolher]);

  const hora = relogio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div
      className="area-segura-topo area-segura-lados area-segura-base flex min-h-screen flex-col bg-noite-900 text-tinta-100"
      style={{
        // margem em % da tela: sobrevive ao corte de borda (overscan) da TV
        paddingLeft: 'max(1rem, 5vw)',
        paddingRight: 'max(1rem, 5vw)',
        paddingTop: 'max(1rem, 5vh)',
        paddingBottom: 'max(1rem, 5vh)'
      }}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-3xl font-black sm:text-4xl">{saudacao()}</p>
          <p className="text-xl font-bold text-tinta-300 sm:text-2xl">O que vamos assistir?</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-4xl font-black tabular-nums sm:text-5xl">{hora}</p>
          <p className="text-lg font-bold text-tinta-300">{dia.charAt(0).toUpperCase() + dia.slice(1)}</p>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-stretch justify-center gap-6 py-6 sm:flex-row sm:gap-8">
        {OPCOES.map((opcao, i) => {
          const focado = foco === i;
          const { Icone } = opcao;
          return (
            <button
              key={opcao.destino}
              type="button"
              onClick={() => onEscolher(opcao.destino)}
              onMouseEnter={() => setFoco(i)}
              onFocus={() => setFoco(i)}
              aria-label={`${opcao.titulo}: ${opcao.descricao}`}
              className={`relative flex min-h-[38vh] flex-1 flex-col items-center justify-center gap-4 rounded-[2rem] p-6 text-center transition-all duration-200 sm:max-w-[44vw] ${opcao.cor} ${
                focado
                  ? 'scale-[1.03] opacity-100 shadow-[0_0_0_8px_#ffffff] sm:scale-105'
                  : 'scale-100 opacity-50'
              }`}
            >
              <span className="absolute top-4 left-5 flex h-12 w-12 items-center justify-center rounded-full bg-black/20 text-2xl font-black">
                {opcao.numero}
              </span>
              <Icone className="h-24 w-24 sm:h-32 sm:w-32" strokeWidth={2} />
              <span className="text-5xl leading-none font-black sm:text-6xl">{opcao.titulo}</span>
              <span className="max-w-[22ch] text-2xl leading-tight font-bold opacity-90">{opcao.descricao}</span>
              <span
                className={`mt-2 rounded-full bg-black/25 px-6 py-2 text-xl font-black transition-opacity ${
                  focado ? 'opacity-100' : 'opacity-0'
                }`}
              >
                Aperte OK
              </span>
            </button>
          );
        })}
      </main>

      <footer className="flex items-center justify-center gap-3 text-xl font-bold text-tinta-300">
        <ChevronLeft className="h-7 w-7 text-sol-400" strokeWidth={3} />
        <span>setas para escolher</span>
        <ChevronRight className="h-7 w-7 text-sol-400" strokeWidth={3} />
      </footer>

      {avisoSair && (
        <div className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-2xl border-2 border-sol-400 bg-noite-800/95 px-6 py-3 text-xl font-black text-sol-400 shadow-2xl">
          Aperte Voltar de novo para desligar
        </div>
      )}
    </div>
  );
}
