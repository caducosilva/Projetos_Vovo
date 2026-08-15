package com.vovotv.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.text.TextUtils;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Espelhamento DLNA/UPnP para TVs na mesma rede Wi-Fi.
 *
 * O WebView nao consegue abrir socket UDP, entao a descoberta SSDP e o controle
 * SOAP do AVTransport precisam viver aqui no nativo. Sem biblioteca externa:
 * sao dois protocolos de texto simples e a dependencia nao se paga.
 *
 * Fluxo: discover() manda um M-SEARCH multicast, le a resposta de cada
 * aparelho, baixa o XML de descricao e guarda a URL de controle do AVTransport.
 * Depois cast() manda SetAVTransportURI seguido de Play.
 */
@CapacitorPlugin(name = "DlnaBridge")
public class DlnaBridge extends Plugin {

    private static final String TAG = "DlnaBridge";
    private static final String SSDP_HOST = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final String AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final String RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1";

    /** Aparelhos achados na ultima busca, indexados pelo id estavel (a URL de descricao). */
    private final Map<String, Renderer> renderers = new ConcurrentHashMap<>();
    private final ExecutorService pool = Executors.newCachedThreadPool();

    /** Uma TV (ou caixinha) que aceita receber video. */
    private static class Renderer {
        String id;
        String name;
        String model;
        String controlUrl;
        String volumeUrl;
    }

    // ---------------------------------------------------------------- descoberta

    /**
     * Procura TVs na rede. Devolve a lista achada; nao da erro quando nao acha
     * nada, porque "nenhuma TV ligada" e um resultado valido, nao uma falha.
     */
    @PluginMethod
    public void discover(PluginCall call) {
        final int timeoutMs = clamp(call.getInt("timeoutMs", 4000), 1500, 12000);

        pool.execute(() -> {
            WifiManager.MulticastLock lock = null;
            try {
                lock = acquireMulticastLock();
                Set<String> locations = searchSsdp(timeoutMs);

                renderers.clear();
                for (String location : locations) {
                    Renderer r = describe(location);
                    if (r != null && r.controlUrl != null) {
                        renderers.put(r.id, r);
                    }
                }

                call.resolve(rendererList());
            } catch (IOException e) {
                Log.w(TAG, "falha na busca SSDP", e);
                call.reject("Nao consegui procurar TVs na rede: " + e.getMessage(), e);
            } finally {
                releaseMulticastLock(lock);
            }
        });
    }

    /** Lista o que ja foi achado, sem procurar de novo. */
    @PluginMethod
    public void listDevices(PluginCall call) {
        call.resolve(rendererList());
    }

    private JSObject rendererList() {
        JSArray arr = new JSArray();
        for (Renderer r : renderers.values()) {
            JSObject o = new JSObject();
            o.put("id", r.id);
            o.put("name", r.name);
            o.put("model", r.model);
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", arr);
        return ret;
    }

    /**
     * Manda o M-SEARCH e junta o cabecalho LOCATION de cada resposta.
     *
     * Pergunta pelo MediaRenderer e tambem pelo rootdevice porque varias TVs
     * (LG e Philips principalmente) so respondem ao segundo, e ai o XML de
     * descricao e quem diz se aquilo toca video ou nao.
     */
    private Set<String> searchSsdp(int timeoutMs) throws IOException {
        Set<String> locations = new HashSet<>();
        String[] targets = { "urn:schemas-upnp-org:device:MediaRenderer:1", "upnp:rootdevice" };

        MulticastSocket socket = new MulticastSocket(null);
        try {
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(600);

            InetAddress group = InetAddress.getByName(SSDP_HOST);
            for (String target : targets) {
                byte[] probe = mSearch(target).getBytes(StandardCharsets.UTF_8);
                // Repete: UDP perde pacote e TV dormindo demora a acordar.
                for (int i = 0; i < 2; i++) {
                    socket.send(new DatagramPacket(probe, probe.length, group, SSDP_PORT));
                }
            }

            long deadline = System.currentTimeMillis() + timeoutMs;
            byte[] buffer = new byte[8192];
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException ignored) {
                    continue;
                }
                String response = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                String location = header(response, "LOCATION");
                if (!TextUtils.isEmpty(location)) {
                    locations.add(location.trim());
                }
            }
        } finally {
            socket.close();
        }
        return locations;
    }

    private String mSearch(String searchTarget) {
        return "M-SEARCH * HTTP/1.1\r\n"
            + "HOST: " + SSDP_HOST + ":" + SSDP_PORT + "\r\n"
            + "MAN: \"ssdp:discover\"\r\n"
            + "MX: 3\r\n"
            + "ST: " + searchTarget + "\r\n"
            + "\r\n";
    }

    /** Le um cabecalho da resposta SSDP, que nao tem ordem nem caixa garantidas. */
    private String header(String response, String name) {
        for (String line : response.split("\r\n")) {
            int sep = line.indexOf(':');
            if (sep <= 0) continue;
            if (line.substring(0, sep).trim().equalsIgnoreCase(name)) {
                return line.substring(sep + 1);
            }
        }
        return null;
    }

    /**
     * Baixa o XML de descricao e monta o aparelho.
     * Devolve null quando aquilo nao sabe tocar video (roteador, impressora, etc).
     */
    private Renderer describe(String location) {
        try {
            String xml = httpGet(location);
            if (xml == null) return null;

            String avControl = controlUrlFor(xml, AV_TRANSPORT);
            if (avControl == null) return null;

            Renderer r = new Renderer();
            r.id = location;
            r.name = firstGroup(xml, "<friendlyName>(.*?)</friendlyName>");
            r.model = firstGroup(xml, "<modelName>(.*?)</modelName>");
            if (TextUtils.isEmpty(r.name)) r.name = TextUtils.isEmpty(r.model) ? "TV" : r.model;
            r.controlUrl = absolute(location, avControl);

            String volumeControl = controlUrlFor(xml, RENDERING_CONTROL);
            if (volumeControl != null) r.volumeUrl = absolute(location, volumeControl);

            return r;
        } catch (IOException e) {
            Log.w(TAG, "nao li a descricao de " + location, e);
            return null;
        }
    }

    /**
     * Acha o controlURL do servico pedido.
     *
     * Precisa casar servico e URL dentro do MESMO bloco <service>: varre os
     * blocos um a um, porque pegar o serviceType de um e o controlURL de outro
     * manda o comando para o endereco errado e a TV ignora calada.
     */
    private String controlUrlFor(String xml, String serviceType) {
        Matcher block = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL).matcher(xml);
        String shortType = serviceType.substring(0, serviceType.lastIndexOf(':'));
        while (block.find()) {
            String service = block.group(1);
            if (service == null) continue;
            String type = firstGroup(service, "<serviceType>(.*?)</serviceType>");
            if (type == null || !type.startsWith(shortType)) continue;
            String control = firstGroup(service, "<controlURL>(.*?)</controlURL>");
            if (!TextUtils.isEmpty(control)) return control;
        }
        return null;
    }

    // ---------------------------------------------------------------- comandos

    /** Manda o canal para a TV: define a URL e ja da play. */
    @PluginMethod
    public void cast(PluginCall call) {
        final Renderer target = resolve(call);
        if (target == null) return;

        final String url = call.getString("url");
        final String title = call.getString("title", "Vovo TV");
        if (TextUtils.isEmpty(url)) {
            call.reject("url vazia");
            return;
        }

        pool.execute(() -> {
            try {
                String metadata = didl(url, title);
                soap(target.controlUrl, AV_TRANSPORT, "SetAVTransportURI",
                    "<InstanceID>0</InstanceID>"
                        + "<CurrentURI>" + escape(url) + "</CurrentURI>"
                        + "<CurrentURIMetaData>" + escape(metadata) + "</CurrentURIMetaData>");

                soap(target.controlUrl, AV_TRANSPORT, "Play",
                    "<InstanceID>0</InstanceID><Speed>1</Speed>");

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("device", target.name);
                call.resolve(ret);
            } catch (IOException e) {
                Log.w(TAG, "cast falhou em " + target.name, e);
                call.reject("A TV " + target.name + " recusou o canal: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        simpleCommand(call, "Stop", "<InstanceID>0</InstanceID>");
    }

    @PluginMethod
    public void play(PluginCall call) {
        simpleCommand(call, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
    }

    @PluginMethod
    public void pause(PluginCall call) {
        simpleCommand(call, "Pause", "<InstanceID>0</InstanceID>");
    }

    private void simpleCommand(PluginCall call, String action, String body) {
        final Renderer target = resolve(call);
        if (target == null) return;

        pool.execute(() -> {
            try {
                soap(target.controlUrl, AV_TRANSPORT, action, body);
                call.resolve();
            } catch (IOException e) {
                Log.w(TAG, action + " falhou em " + target.name, e);
                call.reject("A TV nao aceitou o comando: " + e.getMessage(), e);
            }
        });
    }

    /** Volume da TV, 0 a 100. */
    @PluginMethod
    public void setVolume(PluginCall call) {
        final Renderer target = resolve(call);
        if (target == null) return;
        if (target.volumeUrl == null) {
            call.reject("Essa TV nao deixa mudar o volume por aqui");
            return;
        }
        final int value = clamp(call.getInt("value", 30), 0, 100);

        pool.execute(() -> {
            try {
                soap(target.volumeUrl, RENDERING_CONTROL, "SetVolume",
                    "<InstanceID>0</InstanceID><Channel>Master</Channel>"
                        + "<DesiredVolume>" + value + "</DesiredVolume>");
                call.resolve();
            } catch (IOException e) {
                Log.w(TAG, "volume falhou em " + target.name, e);
                call.reject("Nao consegui mudar o volume da TV: " + e.getMessage(), e);
            }
        });
    }

    /** Pega o aparelho do id vindo do JS, ja rejeitando a chamada quando sumiu. */
    private Renderer resolve(PluginCall call) {
        String deviceId = call.getString("deviceId");
        if (TextUtils.isEmpty(deviceId)) {
            call.reject("deviceId vazio");
            return null;
        }
        Renderer target = renderers.get(deviceId);
        if (target == null) {
            call.reject("Essa TV saiu do ar. Procure de novo.");
            return null;
        }
        return target;
    }

    // ---------------------------------------------------------------- SOAP / HTTP

    /** Envelope SOAP do UPnP. Estoura IOException quando a TV responde erro. */
    private void soap(String controlUrl, String serviceType, String action, String innerBody)
        throws IOException {
        String envelope =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
                + " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body>"
                + "<u:" + action + " xmlns:u=\"" + serviceType + "\">"
                + innerBody
                + "</u:" + action + ">"
                + "</s:Body></s:Envelope>";

        HttpURLConnection conn = (HttpURLConnection) new URL(controlUrl).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
            conn.setRequestProperty("SOAPAction", "\"" + serviceType + "#" + action + "\"");
            conn.setRequestProperty("Connection", "close");

            byte[] payload = envelope.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(payload);
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("HTTP " + code + " em " + action);
            }
        } finally {
            conn.disconnect();
        }
    }

    private String httpGet(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("Connection", "close");
            if (conn.getResponseCode() != 200) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int read;
                // Descricao UPnP e pequena; o teto evita um aparelho maluco comer a memoria.
                while ((read = in.read(chunk)) != -1 && buffer.size() < 512 * 1024) {
                    buffer.write(chunk, 0, read);
                }
                return buffer.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            conn.disconnect();
        }
    }

    // ---------------------------------------------------------------- utilitarios

    /**
     * Ficha DIDL-Lite do item. Varias TVs ignoram a URL quando vem sem ficha,
     * ou tocam so o audio, entao vale mandar mesmo sendo verboso.
     */
    private String didl(String url, String title) {
        String mime = mimeFor(url);
        boolean audio = mime.startsWith("audio/");
        String upnpClass = audio ? "object.item.audioItem.audioBroadcast" : "object.item.videoItem.videoBroadcast";

        return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\""
            + " xmlns:dc=\"http://purl.org/dc/elements/1.1/\""
            + " xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
            + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
            + "<dc:title>" + escape(title) + "</dc:title>"
            + "<upnp:class>" + upnpClass + "</upnp:class>"
            + "<res protocolInfo=\"http-get:*:" + mime + ":*\">" + escape(url) + "</res>"
            + "</item></DIDL-Lite>";
    }

    private String mimeFor(String url) {
        String clean = url.toLowerCase(Locale.ROOT).split("\\?")[0];
        if (clean.endsWith(".m3u8") || clean.endsWith(".m3u")) return "application/x-mpegURL";
        if (clean.endsWith(".ts")) return "video/mp2t";
        if (clean.endsWith(".mp4")) return "video/mp4";
        if (clean.endsWith(".mkv")) return "video/x-matroska";
        if (clean.endsWith(".webm")) return "video/webm";
        if (clean.endsWith(".mp3")) return "audio/mpeg";
        if (clean.endsWith(".aac")) return "audio/aac";
        if (clean.endsWith(".ogg")) return "audio/ogg";
        return "video/mp2t";
    }

    /** controlURL costuma vir relativo ao endereco da descricao. */
    private String absolute(String base, String path) {
        try {
            return new URL(new URL(base), path).toString();
        } catch (IOException e) {
            return path;
        }
    }

    private String firstGroup(String text, String regex) {
        Matcher m = Pattern.compile(regex, Pattern.DOTALL).matcher(text);
        return m.find() ? m.group(1).trim() : null;
    }

    private String escape(String raw) {
        if (raw == null) return "";
        return raw.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;");
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Sem o lock o Android filtra pacote multicast para economizar bateria e a
     * busca volta sempre vazia, mesmo com a TV ligada do lado.
     */
    private WifiManager.MulticastLock acquireMulticastLock() {
        try {
            WifiManager wifi = (WifiManager) getContext()
                .getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return null;
            WifiManager.MulticastLock lock = wifi.createMulticastLock("vovotv-dlna");
            lock.setReferenceCounted(true);
            lock.acquire();
            return lock;
        } catch (SecurityException e) {
            Log.w(TAG, "sem permissao de multicast", e);
            return null;
        }
    }

    private void releaseMulticastLock(WifiManager.MulticastLock lock) {
        if (lock != null && lock.isHeld()) {
            try {
                lock.release();
            } catch (RuntimeException e) {
                Log.w(TAG, "falha ao soltar o multicast lock", e);
            }
        }
    }
}
