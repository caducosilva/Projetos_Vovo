package com.tvdavovo.inicio;

import android.util.Log;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Random;

/**
 * Anuncio do receptor na rede (SSDP): responde a quem procura TVs (M-SEARCH)
 * e avisa sozinho de tempos em tempos (NOTIFY alive). E isso que faz a TV
 * aparecer na lista do app do celular.
 */
final class Ssdp {

    private static final String GRUPO = "239.255.255.250";
    private static final int PORTA = 1900;
    private static final String TAG = "ReceptorDLNA";
    private static final long INTERVALO_MS = 60_000;

    private final String uuid;
    private final String[] tipos;
    private volatile boolean ativo;
    private volatile MulticastSocket escuta;
    private final Random sorte = new Random();

    Ssdp(String uuid) {
        this.uuid = uuid;
        this.tipos = new String[] {
            "upnp:rootdevice", "uuid:" + uuid, ServidorUpnp.TIPO,
            ServidorUpnp.AVT, ServidorUpnp.RCS, ServidorUpnp.CMS,
        };
    }

    void iniciar() {
        ativo = true;
        Thread ouvir = new Thread(this::ouvir, "ssdp-ouvir");
        ouvir.setDaemon(true);
        ouvir.start();
        Thread anunciar = new Thread(this::anunciar, "ssdp-anunciar");
        anunciar.setDaemon(true);
        anunciar.start();
    }

    void parar() {
        ativo = false;
        // avisa que saiu, para o celular tirar a TV da lista na hora
        new Thread(() -> enviarNotify("ssdp:byebye"), "ssdp-byebye").start();
        MulticastSocket s = escuta;
        if (s != null) s.close();
    }

    // ------------------------------------------------------------ escuta

    private void ouvir() {
        while (ativo) {
            try (MulticastSocket s = new MulticastSocket(null)) {
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(PORTA));
                InetAddress grupo = InetAddress.getByName(GRUPO);
                int entrou = 0;
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback() || !ni.supportsMulticast() || ipv4(ni) == null) continue;
                    try {
                        s.joinGroup(new InetSocketAddress(grupo, PORTA), ni);
                        entrou++;
                    } catch (IOException e) {
                        Log.w(TAG, "sem multicast em " + ni.getName() + ": " + e);
                    }
                }
                if (entrou == 0) throw new IOException("nenhuma rede pronta");
                escuta = s;
                Log.i(TAG, "SSDP ouvindo em " + entrou + " rede(s)");
                byte[] buf = new byte[4096];
                while (ativo) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.ISO_8859_1);
                    if (msg.startsWith("M-SEARCH")) responder(msg, p.getAddress(), p.getPort());
                }
            } catch (IOException e) {
                if (!ativo) return;
                // rede ainda subindo no boot, ou cabo/Wi-Fi trocou: tenta de novo
                Log.w(TAG, "SSDP reabrindo: " + e);
                dormir(5000);
            }
        }
    }

    private void responder(String msg, InetAddress quem, int porta) {
        String st = cabecalho(msg, "st");
        if (st == null) return;
        int mx = 1;
        try {
            mx = Math.max(1, Math.min(3, Integer.parseInt(cabecalho(msg, "mx"))));
        } catch (RuntimeException ignorado) {
        }
        String[] alvo;
        if ("ssdp:all".equals(st)) {
            alvo = tipos;
        } else {
            alvo = null;
            for (String t : tipos) if (t.equalsIgnoreCase(st)) alvo = new String[] { t };
            if (alvo == null) return;
        }
        final String[] responder = alvo;
        final long espera = sorte.nextInt(mx * 300);
        new Thread(() -> {
            dormir(espera);
            String ip = ipPara(quem);
            if (ip == null) return;
            try (DatagramSocket s = new DatagramSocket()) {
                for (String t : responder) {
                    String r = "HTTP/1.1 200 OK\r\n"
                        + "CACHE-CONTROL: max-age=1800\r\n"
                        + "EXT:\r\n"
                        + "LOCATION: http://" + ip + ":" + ServidorUpnp.PORTA + "/desc.xml\r\n"
                        + "SERVER: " + ServidorUpnp.SERVIDOR + "\r\n"
                        + "ST: " + t + "\r\n"
                        + "USN: " + usn(t) + "\r\n"
                        + "\r\n";
                    byte[] b = r.getBytes(StandardCharsets.ISO_8859_1);
                    s.send(new DatagramPacket(b, b.length, quem, porta));
                }
            } catch (IOException e) {
                Log.w(TAG, "falha respondendo M-SEARCH: " + e);
            }
        }, "ssdp-resposta").start();
    }

    // ------------------------------------------------------------ anuncio

    private void anunciar() {
        while (ativo) {
            enviarNotify("ssdp:alive");
            dormir(INTERVALO_MS);
        }
    }

    private void enviarNotify(String nts) {
        try (MulticastSocket s = new MulticastSocket()) {
            s.setTimeToLive(4);
            InetAddress grupo = InetAddress.getByName(GRUPO);
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                Inet4Address ip = ipv4(ni);
                if (!ni.isUp() || ni.isLoopback() || ip == null) continue;
                try {
                    s.setNetworkInterface(ni);
                } catch (IOException e) {
                    continue;
                }
                for (String t : tipos) {
                    String m = "NOTIFY * HTTP/1.1\r\n"
                        + "HOST: " + GRUPO + ":" + PORTA + "\r\n"
                        + "CACHE-CONTROL: max-age=1800\r\n"
                        + "LOCATION: http://" + ip.getHostAddress() + ":" + ServidorUpnp.PORTA + "/desc.xml\r\n"
                        + "SERVER: " + ServidorUpnp.SERVIDOR + "\r\n"
                        + "NT: " + t + "\r\n"
                        + "NTS: " + nts + "\r\n"
                        + "USN: " + usn(t) + "\r\n"
                        + "\r\n";
                    byte[] b = m.getBytes(StandardCharsets.ISO_8859_1);
                    s.send(new DatagramPacket(b, b.length, grupo, PORTA));
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "falha no NOTIFY " + nts + ": " + e);
        }
    }

    // ------------------------------------------------------------ util

    private String usn(String tipo) {
        return tipo.startsWith("uuid:") ? tipo : "uuid:" + uuid + "::" + tipo;
    }

    private static String cabecalho(String msg, String nome) {
        for (String linha : msg.split("\r\n")) {
            int dp = linha.indexOf(':');
            if (dp > 0 && linha.substring(0, dp).trim().toLowerCase(Locale.ROOT).equals(nome))
                return linha.substring(dp + 1).trim();
        }
        return null;
    }

    private static Inet4Address ipv4(NetworkInterface ni) {
        for (InetAddress a : Collections.list(ni.getInetAddresses()))
            if (a instanceof Inet4Address && !a.isLoopbackAddress()) return (Inet4Address) a;
        return null;
    }

    /** O IP da TV na mesma rede de quem perguntou (cabo e Wi-Fi podem estar ligados juntos). */
    static String ipPara(InetAddress quem) {
        String primeiro = null;
        try {
            byte[] q = quem == null ? null : quem.getAddress();
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                Inet4Address ip = ipv4(ni);
                if (ip == null) continue;
                if (primeiro == null) primeiro = ip.getHostAddress();
                byte[] a = ip.getAddress();
                if (q != null && q.length == 4 && a[0] == q[0] && a[1] == q[1] && a[2] == q[2])
                    return ip.getHostAddress();
            }
        } catch (IOException ignorado) {
        }
        return primeiro;
    }

    private static void dormir(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
