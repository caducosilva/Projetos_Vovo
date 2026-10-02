# TV da Vovó

Um app Android só, para TV e TV Box, juntando o Vovó TV e o Cine Zap.

- **Tela inicial:** dois botões grandes, **TV Aberta** (Globo, Record, SBT, Band, jornais) e **Cine Zap** (filmes, séries, desenhos). Setas escolhem, OK entra, as teclas 1 e 2 entram direto.
- **Dentro de cada um:** já entra tocando. Cima/baixo troca de canal, OK (ou esquerda) abre o guia de canais, número digitado sintoniza o canal.
- **Voltar:** uma vez mostra o aviso, duas vezes (em até 3s) volta para a escolha entre TV Aberta e Cine Zap. Na escolha, Voltar duas vezes desliga o app.
- **Faixa do canal:** nome e programa no ar ("Agora / Depois") por 3 segundos ao trocar de canal ou apertar qualquer tecla, e some.
- **Na TV não aparece botão por cima da imagem:** tudo é pelo controle. Os botões existem só no celular.

ID do pacote: `com.tvdavovo.app` (instala ao lado dos apps antigos).

## Listas de canais

```bash
python tools/montar_listas.py              # usa cache de ate 6h das listas
python tools/montar_listas.py --recarregar # baixa tudo de novo
```

Junta as listas dos apps antigos, iptv-org, Free-TV, a lista do PC, Pluto TV (API oficial) e os canais gratuitos das fabricantes (LG Channels e TCL). Testa **cada link** até chegar byte de vídeo e grava só os que tocam, do mais rápido para o mais lento:

- `src/data/canais_abertos.json`: TV Aberta
- `src/data/cine_zap.json`: Cine Zap
- `tools/relatorio_teste.json`: resultado de cada link (http 403, tempo esgotado, cartão de bloqueio...)

Cada canal guarda `epg` para a programação ao vivo: `epgpw:<id>` (epg.pw) nos abertos e `pluto:<id>` no Pluto.

## Troca de link (fallback)

Canal com vários links: o player começa pelo último que funcionou naquele canal. Sem memória, consulta todos ao mesmo tempo e toca o primeiro que responder (`src/utils/corrida.ts`). Link ruim é abandonado em 6 a 12 segundos (antes eram até 20s por link, com novas tentativas do hls.js por cima).

## Prévia no PC

```bash
npm install
npm run dev        # http://127.0.0.1:5173  (como no celular)
                   # http://127.0.0.1:5173/?tv=1  (como na TV, sem botões)
```

No PC os streams passam por um proxy só de desenvolvimento (`vite.config.ts`), que faz o papel do `ProxyDeStream.java` da TV. Teclado: setas, Enter = OK, Esc = Voltar, números.

## APK

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```
