package com.tvdavovo.inicio;

import android.content.Context;
import android.media.AudioManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.tvdavovo.inicio.Receptor.Xml.escapar;

/**
 * Servidor HTTP do receptor DLNA (UPnP MediaRenderer:1): descricao do
 * aparelho, as tres descricoes de servico, o controle por SOAP e os eventos
 * GENA (LastChange) para o celular saber se esta tocando ou pausado.
 *
 * Feito a mao, sem biblioteca: e pouco protocolo e o app continua pequeno.
 */
final class ServidorUpnp {

    static final int PORTA = 49494;
    static final String TIPO = "urn:schemas-upnp-org:device:MediaRenderer:1";
    static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";
    static final String RCS = "urn:schemas-upnp-org:service:RenderingControl:1";
    static final String CMS = "urn:schemas-upnp-org:service:ConnectionManager:1";
    static final String SERVIDOR = "Android/11 UPnP/1.0 TVdaVovo/1.1";
    private static final String TAG = "ReceptorDLNA";

    /** Formatos aceitos. O curinga no fim deixa o celular mandar qualquer coisa: quem decide e o player. */
    private static final String SINK;
    static {
        String[] tipos = {
            "video/mp4", "video/x-matroska", "video/x-mkv", "video/avi", "video/x-msvideo", "video/mpeg",
            "video/mp2t", "video/MP2T", "video/vnd.dlna.mpeg-tts", "video/quicktime", "video/webm",
            "video/3gpp", "video/x-flv", "video/x-ms-wmv", "video/x-ms-asf",
            "application/vnd.apple.mpegurl", "application/x-mpegURL",
            "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac", "audio/x-flac",
            "audio/wav", "audio/x-wav", "audio/L16", "audio/ogg", "audio/x-ms-wma",
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
        };
        StringBuilder sb = new StringBuilder();
        for (String t : tipos) sb.append("http-get:*:").append(t).append(":*,");
        sb.append("http-get:*:*:*");
        SINK = sb.toString();
    }

    private final Context ctx;
    private final String uuid;
    private final String nome;
    private final AudioManager audio;
    private final ExecutorService conexoes = Executors.newCachedThreadPool();
    private final ScheduledExecutorService eventos = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, Assinante> assinantes = new ConcurrentHashMap<>();
    private volatile ServerSocket servidor;
    private volatile boolean ativo;

    ServidorUpnp(Context ctx, String uuid, String nome) {
        this.ctx = ctx.getApplicationContext();
        this.uuid = uuid;
        this.nome = nome;
        this.audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    void iniciar() {
        ativo = true;
        Receptor.aoMudar = () -> eventos.execute(() -> avisarTodos(null));
        Thread t = new Thread(this::aceitar, "upnp-http");
        t.setDaemon(true);
        t.start();
    }

    void parar() {
        ativo = false;
        Receptor.aoMudar = null;
        try {
            if (servidor != null) servidor.close();
        } catch (IOException ignorado) {
        }
        conexoes.shutdownNow();
        eventos.shutdownNow();
    }

    private void aceitar() {
        while (ativo) {
            try (ServerSocket s = new ServerSocket()) {
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(PORTA));
                servidor = s;
                Log.i(TAG, "ouvindo na porta " + PORTA);
                while (ativo) {
                    final Socket c = s.accept();
                    conexoes.execute(() -> atender(c));
                }
            } catch (IOException e) {
                if (!ativo) return;
                Log.w(TAG, "servidor caiu, reabrindo: " + e);
                dormir(3000);
            }
        }
    }

    // ------------------------------------------------------------ HTTP

    private static final class Pedido {
        String metodo = "";
        String caminho = "";
        final Map<String, String> cab = new HashMap<>();
        String corpo = "";
    }

    private void atender(Socket c) {
        try (Socket s = c) {
            s.setSoTimeout(10_000);
            Pedido p = ler(s.getInputStream());
            if (p == null) return;
            OutputStream out = s.getOutputStream();
            String rota = p.caminho;
            int q = rota.indexOf('?');
            if (q >= 0) rota = rota.substring(0, q);

            if ("GET".equals(p.metodo) || "HEAD".equals(p.metodo)) {
                String xml = null;
                if ("/desc.xml".equals(rota)) xml = descricao(s.getLocalAddress().getHostAddress());
                else if ("/AVTransport.xml".equals(rota)) xml = Scpd.AVT;
                else if ("/RenderingControl.xml".equals(rota)) xml = Scpd.RCS;
                else if ("/ConnectionManager.xml".equals(rota)) xml = Scpd.CMS;
                if (xml == null) responder(out, 404, "Not Found", null, "", null);
                else responder(out, 200, "OK", "text/xml; charset=\"utf-8\"", "HEAD".equals(p.metodo) ? "" : xml, null);
            } else if ("POST".equals(p.metodo) && rota.startsWith("/ctl/")) {
                soap(out, rota.substring(5), p);
            } else if ("SUBSCRIBE".equals(p.metodo) && rota.startsWith("/evt/")) {
                assinar(out, rota.substring(5), p);
            } else if ("UNSUBSCRIBE".equals(p.metodo)) {
                String sid = p.cab.get("sid");
                if (sid != null) assinantes.remove(sid.trim());
                responder(out, 200, "OK", null, "", null);
            } else {
                responder(out, 405, "Method Not Allowed", null, "", null);
            }
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "falha atendendo: " + e);
        }
    }

    private static Pedido ler(InputStream in) throws IOException {
        ByteArrayOutputStream cab = new ByteArrayOutputStream();
        int b, fim = 0;
        while ((b = in.read()) != -1) {
            cab.write(b);
            fim = (b == '\r' || b == '\n') ? fim + 1 : 0;
            if (fim == 4 || cab.size() > 32_768) break;
        }
        String[] linhas = cab.toString("ISO-8859-1").split("\r\n");
        if (linhas.length == 0 || linhas[0].isEmpty()) return null;
        Pedido p = new Pedido();
        String[] primeira = linhas[0].split(" ");
        if (primeira.length < 2) return null;
        p.metodo = primeira[0].toUpperCase(Locale.ROOT);
        p.caminho = primeira[1];
        for (int i = 1; i < linhas.length; i++) {
            int dp = linhas[i].indexOf(':');
            if (dp > 0) p.cab.put(linhas[i].substring(0, dp).trim().toLowerCase(Locale.ROOT), linhas[i].substring(dp + 1).trim());
        }
        int tamanho = 0;
        try {
            tamanho = Integer.parseInt(p.cab.getOrDefault("content-length", "0"));
        } catch (NumberFormatException ignorado) {
        }
        if (tamanho > 0) {
            byte[] corpo = new byte[Math.min(tamanho, 1_048_576)];
            int lido = 0;
            while (lido < corpo.length) {
                int n = in.read(corpo, lido, corpo.length - lido);
                if (n < 0) break;
                lido += n;
            }
            p.corpo = new String(corpo, 0, lido, StandardCharsets.UTF_8);
        }
        return p;
    }

    private static void responder(OutputStream out, int codigo, String texto, String tipo, String corpo,
                                  Map<String, String> extras) throws IOException {
        byte[] dados = corpo.getBytes(StandardCharsets.UTF_8);
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(codigo).append(' ').append(texto).append("\r\n");
        if (tipo != null) sb.append("Content-Type: ").append(tipo).append("\r\n");
        sb.append("Content-Length: ").append(dados.length).append("\r\n");
        sb.append("Server: ").append(SERVIDOR).append("\r\n");
        sb.append("Connection: close\r\n");
        if (extras != null) for (Map.Entry<String, String> e : extras.entrySet())
            sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(dados);
        out.flush();
    }

    private String descricao(String ip) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            + "<root xmlns=\"urn:schemas-upnp-org:device-1-0\" xmlns:dlna=\"urn:schemas-dlna-org:device-1-0\">"
            + "<specVersion><major>1</major><minor>0</minor></specVersion>"
            + "<URLBase>http://" + ip + ":" + PORTA + "/</URLBase>"
            + "<device>"
            + "<deviceType>" + TIPO + "</deviceType>"
            + "<dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>"
            + "<friendlyName>" + escapar(nome) + "</friendlyName>"
            + "<manufacturer>TV da Vovo</manufacturer>"
            + "<manufacturerURL>https://github.com/caducosilva/Projetos_Vovo</manufacturerURL>"
            + "<modelDescription>Receptor de midia da TV da Vovo</modelDescription>"
            + "<modelName>Receptor TV da Vovo</modelName>"
            + "<modelNumber>1.1</modelNumber>"
            + "<UDN>uuid:" + uuid + "</UDN>"
            + "<serviceList>"
            + servico(AVT, "AVTransport")
            + servico(RCS, "RenderingControl")
            + servico(CMS, "ConnectionManager")
            + "</serviceList>"
            + "</device></root>";
    }

    private static String servico(String tipo, String nome) {
        return "<service><serviceType>" + tipo + "</serviceType>"
            + "<serviceId>urn:upnp-org:serviceId:" + nome + "</serviceId>"
            + "<SCPDURL>/" + nome + ".xml</SCPDURL>"
            + "<controlURL>/ctl/" + nome + "</controlURL>"
            + "<eventSubURL>/evt/" + nome + "</eventSubURL></service>";
    }

    // ------------------------------------------------------------ SOAP

    private static final class ErroUpnp extends Exception {
        final int codigo;

        ErroUpnp(int codigo, String descricao) {
            super(descricao);
            this.codigo = codigo;
        }
    }

    private void soap(OutputStream out, String servico, Pedido p) throws IOException {
        String acao = p.cab.getOrDefault("soapaction", "").replace("\"", "");
        int h = acao.indexOf('#');
        if (h >= 0) acao = acao.substring(h + 1);
        String tipo = "AVTransport".equals(servico) ? AVT : "RenderingControl".equals(servico) ? RCS : CMS;
        Log.i(TAG, servico + "#" + acao);
        try {
            Map<String, String> saida;
            if ("AVTransport".equals(servico)) saida = avTransport(acao, p.corpo);
            else if ("RenderingControl".equals(servico)) saida = renderingControl(acao, p.corpo);
            else if ("ConnectionManager".equals(servico)) saida = connectionManager(acao);
            else throw new ErroUpnp(401, "Invalid Action");
            StringBuilder sb = new StringBuilder();
            sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")
                .append("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" ")
                .append("s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>")
                .append("<u:").append(acao).append("Response xmlns:u=\"").append(tipo).append("\">");
            for (Map.Entry<String, String> e : saida.entrySet())
                sb.append('<').append(e.getKey()).append('>').append(escapar(e.getValue()))
                    .append("</").append(e.getKey()).append('>');
            sb.append("</u:").append(acao).append("Response></s:Body></s:Envelope>");
            Map<String, String> ext = new LinkedHashMap<>();
            ext.put("EXT", "");
            responder(out, 200, "OK", "text/xml; charset=\"utf-8\"", sb.toString(), ext);
        } catch (ErroUpnp e) {
            Log.w(TAG, "erro " + e.codigo + " em " + acao + ": " + e.getMessage());
            String corpo = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><s:Fault>"
                + "<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>"
                + "<UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\"><errorCode>" + e.codigo
                + "</errorCode><errorDescription>" + escapar(e.getMessage()) + "</errorDescription>"
                + "</UPnPError></detail></s:Fault></s:Body></s:Envelope>";
            responder(out, 500, "Internal Server Error", "text/xml; charset=\"utf-8\"", corpo, null);
        }
    }

    private static String arg(String corpo, String nome) {
        Matcher m = Pattern.compile("<(?:[\\w-]+:)?" + nome + "(?:\\s[^>]*)?>(.*?)</(?:[\\w-]+:)?" + nome + ">",
            Pattern.DOTALL).matcher(corpo);
        if (m.find()) return Receptor.Xml.desescapar(m.group(1));
        return "";
    }

    private Map<String, String> avTransport(String acao, String corpo) throws ErroUpnp {
        Map<String, String> r = new LinkedHashMap<>();
        boolean temMidia = !Receptor.uri.isEmpty();
        switch (acao) {
            case "SetAVTransportURI": {
                String u = arg(corpo, "CurrentURI").trim();
                if (u.isEmpty()) throw new ErroUpnp(716, "Resource not found");
                Receptor.proxUri = "";
                Receptor.proxMeta = "";
                Receptor.definir(u, arg(corpo, "CurrentURIMetaData"));
                Log.i(TAG, "midia: " + u);
                return r;
            }
            case "SetNextAVTransportURI":
                Receptor.proxUri = arg(corpo, "NextURI").trim();
                Receptor.proxMeta = arg(corpo, "NextURIMetaData");
                return r;
            case "Play":
                if (!temMidia) throw new ErroUpnp(701, "Transition not available");
                Receptor.tocar(ctx);
                return r;
            case "Pause":
                Receptor.pausar();
                return r;
            case "Stop":
                Receptor.parar();
                return r;
            case "Seek": {
                String unidade = arg(corpo, "Unit");
                String alvo = arg(corpo, "Target");
                if ("REL_TIME".equals(unidade) || "ABS_TIME".equals(unidade)) {
                    long ms = Receptor.ms(alvo);
                    if (ms < 0) throw new ErroUpnp(711, "Illegal seek target");
                    Receptor.buscar(ms);
                } else if (!"TRACK_NR".equals(unidade)) {
                    throw new ErroUpnp(710, "Seek mode not supported");
                }
                return r;
            }
            case "Next":
            case "Previous":
            case "SetPlayMode":
                return r;
            case "GetTransportInfo":
                r.put("CurrentTransportState", Receptor.estado);
                r.put("CurrentTransportStatus", "OK");
                r.put("CurrentSpeed", "1");
                return r;
            case "GetPositionInfo":
                r.put("Track", temMidia ? "1" : "0");
                r.put("TrackDuration", Receptor.hms(Receptor.duracaoMs));
                r.put("TrackMetaData", Receptor.meta);
                r.put("TrackURI", Receptor.uri);
                r.put("RelTime", Receptor.hms(Receptor.posicaoMs));
                r.put("AbsTime", Receptor.hms(Receptor.posicaoMs));
                r.put("RelCount", "2147483647");
                r.put("AbsCount", "2147483647");
                return r;
            case "GetMediaInfo":
                r.put("NrTracks", temMidia ? "1" : "0");
                r.put("MediaDuration", Receptor.hms(Receptor.duracaoMs));
                r.put("CurrentURI", Receptor.uri);
                r.put("CurrentURIMetaData", Receptor.meta);
                r.put("NextURI", Receptor.proxUri);
                r.put("NextURIMetaData", Receptor.proxMeta);
                r.put("PlayMedium", "NETWORK");
                r.put("RecordMedium", "NOT_IMPLEMENTED");
                r.put("WriteStatus", "NOT_IMPLEMENTED");
                return r;
            case "GetDeviceCapabilities":
                r.put("PlayMedia", "NETWORK");
                r.put("RecMedia", "NOT_IMPLEMENTED");
                r.put("RecQualityModes", "NOT_IMPLEMENTED");
                return r;
            case "GetTransportSettings":
                r.put("PlayMode", "NORMAL");
                r.put("RecQualityMode", "NOT_IMPLEMENTED");
                return r;
            case "GetCurrentTransportActions":
                r.put("Actions", acoesAtuais());
                return r;
            default:
                throw new ErroUpnp(401, "Invalid Action");
        }
    }

    private static String acoesAtuais() {
        switch (Receptor.estado) {
            case Receptor.TOCANDO: return "Pause,Stop,Seek";
            case Receptor.PAUSADO: return "Play,Stop,Seek";
            case Receptor.CARREGANDO: return "Stop";
            case Receptor.PARADO: return "Play";
            default: return "";
        }
    }

    private int volume() {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max <= 0 ? 0 : Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max);
    }

    private boolean mudo() {
        return audio.isStreamMute(AudioManager.STREAM_MUSIC);
    }

    private Map<String, String> renderingControl(String acao, String corpo) throws ErroUpnp {
        Map<String, String> r = new LinkedHashMap<>();
        switch (acao) {
            case "GetVolume":
                r.put("CurrentVolume", String.valueOf(volume()));
                return r;
            case "SetVolume": {
                int v;
                try {
                    v = Integer.parseInt(arg(corpo, "DesiredVolume").trim());
                } catch (NumberFormatException e) {
                    throw new ErroUpnp(402, "Invalid Args");
                }
                v = Math.max(0, Math.min(100, v));
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(v * max / 100f), 0);
                eventos.execute(() -> avisarTodos("RenderingControl"));
                return r;
            }
            case "GetMute":
                r.put("CurrentMute", mudo() ? "1" : "0");
                return r;
            case "SetMute": {
                String d = arg(corpo, "DesiredMute").trim();
                boolean m = "1".equals(d) || "true".equalsIgnoreCase(d);
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    m ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0);
                eventos.execute(() -> avisarTodos("RenderingControl"));
                return r;
            }
            case "ListPresets":
                r.put("CurrentPresetNameList", "FactoryDefaults");
                return r;
            case "SelectPreset":
                return r;
            default:
                throw new ErroUpnp(401, "Invalid Action");
        }
    }

    private Map<String, String> connectionManager(String acao) throws ErroUpnp {
        Map<String, String> r = new LinkedHashMap<>();
        switch (acao) {
            case "GetProtocolInfo":
                r.put("Source", "");
                r.put("Sink", SINK);
                return r;
            case "GetCurrentConnectionIDs":
                r.put("ConnectionIDs", "0");
                return r;
            case "GetCurrentConnectionInfo":
                r.put("RcsID", "0");
                r.put("AVTransportID", "0");
                r.put("ProtocolInfo", "");
                r.put("PeerConnectionManager", "");
                r.put("PeerConnectionID", "-1");
                r.put("Direction", "Input");
                r.put("Status", "OK");
                return r;
            default:
                throw new ErroUpnp(401, "Invalid Action");
        }
    }

    // ------------------------------------------------------------ eventos (GENA)

    private static final class Assinante {
        final String sid;
        final String servico;
        final List<URL> destinos;
        volatile long expira;
        int seq;

        Assinante(String sid, String servico, List<URL> destinos, long expira) {
            this.sid = sid;
            this.servico = servico;
            this.destinos = destinos;
            this.expira = expira;
        }
    }

    private void assinar(OutputStream out, String servico, Pedido p) throws IOException {
        int segundos = 1800;
        Matcher t = Pattern.compile("Second-(\\d+)").matcher(p.cab.getOrDefault("timeout", ""));
        if (t.find()) {
            try {
                segundos = Math.max(300, Math.min(7200, Integer.parseInt(t.group(1))));
            } catch (NumberFormatException ignorado) {
            }
        }
        String sid = p.cab.get("sid");
        Map<String, String> ext = new LinkedHashMap<>();
        if (sid != null) {
            // renovacao
            Assinante a = assinantes.get(sid.trim());
            if (a == null) {
                responder(out, 412, "Precondition Failed", null, "", null);
                return;
            }
            a.expira = System.currentTimeMillis() + segundos * 1000L;
            ext.put("SID", a.sid);
            ext.put("TIMEOUT", "Second-" + segundos);
            responder(out, 200, "OK", null, "", ext);
            return;
        }
        List<URL> destinos = new ArrayList<>();
        Matcher m = Pattern.compile("<([^>]+)>").matcher(p.cab.getOrDefault("callback", ""));
        while (m.find()) {
            try {
                destinos.add(new URL(m.group(1)));
            } catch (IOException ignorado) {
            }
        }
        if (destinos.isEmpty()) {
            responder(out, 412, "Precondition Failed", null, "", null);
            return;
        }
        final Assinante a = new Assinante("uuid:" + UUID.randomUUID(), servico, destinos,
            System.currentTimeMillis() + segundos * 1000L);
        assinantes.put(a.sid, a);
        ext.put("SID", a.sid);
        ext.put("TIMEOUT", "Second-" + segundos);
        responder(out, 200, "OK", null, "", ext);
        // o primeiro evento vai logo depois da resposta, com o estado completo
        eventos.schedule(() -> enviar(a), 200, TimeUnit.MILLISECONDS);
    }

    /** servico == null: todos os assinantes do AVTransport (mudanca de estado do player). */
    private void avisarTodos(String servico) {
        String alvo = servico == null ? "AVTransport" : servico;
        long agora = System.currentTimeMillis();
        Iterator<Assinante> it = assinantes.values().iterator();
        while (it.hasNext()) {
            Assinante a = it.next();
            if (a.expira < agora) {
                it.remove();
                continue;
            }
            if (alvo.equals(a.servico)) enviar(a);
        }
    }

    private void enviar(Assinante a) {
        String props;
        if ("AVTransport".equals(a.servico)) {
            String ev = "<Event xmlns=\"urn:schemas-upnp-org:metadata-1-0/AVT/\"><InstanceID val=\"0\">"
                + v("TransportState", Receptor.estado)
                + v("TransportStatus", "OK")
                + v("TransportPlaySpeed", "1")
                + v("CurrentTransportActions", acoesAtuais())
                + v("NumberOfTracks", Receptor.uri.isEmpty() ? "0" : "1")
                + v("CurrentTrack", Receptor.uri.isEmpty() ? "0" : "1")
                + v("AVTransportURI", Receptor.uri)
                + v("AVTransportURIMetaData", Receptor.meta)
                + v("CurrentTrackURI", Receptor.uri)
                + v("CurrentTrackMetaData", Receptor.meta)
                + v("NextAVTransportURI", Receptor.proxUri)
                + v("CurrentMediaDuration", Receptor.hms(Receptor.duracaoMs))
                + v("CurrentTrackDuration", Receptor.hms(Receptor.duracaoMs))
                + v("PlaybackStorageMedium", "NETWORK")
                + "</InstanceID></Event>";
            props = "<e:property><LastChange>" + escapar(ev) + "</LastChange></e:property>";
        } else if ("RenderingControl".equals(a.servico)) {
            String ev = "<Event xmlns=\"urn:schemas-upnp-org:metadata-1-0/RCS/\"><InstanceID val=\"0\">"
                + "<Volume channel=\"Master\" val=\"" + volume() + "\"/>"
                + "<Mute channel=\"Master\" val=\"" + (mudo() ? "1" : "0") + "\"/>"
                + "<PresetNameList val=\"FactoryDefaults\"/>"
                + "</InstanceID></Event>";
            props = "<e:property><LastChange>" + escapar(ev) + "</LastChange></e:property>";
        } else {
            props = "<e:property><SourceProtocolInfo></SourceProtocolInfo></e:property>"
                + "<e:property><SinkProtocolInfo>" + escapar(SINK) + "</SinkProtocolInfo></e:property>"
                + "<e:property><CurrentConnectionIDs>0</CurrentConnectionIDs></e:property>";
        }
        byte[] corpo = ("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            + "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">" + props + "</e:propertyset>")
            .getBytes(StandardCharsets.UTF_8);
        int seq;
        synchronized (a) {
            seq = a.seq++;
        }
        for (URL u : a.destinos) {
            int porta = u.getPort() > 0 ? u.getPort() : 80;
            String caminho = u.getFile().isEmpty() ? "/" : u.getFile();
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(u.getHost(), porta), 3000);
                s.setSoTimeout(3000);
                String cab = "NOTIFY " + caminho + " HTTP/1.1\r\n"
                    + "HOST: " + u.getHost() + ":" + porta + "\r\n"
                    + "CONTENT-TYPE: text/xml; charset=\"utf-8\"\r\n"
                    + "NT: upnp:event\r\nNTS: upnp:propchange\r\n"
                    + "SID: " + a.sid + "\r\nSEQ: " + seq + "\r\n"
                    + "CONTENT-LENGTH: " + corpo.length + "\r\nCONNECTION: close\r\n\r\n";
                OutputStream out = s.getOutputStream();
                out.write(cab.getBytes(StandardCharsets.ISO_8859_1));
                out.write(corpo);
                out.flush();
                s.getInputStream().read(new byte[256]);
                return; // um destino que respondeu basta
            } catch (IOException e) {
                Log.w(TAG, "evento nao entregue a " + u + ": " + e);
            }
        }
    }

    private static String v(String nome, String valor) {
        return "<" + nome + " val=\"" + escapar(valor) + "\"/>";
    }

    private static void dormir(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
