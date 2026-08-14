# Projetos da Vovó

Dois aplicativos Android feitos para uma pessoa idosa usar sozinha: um de TV ao
vivo e um de rádio. Fonte grande, botão grande, nada de menu escondido, nada de
login e nenhum anúncio.

**Licença:** [MIT](LICENSE)

---

## O problema

1. **O que é:** dois apps React empacotados em Android com Capacitor, um para
   assistir canais abertos e outro para ouvir rádio.
2. **Qual necessidade ataca:** minha avó não consegue usar os aplicativos comuns
   de TV e rádio. Ela erra o alvo do toque, se perde em menu de três níveis e
   fecha a tela sem querer.
3. **Por que existe:** os apps gratuitos de IPTV e rádio vivem de propaganda em
   tela cheia, pedem cadastro, mudam de layout a cada atualização e enterram o
   botão de tocar dentro de submenu.
4. **Qual o objetivo:** abrir o app e já estar em uma grade de canais grandes,
   com um toque para tocar e um toque para voltar.

---

## Os aplicativos

### Vovó TV Brasil (`vovo-tv-app`)

TV ao vivo com mais de 750 canais abertos e regionais do Brasil e da América
Latina, entre eles TV Diário de Mogi das Cruzes, Globo SP, SBT, Record, Band,
Cultura, RedeTV, Aparecida, Canção Nova e os canais de notícias.

- Filtros por tema: abertos nacionais, São Paulo e Mogi das Cruzes, religiosos,
  notícias, filmes e novelas, infantil, esportes e América Latina.
- Verificação de sinal antes de entrar no canal, com barra de saúde por canal,
  para a vovó não cair em tela preta.
- Suporte a controle remoto e TV Box, com navegação por D-Pad, teclas de volume
  e tela cheia com um toque.
- Importação de lista M3U própria pela tela de configuração.

### Rádios da Vovó (`radios-vovo-app`)

Rádios brasileiras em streaming, com destaque para as de Mogi das Cruzes e as
religiosas, como Transcontinental e Aparecida.

- Barra de player fixa embaixo, sempre visível, com botão grande de tocar e
  parar.
- Timer soneca, que desliga o rádio sozinho depois do tempo escolhido. É o
  recurso mais usado do app, porque ela dorme ouvindo.
- Filtro por categoria e capa grande para cada emissora.

---

## Instalação

### Pré-requisitos

- Node.js 20 ou superior
- Android Studio com SDK instalado, apenas se for gerar o APK

### Passos

```bash
git clone https://github.com/caducosilva/Projetos_Vovo.git
cd Projetos_Vovo/vovo-tv-app     # ou radios-vovo-app
npm install
```

---

## Como usar

Rodar no navegador durante o desenvolvimento:

```bash
npm run dev
```

Gerar o APK de instalação:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

O APK sai em `android/app/build/outputs/apk/debug/`.

---

## Detalhes técnicos relevantes

### Por que `androidScheme: 'http'`

A maioria dos streams de IPTV aberto é servida em HTTP puro. Com o esquema padrão
`https` do Capacitor, o WebView do Android bloqueia todos eles como Mixed Content
e o app fica com a grade inteira sem tocar. Por isso os dois apps usam
`androidScheme: 'http'` com `cleartext` e `allowMixedContent` ligados.

### Verificação de sinal

Canal de IPTV aberto cai o tempo todo. Antes de mostrar a grade, o app testa os
canais em segundo plano e marca os que responderam, exibido pelo componente
`SignalBars`. A vovó vê a barrinha e sabe se vale a pena tocar, em vez de abrir
uma tela preta e achar que quebrou.

### Decisões de interface

| Padrão comum | Aqui |
|---|---|
| Ícone sem texto | Ícone com rótulo escrito por extenso |
| Menu lateral | Tudo na tela inicial |
| Alvo de toque de 48px | Cartão ocupando meia largura da tela |
| Confirmação com "Cancelar" e "OK" | Botão único e grande |

---

## Estrutura

```
vovo-tv-app/           app de TV ao vivo
├── src/components/    grade, player, filtros e barra de sinal
├── src/data/          lista de canais padrão
└── android/           projeto Capacitor
radios-vovo-app/       app de rádio
├── src/components/    cartões, player fixo e timer soneca
├── src/data/          lista de emissoras
└── android/           projeto Capacitor
```

O visualizador de câmeras da casa fica em repositório separado, porque guarda as
credenciais das câmeras.

Os APKs prontos não são versionados aqui. São centenas de megabytes de binário,
boa parte deles de terceiros, e o lugar deles é a aba de releases.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Grade inteira sem tocar | esquema `https` no Capacitor | Confira `androidScheme: 'http'` no `capacitor.config.ts` |
| Canal específico em tela preta | stream fora do ar | Normal em IPTV aberto, a barra de sinal já avisa |
| `npx cap sync` reclama de `dist` | build não foi feito | Rode `npm run build` antes |

---

## Apoie o projeto

Se este projeto te ajudou, considere fazer uma doação via PIX:

```
f74458dc-2a36-49bd-9250-1cef4365ebb8
```

---

## Licença

[MIT](LICENSE) - Carlos Eduardo
