# Projetos da Vovó

Dois aplicativos Android para a TV da vovó (uma Philips Android TV), feitos para
uma pessoa idosa usar sozinha: o **TV da Vovó**, que junta TV ao vivo e filmes
num app só, e o **Início**, a tela inicial da TV. Fonte grande, botão grande,
nada de menu escondido, nada de login e nenhum anúncio.

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

### TV da Vovó (`tv-da-vovo-app`)

Um app só, para TV e celular, que substituiu o antigo Vovó TV Brasil e o Cine
Zap (o código deles fica no histórico do git). Pacote `com.tvdavovo.app`.

- **Tela inicial com dois botões grandes:** **TV Aberta** (Globo, Record, SBT,
  Band, jornais, regionais) e **Cine Zap** (filmes, séries, desenhos). Setas
  escolhem, OK entra, as teclas 1 e 2 entram direto.
- **Já entra tocando.** Cima/baixo troca de canal, OK abre o guia, número
  digitado sintoniza o canal.
- **Faixa do canal:** nome e programa no ar ("Agora / Depois") por 3 segundos
  a cada troca.
- **Voltar duas vezes** volta para a escolha entre TV Aberta e Cine Zap; na
  escolha, sai do app. Um aperto sem querer não derruba nada.
- **Troca de link automática:** canal com vários links toca o primeiro que
  responder e abandona link ruim em 6 a 12 segundos.
- Listas montadas pelo `tools/montar_listas.py`, que testa **cada link** até
  chegar vídeo e só grava os que tocam.
- Chromecast/DLNA, câmeras de casa e atualização pelo próprio app, herdados do
  Vovó TV (detalhes abaixo).

Detalhes de uso e das listas no [README do app](tv-da-vovo-app/README.md).

### Início (`inicio-vovo`)

Tela inicial (launcher) da TV, no lugar da tela da fábrica cheia de
recomendação. Pacote `com.tvdavovo.inicio`, Java puro, sem dependência, APK
de 46 KB.

- Mostra **só as entradas HDMI** e **os aplicativos instalados**.
- O TV da Vovó vem primeiro, depois Netflix, Globoplay, YouTube e os outros
  de uso comum; o resto em ordem alfabética.
- A casinha do controle sempre volta para ele, e Voltar ali não faz nada.
- Foco com borda amarela grossa, para ver de longe onde está.

```bash
cd inicio-vovo && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**Receptor de vídeos do celular (DLNA).** A TV não tem DLNA de fábrica, só
Chromecast. O Início traz um receptor próprio, sempre ligado, que aparece nos
apps do celular como **"TV da Vovó"**: vídeo (inclusive MKV com áudio AC3),
música e foto, tocados no player de hardware da TV, sem o celular converter
nada. Acende a TV se ela estiver em repouso. Detalhes e testes em
[`inicio-vovo/RECEPTOR_DLNA.md`](inicio-vovo/RECEPTOR_DLNA.md).

Na primeira vez a TV pergunta qual tela inicial usar: escolha **Início** e
"Sempre".

---

## Instalação

### Pré-requisitos

- Node.js 20 ou superior
- Android Studio com SDK instalado, apenas se for gerar o APK

### Passos

```bash
git clone https://github.com/caducosilva/Projetos_Vovo.git
cd Projetos_Vovo/tv-da-vovo-app
npm install
```

---

## Como usar

Rodar no navegador durante o desenvolvimento:

```bash
npm run dev
```

Rodar os testes:

```bash
npm test
```

Gerar o APK de instalação:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

O APK sai em `android/app/build/outputs/apk/debug/`.

---

## Publicar uma atualização

O app avisa a vovó sozinho quando existe versão nova. Para publicar uma:

1. Suba o `versionCode` e o `versionName` em
   `tv-da-vovo-app/android/app/build.gradle`. O `versionCode` precisa ser **maior**
   que o instalado, senão o app não oferece nada.
2. Gere o APK e publique na aba *Releases* deste repositório.
3. Edite `tv-da-vovo-app/update.json` com o mesmo `versionCode`, o `versionName`, a
   URL do APK publicado e uma frase curta em `notes` explicando o que mudou.
   Essa frase é lida pela vovó, então nada de "refactor" ou "bump deps".
4. Faça commit do `update.json`. O app checa a cada 6 horas e na abertura.

Quem já dispensou uma versão não é perguntado de novo sobre ela, mas o botão
*Procurar atualização* em Ajustes força a checagem na hora.

---

## Detalhes técnicos relevantes

### Por que `androidScheme: 'http'`

A maioria dos streams de IPTV aberto é servida em HTTP puro. Com o esquema padrão
`https` do Capacitor, o WebView do Android bloqueia todos eles como Mixed Content
e o app fica com a grade inteira sem tocar. Por isso o app usa
`androidScheme: 'http'` com `cleartext` e `allowMixedContent` ligados.

### Verificação de sinal

Canal de IPTV aberto cai o tempo todo. O app testa os canais em segundo plano,
sozinho, e usa o resultado só para ordenar: o que responde rápido sobe, o que
está morto some da grade (a não ser que seja favorito, senão a vovó abre os
favoritos e não acha o que guardou).

O número em milissegundos, a contagem de "bons e fracos" e o botão de testar na
mão viviam na tela inicial e empurravam o primeiro canal para fora dela. Hoje
tudo isso mora em Ajustes, que é onde quem cuida do app precisa, e não ela.

### Mandar para a TV: Chromecast e DLNA

Por muito tempo só existia o caminho DLNA aqui, e o botão "TV" simplesmente não
funcionava na casa. O motivo é que a TV da sala é uma Philips com **Chromecast
embutido**: ela não expõe `AVTransport` nenhum, então a busca SSDP achava só o
Xbox e nunca a televisão. O `CastBridge` resolve isso falando Google Cast, o
mesmo protocolo que o painel do PC já usava com sucesso nessa TV.

Três coisas desse plugin merecem ficar escritas:

- Quem procura os aparelhos é o Play Services, e ele só começa depois que o app
  pede o `CastContext` pelo menos uma vez. Sem essa primeira chamada o
  `MediaRouter` devolve lista vazia mesmo com a TV ligada.
- Tudo que é Cast exige a thread principal. A parte de rede (baixar a playlist)
  roda fora dela, e as duas conversam pelo `Handler` do main looper.
- O receptor padrão do Chromecast engasga com master playlist de canal ao vivo:
  fica em buffer eterno e a tela não mostra nada. O plugin lê a playlist antes,
  escolhe a variante de maior banda e manda essa. Foi o que fez funcionar.

O DLNA continua no app para aparelho que só tem ele, e a tela mostra os dois
tipos numa lista só: a vovó escolhe a TV pelo nome, não pelo protocolo.

### Espelhamento DLNA

O WebView do Android não abre socket UDP, e a descoberta de TVs na rede é SSDP,
que é multicast UDP puro. Por isso o `DlnaBridge` é um plugin nativo em Java,
sem biblioteca externa: manda um `M-SEARCH`, lê o XML de descrição de cada
aparelho que responde, guarda a URL de controle do `AVTransport` e depois emite
`SetAVTransportURI` seguido de `Play` por SOAP.

Dois detalhes que custaram a descobrir e valem ficar escritos:

- Sem `MulticastLock` (e a permissão `CHANGE_WIFI_MULTICAST_STATE`) o Android
  descarta os pacotes multicast para poupar bateria, e a busca volta sempre
  vazia mesmo com a TV ligada do lado.
- O `controlURL` precisa vir do **mesmo** bloco `<service>` que o
  `serviceType`. Casar um com o outro entre blocos diferentes manda o comando
  para o endereço errado, e a TV ignora sem responder nada.

**Limitação real:** muitas TVs com DLNA não abrem HLS (`.m3u8`), que é o formato
da maior parte dos canais de IPTV. Nesses casos a TV recebe o comando e fica
parada. O app detecta o formato e avisa antes de tentar, em vez de deixar a
pessoa achando que quebrou.

### Câmeras de casa dentro do app de TV

As câmeras aparecem como canais, na categoria "Câmeras de Casa", para a vovó não
precisar aprender um segundo aplicativo. O caminho é
`câmera → RTSP → ffmpeg → HLS → o mesmo player dos canais`.

O RTSP não toca em WebView, então quem converte é o `servidor.py` do
repositório privado das câmeras. Ele publica `/api/cameras` com id e nome de
cada uma, e o app monta os canais a partir daí. **A senha da câmera nunca sai
do servidor**: o app só recebe id, nome e a URL do HLS já convertido.

O endereço do computador fica em Ajustes, gravado no aparelho, e não no código:
o repositório é público e não deve carregar o mapa da rede da casa. O app
reconsulta a lista a cada minuto, então se o computador estiver desligado na
hora que a vovó abrir o app, as câmeras aparecem sozinhas quando ele voltar.

**Dependência real:** isso só funciona com o computador ligado, na mesma rede,
rodando o `servidor.py`. Desligou o computador, o canal da câmera para. Câmera
sem sinal continua aparecendo na grade de propósito, com um aviso ao tocar, em
vez de sumir e a vovó achar que o app perdeu a câmera.

Para não depender de alguém lembrar de abrir o servidor, existe a tarefa
agendada **`VovoCameras`**, que roda `cameras-vovo/iniciar_cameras.ps1` no logon
do Windows. O script sobe o `servidor.py` sem janela e só sobe se a porta 8790
estiver livre: o `servidor.py` usa `allow_reuse_address`, então dois servidores
conseguiriam subir ao mesmo tempo e as câmeras ficariam aparecendo e sumindo.

```powershell
Get-ScheduledTask -TaskName VovoCameras     # conferir
Start-ScheduledTask -TaskName VovoCameras   # subir agora
```

O log fica em `cameras-vovo/iniciar_cameras.log`.

### Atualização pelo próprio app

O app não vive na Play Store. O caminho normal para atualizar seria abrir o
navegador, achar a pasta de downloads, tocar no arquivo e liberar "origem
desconhecida", que é passo demais para a vovó.

Então o app lê o `tv-da-vovo-app/update.json` deste repositório, compara o
`versionCode` com o instalado e, se houver versão nova, oferece baixar. O
download usa o `DownloadManager` do sistema e o APK é entregue ao instalador
pelo `FileProvider`. Falha de rede aqui nunca vira mensagem de erro: o app
simplesmente segue funcionando.

### Decisões de interface

| Padrão comum | Aqui |
|---|---|
| Ícone sem texto | Ícone com rótulo escrito por extenso |
| Menu lateral | Tudo na tela inicial |
| Alvo de toque de 48px | Mínimo de 56px, e o cartão inteiro é o botão |
| Confirmação com "Cancelar" e "OK" | Botão único e grande |
| Fita de categorias que rola de lado | Lista de tela cheia, uma por linha |
| Diagnóstico técnico na tela | Escondido em Ajustes |
| Erro em linguagem de sistema | "Este canal não está no ar agora." |

---

## Estrutura

```
tv-da-vovo-app/           app de TV (TV Aberta + Cine Zap), TV e celular
├── src/telas/            Inicio, TvAberta, CineZap
├── src/components/       player, faixa do canal, painéis de tela cheia
├── src/utils/            corrida de links, programação, fontes, TVs da casa, atualizador
├── src/data/             canais_abertos.json e cine_zap.json
├── android/.../TvBridge.java      brilho, volume, rotação, tela acesa
├── android/.../ProxyDeStream.java proxy local dos streams na TV
├── android/.../DlnaBridge.java    descoberta SSDP e controle AVTransport
├── android/.../CastBridge.java    Google Cast (Chromecast embutido da TV)
├── android/.../UpdateBridge.java  download do APK e chamada do instalador
├── tools/montar_listas.py         monta e testa as listas de canais
└── update.json           manifesto de versão lido pelo app (criar ao publicar)
inicio-vovo/              tela inicial da TV: entradas HDMI e aplicativos
└── app/src/main/java/.../MainActivity.java
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
| Canal específico em tela preta | stream fora do ar | Normal em IPTV aberto; o app desiste em 20s e oferece tentar de novo |
| `npx cap sync` reclama de `dist` | build não foi feito | Rode `npm run build` antes |
| "Nenhuma TV encontrada" com a TV ligada | celular e TV em redes diferentes, ou a TV está com DLNA desligado | Confira o Wi-Fi dos dois e procure por "DLNA" ou "compartilhamento de mídia" no menu da TV |
| A TV recebe o canal mas fica parada | a TV não abre HLS | Sem solução pelo app; assista pelo celular ou escolha um canal que não seja `.m3u8` |
| Atualização baixa e não instala | falta liberar "instalar apps desconhecidos" | O próprio app abre a tela certa; ligue a chave e volte |
| Categoria "Câmeras de Casa" vazia | endereço errado, ou `servidor.py` parado | Ajustes → Câmeras de casa → conferir o IP e tocar em Testar. No computador: `Start-ScheduledTask -TaskName VovoCameras` |
| Câmera aparece e some sozinha | dois `servidor.py` brigando pela porta 8790 | Suba sempre pelo `iniciar_cameras.ps1`, que tem a trava de instância única |
| A câmera some depois de um tempo | o IP do computador mudou (DHCP) | Reserve um IP fixo para ele no roteador |
| Uma câmera aparece e a outra não | o ffmpeg daquela câmera não está gerando stream | Confira o RTSP dela em `servidor.py`; `/stream/<id>/index.m3u8` deve responder 200 |

---

## Apoie o projeto

Se este projeto te ajudou, considere fazer uma doação via PIX:

```
f74458dc-2a36-49bd-9250-1cef4365ebb8
```

---

## Licença

[MIT](LICENSE) - Carlos Eduardo
