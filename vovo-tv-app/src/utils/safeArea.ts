import { tv, isNative } from './tvBridge';

/**
 * Publica o espaco das barras do sistema como variavel CSS.
 *
 * No Android o env(safe-area-inset-top) do CSS so enxerga o recorte da camera,
 * nunca a barra de status, e do Android 15 em diante o app desenha atras dela.
 * Sem isto o botao Voltar do player nascia por cima do relogio.
 *
 * A medida vem do TvBridge.getInsets(). O nativo dispara "vovo:insets" quando
 * ela muda (girou a tela, barra escondida pelo modo tela cheia), e aqui a
 * gente pergunta de novo. No navegador nao ha o que fazer: as variaveis ficam
 * sem valor e o CSS cai no env(), depois no minimo de folga.
 */
const VARIAVEIS: Record<keyof Awaited<ReturnType<typeof lerInsets>>, string> = {
  top: '--inset-topo',
  bottom: '--inset-base',
  left: '--inset-esq',
  right: '--inset-dir'
};

async function lerInsets() {
  return (await tv.getInsets()) ?? { top: 0, bottom: 0, left: 0, right: 0 };
}

async function aplicar(): Promise<void> {
  const insets = await lerInsets();
  const raiz = document.documentElement;
  for (const [chave, variavel] of Object.entries(VARIAVEIS)) {
    raiz.style.setProperty(variavel, `${insets[chave as keyof typeof insets]}px`);
  }
}

/** Liga o acompanhamento. Devolve a funcao que desliga. */
export function observarSafeArea(): () => void {
  if (!isNative) return () => undefined;

  void aplicar();

  const aoMudar = () => {
    void aplicar();
  };

  // "vovo:insets" vem do nativo; os outros cobrem o giro da tela, que nem
  // sempre reemite o inset a tempo.
  window.addEventListener('vovo:insets', aoMudar);
  window.addEventListener('resize', aoMudar);
  window.addEventListener('orientationchange', aoMudar);

  return () => {
    window.removeEventListener('vovo:insets', aoMudar);
    window.removeEventListener('resize', aoMudar);
    window.removeEventListener('orientationchange', aoMudar);
  };
}
