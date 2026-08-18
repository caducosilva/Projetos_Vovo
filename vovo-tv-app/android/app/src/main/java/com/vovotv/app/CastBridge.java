package com.vovotv.app;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.mediarouter.media.MediaRouteSelector;
import androidx.mediarouter.media.MediaRouter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Map;

/**
 * Manda o canal para a TV pelo Google Cast (Chromecast embutido).
 *
 * Existia so o DlnaBridge aqui, e por isso "mandar para a TV" nunca funcionou
 * na casa: a TV Philips da sala nao expoe AVTransport nenhum, ela e uma Android
 * TV com Chromecast built-in. O painel do PC acerta porque fala Cast; agora o
 * celular fala tambem. O DLNA continua no app para aparelho que so tem ele.
 *
 * Tudo que e Cast (MediaRouter, CastContext, sessao) exige a thread principal.
 * Rede (resolver a playlist) roda fora dela. As duas coisas conversam pelo
 * Handler do main looper.
 */
@CapacitorPlugin(name = "CastBridge")
public class CastBridge extends Plugin {

    private static final String TAG = "CastBridge";
    private static final String UA = "VLC/3.0.20 LibVLC/3.0.20";
    private static final long ESPERA_SESSAO_MS = 30_000;

    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService rede = Executors.newCachedThreadPool();
    private final Map<String, MediaRouter.RouteInfo> rotas = new ConcurrentHashMap<>();

    private MediaRouteSelector seletor;
    private MediaRouter.Callback varredura;

    /** Chamada de cast em andamento: existe uma de cada vez, a ultima manda. */
    private PluginCall emAndamento;
    private SessionManagerListener<CastSession> ouvinteSessao;

    // -------------------------------------------------------------- basico

    /** Cast depende do Play Services; sem ele a tela nem oferece a opcao. */
    @PluginMethod
    public void available(PluginCall call) {
        int status = GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(getContext());
        JSObject ret = new JSObject();
        ret.put("available", status == ConnectionResult.SUCCESS);
        call.resolve(ret);
    }

    private MediaRouteSelector seletor() {
        if (seletor == null) {
            seletor = new MediaRouteSelector.Builder()
                .addControlCategory(CastMediaControlIntent.categoryForCast(
                    CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID))
                .build();
        }
        return seletor;
    }

    /**
     * Acorda o Cast do Play Services.
     *
     * Sem chamar isto uma vez o MediaRouter nao enxerga nada: quem faz a busca
     * na rede e o Play Services, e ele so comeca depois que o app pede o
     * CastContext.
     */
    private CastContext contexto() {
        try {
            return CastContext.getSharedInstance(getContext());
        } catch (RuntimeException e) {
            Log.w(TAG, "Cast indisponivel", e);
            return null;
        }
    }

    // ---------------------------------------------------------- descoberta

    @PluginMethod
    public void discover(PluginCall call) {
        final long espera = Math.max(1500, Math.min(call.getInt("timeoutMs", 5000), 15000));

        principal.post(() -> {
            if (contexto() == null) {
                call.reject("Este celular nao tem o Google Play atualizado, entao nao consigo achar a TV.");
                return;
            }
            MediaRouter router = MediaRouter.getInstance(getContext());
            pararVarredura(router);

            varredura = new MediaRouter.Callback() {
                // Basta existir: a busca ativa acontece enquanto o callback
                // estiver registrado. As rotas sao lidas no fim da espera.
            };
            router.addCallback(seletor(), varredura, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN);

            principal.postDelayed(() -> {
                List<MediaRouter.RouteInfo> achadas = new ArrayList<>();
                for (MediaRouter.RouteInfo rota : router.getRoutes()) {
                    if (rota.isDefault() || rota.isBluetooth()) continue;
                    if (!rota.matchesSelector(seletor())) continue;
                    achadas.add(rota);
                }
                pararVarredura(router);

                rotas.clear();
                JSArray lista = new JSArray();
                for (MediaRouter.RouteInfo rota : achadas) {
                    rotas.put(rota.getId(), rota);
                    JSObject item = new JSObject();
                    item.put("id", rota.getId());
                    item.put("name", rota.getName());
                    item.put("model", rota.getDescription());
                    item.put("kind", "chromecast");
                    lista.put(item);
                }
                JSObject ret = new JSObject();
                ret.put("devices", lista);
                call.resolve(ret);
            }, espera);
        });
    }

    private void pararVarredura(MediaRouter router) {
        if (varredura != null) {
            router.removeCallback(varredura);
            varredura = null;
        }
    }

    // --------------------------------------------------------------- cast

    @PluginMethod
    public void cast(PluginCall call) {
        final String deviceId = call.getString("deviceId", "");
        final String url = call.getString("url", "");
        final String titulo = call.getString("title", "Vovo TV");
        if (deviceId == null || deviceId.isEmpty() || url == null || url.isEmpty()) {
            call.reject("Faltou dizer qual TV e qual canal.");
            return;
        }

        // A playlist e resolvida fora da thread principal: e rede, e a TV
        // engasga com master playlist de varias qualidades.
        rede.execute(() -> {
            final String pronta = resolverHls(url);
            principal.post(() -> iniciarCast(deviceId, pronta, titulo, call));
        });
    }

    private void iniciarCast(String deviceId, String url, String titulo, PluginCall call) {
        CastContext contexto = contexto();
        if (contexto == null) {
            call.reject("Este celular nao tem o Google Play atualizado, entao nao consigo mandar para a TV.");
            return;
        }
        MediaRouter.RouteInfo rota = rotas.get(deviceId);
        if (rota == null) {
            call.reject("Perdi a TV de vista. Procure de novo.");
            return;
        }

        emAndamento = call;
        SessionManager gerente = contexto.getSessionManager();
        CastSession atual = gerente.getCurrentCastSession();

        if (atual != null && atual.isConnected() && rota.isSelected()) {
            enviarMidia(atual, url, titulo);
            return;
        }

        ouvirSessao(gerente, url, titulo);
        MediaRouter.getInstance(getContext()).selectRoute(rota);

        principal.postDelayed(() -> {
            if (emAndamento == call) {
                soltarOuvinte(gerente);
                falhar("A TV nao respondeu. Confira se ela esta ligada e no mesmo Wi-Fi.");
            }
        }, ESPERA_SESSAO_MS);
    }

    private void ouvirSessao(SessionManager gerente, String url, String titulo) {
        soltarOuvinte(gerente);
        ouvinteSessao = new SessaoAdapter() {
            @Override
            public void onSessionStarted(CastSession sessao, String id) {
                soltarOuvinte(gerente);
                enviarMidia(sessao, url, titulo);
            }

            @Override
            public void onSessionResumed(CastSession sessao, boolean retomada) {
                soltarOuvinte(gerente);
                enviarMidia(sessao, url, titulo);
            }

            @Override
            public void onSessionStartFailed(CastSession sessao, int erro) {
                soltarOuvinte(gerente);
                falhar("Nao consegui conectar na TV (erro " + erro + ").");
            }
        };
        gerente.addSessionManagerListener(ouvinteSessao, CastSession.class);
    }

    private void soltarOuvinte(SessionManager gerente) {
        if (ouvinteSessao != null) {
            gerente.removeSessionManagerListener(ouvinteSessao, CastSession.class);
            ouvinteSessao = null;
        }
    }

    private void enviarMidia(CastSession sessao, String url, String titulo) {
        RemoteMediaClient player = sessao.getRemoteMediaClient();
        if (player == null) {
            falhar("A TV conectou mas nao abriu o player.");
            return;
        }

        MediaMetadata dados = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
        dados.putString(MediaMetadata.KEY_TITLE, titulo);

        MediaInfo midia = new MediaInfo.Builder(url)
            .setStreamType(MediaInfo.STREAM_TYPE_LIVE)
            .setContentType("application/x-mpegurl")
            .setMetadata(dados)
            .build();

        player.load(new MediaLoadRequestData.Builder()
            .setMediaInfo(midia)
            .setAutoplay(true)
            .build()
        ).setResultCallback(resultado -> {
            if (resultado.getStatus().isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("device", sessao.getCastDevice() != null
                    ? sessao.getCastDevice().getFriendlyName() : "TV");
                ret.put("url", url);
                concluir(ret);
                return;
            }
            falhar("A TV recusou este canal (codigo "
                + resultado.getStatus().getStatusCode() + "). Tente outro canal.");
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        principal.post(() -> {
            CastContext contexto = contexto();
            if (contexto != null) {
                contexto.getSessionManager().endCurrentSession(true);
            }
            MediaRouter.getInstance(getContext()).unselect(MediaRouter.UNSELECT_REASON_STOPPED);
            call.resolve();
        });
    }

    /** Diz se ainda tem canal tocando na TV, para a tela nao mentir para a vovo. */
    @PluginMethod
    public void isPlaying(PluginCall call) {
        principal.post(() -> {
            CastContext contexto = contexto();
            CastSession sessao = contexto == null ? null : contexto.getSessionManager().getCurrentCastSession();
            RemoteMediaClient player = sessao == null ? null : sessao.getRemoteMediaClient();
            JSObject ret = new JSObject();
            ret.put("playing", player != null && (player.isPlaying() || player.isBuffering()));
            call.resolve(ret);
        });
    }

    private void concluir(JSObject ret) {
        PluginCall call = emAndamento;
        emAndamento = null;
        if (call != null) call.resolve(ret);
    }

    private void falhar(String mensagem) {
        PluginCall call = emAndamento;
        emAndamento = null;
        if (call != null) call.reject(mensagem);
    }

    // ---------------------------------------------------------------- HLS

    /**
     * Troca a master playlist pela melhor variante.
     *
     * O receptor padrao do Chromecast tropeca em master playlist de canal ao
     * vivo: fica em buffer eterno e a TV nao mostra nada. Entregar direto a
     * variante de maior banda foi o que resolveu no painel do PC.
     */
    private String resolverHls(String url) {
        String texto = baixarTexto(url);
        if (texto == null || !texto.contains("#EXTM3U")) return url;
        if (texto.contains("#EXTINF")) return url; // ja e a lista de pedacos

        String melhorUri = "";
        long melhorBanda = -1;
        long bandaPendente = -1;
        for (String linha : texto.split("\\r?\\n")) {
            String limpa = linha.trim();
            if (limpa.isEmpty()) continue;
            if (limpa.toUpperCase(Locale.ROOT).startsWith("#EXT-X-STREAM-INF")) {
                bandaPendente = bandaDe(limpa);
                continue;
            }
            if (limpa.startsWith("#")) continue;
            long banda = bandaPendente < 0 ? 0 : bandaPendente;
            if (banda > melhorBanda) {
                melhorBanda = banda;
                melhorUri = limpa;
            }
            bandaPendente = -1;
        }
        if (melhorUri.isEmpty()) return url;

        try {
            return URI.create(url).resolve(melhorUri).toString();
        } catch (IllegalArgumentException e) {
            return url;
        }
    }

    private long bandaDe(String linha) {
        long maior = 0;
        String cauda = linha.substring(linha.indexOf(':') + 1);
        for (String parte : cauda.split(",")) {
            String[] par = parte.split("=", 2);
            if (par.length != 2) continue;
            String chave = par[0].trim().toUpperCase(Locale.ROOT);
            if (!chave.equals("BANDWIDTH") && !chave.equals("AVERAGE-BANDWIDTH")) continue;
            try {
                maior = Math.max(maior, Long.parseLong(par[1].trim().replace("\"", "")));
            } catch (NumberFormatException ignored) {
                // atributo torto na playlist: a banda dessa variante fica 0
            }
        }
        return maior;
    }

    private String baixarTexto(String url) {
        HttpURLConnection conexao = null;
        try {
            conexao = (HttpURLConnection) new URL(url).openConnection();
            conexao.setRequestProperty("User-Agent", UA);
            conexao.setConnectTimeout(6000);
            conexao.setReadTimeout(6000);
            conexao.setInstanceFollowRedirects(true);
            if (conexao.getResponseCode() >= 400) return null;

            try (InputStream entrada = conexao.getInputStream()) {
                byte[] buffer = new byte[64 * 1024];
                int lidos = 0;
                int passo;
                while (lidos < buffer.length
                    && (passo = entrada.read(buffer, lidos, buffer.length - lidos)) > 0) {
                    lidos += passo;
                }
                return new String(buffer, 0, lidos, StandardCharsets.UTF_8);
            }
        } catch (java.io.IOException e) {
            Log.w(TAG, "nao consegui ler a playlist " + url, e);
            return null;
        } finally {
            if (conexao != null) conexao.disconnect();
        }
    }

    /** So para nao repetir os oito metodos vazios do SessionManagerListener. */
    private abstract static class SessaoAdapter implements SessionManagerListener<CastSession> {
        @Override public void onSessionStarting(CastSession sessao) { }
        @Override public void onSessionStarted(CastSession sessao, String id) { }
        @Override public void onSessionStartFailed(CastSession sessao, int erro) { }
        @Override public void onSessionEnding(CastSession sessao) { }
        @Override public void onSessionEnded(CastSession sessao, int erro) { }
        @Override public void onSessionResuming(CastSession sessao, String id) { }
        @Override public void onSessionResumed(CastSession sessao, boolean retomada) { }
        @Override public void onSessionResumeFailed(CastSession sessao, int erro) { }
        @Override public void onSessionSuspended(CastSession sessao, int razao) { }
    }
}
