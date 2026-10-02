package com.tvdavovo.inicio;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Estado do receptor DLNA, compartilhado entre o servidor (threads de rede) e
 * a tela que toca (thread principal). Uma TV so toca uma coisa por vez, entao
 * e tudo estatico: uma unica "instancia 0" do AVTransport.
 */
final class Receptor {

    /** O que a tela que toca sabe fazer. Sempre chamado na thread principal. */
    interface Tocador {
        void tocar();
        void pausar();
        void parar();
        void buscar(long ms);
        void trocar(String uri, String meta);
    }

    static final String SEM_MIDIA = "NO_MEDIA_PRESENT";
    static final String PARADO = "STOPPED";
    static final String TOCANDO = "PLAYING";
    static final String PAUSADO = "PAUSED_PLAYBACK";
    static final String CARREGANDO = "TRANSITIONING";

    static volatile String uri = "";
    static volatile String meta = "";
    static volatile String proxUri = "";
    static volatile String proxMeta = "";
    static volatile String estado = SEM_MIDIA;
    static volatile long duracaoMs;
    static volatile long posicaoMs;
    static volatile Tocador tocador;

    /** Avisado a cada mudanca de estado (eventos GENA para quem assinou). */
    static volatile Runnable aoMudar;

    static final Handler PRINCIPAL = new Handler(Looper.getMainLooper());

    private Receptor() {}

    static void mudar(String novo) {
        if (novo.equals(estado)) return;
        estado = novo;
        avisar();
    }

    static void avisar() {
        Runnable r = aoMudar;
        if (r != null) r.run();
    }

    // ------------------------------------------------------------ comandos

    static void definir(String novaUri, String novaMeta) {
        uri = novaUri;
        meta = novaMeta;
        duracaoMs = 0;
        posicaoMs = 0;
        final Tocador t = tocador;
        if (t != null) {
            PRINCIPAL.post(() -> t.trocar(novaUri, novaMeta));
        } else {
            estado = PARADO;
        }
        avisar();
    }

    static void tocar(Context ctx) {
        final Tocador t = tocador;
        if (t != null) {
            PRINCIPAL.post(t::tocar);
        } else if (!uri.isEmpty()) {
            abrirTela(ctx);
        }
    }

    static void pausar() {
        final Tocador t = tocador;
        if (t != null) PRINCIPAL.post(t::pausar);
    }

    static void parar() {
        final Tocador t = tocador;
        if (t != null) {
            PRINCIPAL.post(t::parar);
        } else if (!SEM_MIDIA.equals(estado)) {
            mudar(PARADO);
        }
    }

    static void buscar(long ms) {
        final Tocador t = tocador;
        if (t != null) PRINCIPAL.post(() -> t.buscar(ms));
    }

    @SuppressWarnings("deprecation")
    private static void abrirTela(Context ctx) {
        mudar(CARREGANDO);
        // TV em repouso: acende a tela antes de abrir o video
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) {
            PowerManager.WakeLock acordar = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE, "tvdavovo:acordar");
            acordar.acquire(10_000);
        }
        Intent abrir = new Intent(ctx, TocadorActivity.class);
        abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(abrir);
    }

    // ------------------------------------------------------------ metadados

    enum Tipo { VIDEO, AUDIO, IMAGEM }

    static Tipo tipo(String uri, String meta) {
        String m = meta == null ? "" : meta;
        if (m.contains("object.item.imageItem")) return Tipo.IMAGEM;
        if (m.contains("object.item.audioItem")) return Tipo.AUDIO;
        if (m.contains("object.item.videoItem")) return Tipo.VIDEO;
        Matcher pi = Pattern.compile("protocolInfo=\"[^:]*:[^:]*:(image|audio|video)/").matcher(m);
        if (pi.find()) {
            String g = pi.group(1);
            return "image".equals(g) ? Tipo.IMAGEM : "audio".equals(g) ? Tipo.AUDIO : Tipo.VIDEO;
        }
        String u = uri.toLowerCase(java.util.Locale.ROOT);
        int q = u.indexOf('?');
        if (q >= 0) u = u.substring(0, q);
        if (u.matches(".*\\.(jpe?g|png|gif|webp|bmp|heic)$")) return Tipo.IMAGEM;
        if (u.matches(".*\\.(mp3|flac|m4a|aac|wav|ogg|opus|wma)$")) return Tipo.AUDIO;
        return Tipo.VIDEO;
    }

    static String titulo(String meta) {
        if (meta == null) return "";
        Matcher m = Pattern.compile("<dc:title>(.*?)</dc:title>", Pattern.DOTALL).matcher(meta);
        return m.find() ? Xml.desescapar(m.group(1)).trim() : "";
    }

    /** 0:01:05 a partir de milissegundos, como o UPnP espera. */
    static String hms(long ms) {
        long s = Math.max(0, ms / 1000);
        return String.format(java.util.Locale.ROOT, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60);
    }

    /** Aceita H:MM:SS, H:MM:SS.fff e segundos soltos. */
    static long ms(String hms) {
        try {
            String[] p = hms.trim().split(":");
            double total = 0;
            for (String parte : p) total = total * 60 + Double.parseDouble(parte);
            return (long) (total * 1000);
        } catch (RuntimeException e) {
            return -1;
        }
    }

    /** Escape de XML. */
    static final class Xml {
        private Xml() {}

        static String escapar(String s) {
            if (s == null) return "";
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
        }

        static String desescapar(String s) {
            if (s == null) return "";
            return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
                .replace("&apos;", "'").replace("&#39;", "'").replace("&amp;", "&");
        }
    }
}
