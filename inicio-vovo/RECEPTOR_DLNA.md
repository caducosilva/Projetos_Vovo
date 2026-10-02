# Receptor DLNA do Inicio 

A TV Philips 50PUG7907/78 nao tem DLNA nenhum de fabrica (so anuncia Chromecast).
O Inicio agora traz um receptor DLNA proprio, sempre ligado, que aparece nos
apps do celular (BubbleUPnP, Web Video Cast etc.) como **"TV da Vovó"**.

## Arquivos
- `ReceptorService.java`: servico em primeiro plano, wakelock parcial, multicast lock. Liga no boot (`InicioNoBoot`), ao abrir o Inicio e por vigia de 15 min (`VigiaJob`).
- `Ssdp.java`: anuncio/busca na rede (porta 1900).
- `ServidorUpnp.java`: HTTP na porta 49494: /desc.xml, SCPDs, SOAP (AVTransport, RenderingControl, ConnectionManager) e eventos GENA.
- `Scpd.java`: descricoes de servico.
- `Receptor.java`: estado compartilhado.
- `TocadorActivity.java`: tela cheia com VideoView (hardware da TV), foto e musica. OK pausa, esquerda/direita 10s, Voltar encerra.

## Instalar
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"   # o JRE padrao nao compila
./gradlew assembleDebug
adb connect 192.168.0.12:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set com.tvdavovo.inicio SYSTEM_ALERT_WINDOW allow   # abrir video por cima de outro app
adb shell dumpsys deviceidle whitelist +com.tvdavovo.inicio
```

## Testes (2026-10-02 19:44, `tools/celular_falso.py`, PC fazendo papel de celular)
Tudo OK, 30 de 30 checagens:
- busca SSDP acha "TV da Vovó" em http://192.168.0.12:49494/desc.xml; SCPDs com 15/6/3 acoes
- MP4 1080p toca, posicao anda, Pause congela, Seek para 0:25 funciona
- MKV com audio AC3 5.1 toca (o caso que trava no Chromecast via VLC)
- foto 4000x3000 aparece reduzida; MP3 toca
- volume 32 -> 7 -> 32 pelo celular
- Stop volta a TV para o Inicio
- eventos GENA chegam: PLAYING, PAUSED_PLAYBACK, STOPPED
Prints conferidos a olho. Obs.: o `screencap` dessa TV imprime uma linha de debug antes do PNG; cortar ate `PNG`.

## TV desligada (standby) e reinicio (2026-10-02 19:47-19:49)
- TV em repouso (`mWakefulness=Asleep`): o receptor continua respondendo (wakelock parcial).
- Video mandado com a TV desligada: o receptor acende a tela e toca. O sistema da Philips
  abre a ultima fonte (TV a cabo + guia) por cima ao acordar; por 20s depois de acender,
  o player volta sozinho para a frente (`TocadorActivity.onStop`). Testado: tocou 0:06 -> 0:15.
- `adb reboot`: receptor de volta sozinho em ~65s (boot -> `InicioNoBoot`), sem abrir nada.
  Permissao SYSTEM_ALERT_WINDOW e o vigia (`VigiaJob`, id 4949) sobrevivem ao reinicio.

## Limites conhecidos
- TV fora da tomada ou em standby profundo (sem rede) nao recebe nada, igual ao Chromecast.
- O VLC do celular so manda para Chromecast; para usar este receptor, use BubbleUPnP,
  Web Video Cast ou o "tocar na TV" da galeria. A TV aparece como "TV da Vovó".
- Ao ligar pelo controle, a Philips abre a TV a cabo (configuracao "ligar em" da propria TV).
  O botao Home continua indo para o Inicio.
