# Receptor DLNA do Inicio (EM ANDAMENTO)

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

## Estado (2026-10-02 19:45)
- FEITO: v1.1.0 compilada e instalada na TV; log mostra "ouvindo na porta 49494", "SSDP ouvindo", servico isForeground=true.
- FALTA: rodar `tools/celular_falso.py` (faz papel do celular: busca, MP4, MKV AC3, foto, MP3, pausa, seek, volume, eventos). Midias de teste sao geradas com ffmpeg numa pasta `midia/` ao lado do script.
- FALTA: testar TV em repouso (standby) recebendo video.
- FALTA: documentar no README raiz.
