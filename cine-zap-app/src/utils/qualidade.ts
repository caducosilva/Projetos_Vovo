/**
 * Escolha da faixa de qualidade do HLS.
 *
 * O alvo e 720p. Um canal HLS costuma vir com varias faixas (360p, 480p,
 * 720p, 1080p) e quem escolhe qual toca e o app, nao a emissora. Duas coisas
 * atrapalhavam isso aqui:
 *
 * 1. Boa parte da lista (os canais do Pluto TV) NAO declara resolucao nenhuma
 *    no manifesto: as faixas vem so com BANDWIDTH. Toda regra escrita em cima
 *    de `height` via zero em todas elas e acabava escolhendo a primeira da
 *    lista, que no hls.js e sempre a de MENOR bitrate. Resultado: 175 canais
 *    travados na pior faixa possivel.
 * 2. `capLevelToPlayerSize` deixava o hls.js recalcular o teto pelo tamanho do
 *    elemento de video. Na WebView da TV essa medida vem baixa e derrubava a
 *    escolha feita aqui.
 *
 * Quando o manifesto nao mede a altura, a unica pista que sobra e o bitrate:
 * pega a faixa mais gorda ate um teto sensato. No Pluto isso cai exatamente
 * na faixa de 3.3 Mb, que e a de 1280x720.
 */

/** So o que interessa de um `Level` do hls.js, para dar para testar sem ele. */
export interface NivelDeVideo {
  height?: number;
  width?: number;
  bitrate?: number;
  frameRate?: number;
}

export interface EscolhaDeQualidade {
  /** Indice na lista original de faixas. -1 quando nao ha faixa nenhuma. */
  indice: number;
  /** Altura declarada da faixa escolhida. 0 quando o manifesto nao declara. */
  altura: number;
  /** true quando a escolha saiu do bitrate, porque nao havia altura declarada. */
  estimada: boolean;
  /** Por que esta faixa ganhou. Vai para o log, e o que se le na TV. */
  motivo: string;
}

export const ALTURA_ALVO = 720;

/** Acima disso a faixa quase certamente e 1080p+ e a TV engasga. */
const TETO_SEM_MEDIDA = 6_000_000;

/** Acima de 31 quadros a Philips comeca a picotar; serve so de desempate. */
const FPS_CONFORTAVEL = 31;

function bitrate(nivel: NivelDeVideo): number {
  return nivel.bitrate || 0;
}

function fpsCabe(nivel: NivelDeVideo): boolean {
  const fps = nivel.frameRate || 0;
  return fps === 0 || fps <= FPS_CONFORTAVEL;
}

/** Melhor de um grupo: fps confortavel na frente, depois o maior bitrate. */
function melhorDoGrupo(niveis: { nivel: NivelDeVideo; indice: number }[]): number {
  let escolhido = -1;
  let melhorFps = false;
  let melhorBitrate = -1;

  for (const { nivel, indice } of niveis) {
    const cabe = fpsCabe(nivel);
    const taxa = bitrate(nivel);
    const ganha =
      escolhido === -1 || (cabe && !melhorFps) || (cabe === melhorFps && taxa > melhorBitrate);
    if (ganha) {
      escolhido = indice;
      melhorFps = cabe;
      melhorBitrate = taxa;
    }
  }
  return escolhido;
}

/**
 * Qual faixa tocar. Ordem de preferencia:
 *
 * 1. 720p na bucha;
 * 2. a menor faixa entre 720p e 1080p (na TV, 1080p reduzido para a tela ainda
 *    e melhor do que 480p esticado);
 * 3. a maior faixa abaixo de 720p;
 * 4. a menor faixa acima de 1080p, se so houver isso;
 * 5. sem altura declarada em faixa nenhuma: a de maior bitrate ate o teto.
 */
export function escolherNivel(niveis: NivelDeVideo[]): EscolhaDeQualidade {
  if (!niveis || niveis.length === 0) {
    return { indice: -1, altura: 0, estimada: false, motivo: 'sem faixas' };
  }

  const comAltura = niveis
    .map((nivel, indice) => ({ nivel, indice }))
    .filter(({ nivel }) => (nivel.height || 0) > 0);

  if (comAltura.length === 0) {
    // Manifesto sem RESOLUTION (Pluto TV): so o bitrate diz alguma coisa.
    const cabemNoTeto = niveis
      .map((nivel, indice) => ({ nivel, indice }))
      .filter(({ nivel }) => bitrate(nivel) <= TETO_SEM_MEDIDA);
    const candidatos = cabemNoTeto.length > 0 ? cabemNoTeto : niveis.map((nivel, indice) => ({ nivel, indice }));

    let escolhido = candidatos[0].indice;
    let maior = bitrate(candidatos[0].nivel);
    for (const { nivel, indice } of candidatos) {
      if (bitrate(nivel) > maior) {
        maior = bitrate(nivel);
        escolhido = indice;
      }
    }
    return {
      indice: escolhido,
      altura: 0,
      estimada: true,
      motivo: `sem resolucao declarada, maior bitrate (${Math.round(maior / 1000)} kb)`
    };
  }

  const exatos = comAltura.filter(({ nivel }) => nivel.height === ALTURA_ALVO);
  if (exatos.length > 0) {
    const indice = melhorDoGrupo(exatos);
    return { indice, altura: ALTURA_ALVO, estimada: false, motivo: '720p exato' };
  }

  const acima = comAltura.filter(
    ({ nivel }) => (nivel.height || 0) > ALTURA_ALVO && (nivel.height || 0) <= 1080
  );
  if (acima.length > 0) {
    let escolhido = acima[0];
    for (const item of acima) {
      if ((item.nivel.height || 0) < (escolhido.nivel.height || 0)) escolhido = item;
    }
    const altura = escolhido.nivel.height || 0;
    const mesmaAltura = acima.filter(({ nivel }) => nivel.height === altura);
    return {
      indice: melhorDoGrupo(mesmaAltura),
      altura,
      estimada: false,
      motivo: `sem 720p, usando ${altura}p`
    };
  }

  const abaixo = comAltura.filter(({ nivel }) => (nivel.height || 0) < ALTURA_ALVO);
  if (abaixo.length > 0) {
    let maiorAltura = 0;
    for (const item of abaixo) maiorAltura = Math.max(maiorAltura, item.nivel.height || 0);
    const melhores = abaixo.filter(({ nivel }) => nivel.height === maiorAltura);
    return {
      indice: melhorDoGrupo(melhores),
      altura: maiorAltura,
      estimada: false,
      motivo: `canal so oferece ate ${maiorAltura}p`
    };
  }

  // So sobrou coisa acima de 1080p
  let menor = comAltura[0];
  for (const item of comAltura) {
    if ((item.nivel.height || 0) < (menor.nivel.height || 0)) menor = item;
  }
  const altura = menor.nivel.height || 0;
  return {
    indice: menor.indice,
    altura,
    estimada: false,
    motivo: `canal so oferece acima de 1080p, usando ${altura}p`
  };
}

/** Etiqueta curta para a tela: 1280x720 vira "720p". */
export function rotuloDaQualidade(altura: number): string {
  if (!altura || altura <= 0) return '';
  if (altura >= 2000) return '4K';
  return `${altura}p`;
}
