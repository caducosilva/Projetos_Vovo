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
import com.google.android.gms.cast.CastStatusCodes;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaStatus;
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
    private static final int MAX_REDIRECTS = 5;
    private static final long OLHO_NA_MIDIA_MS = 20_000;
    private static final int ESPERAS_PELA_ROTA = 24;
    private static final long PAUSA_ENTRE_ESPERAS_MS = 300;

    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService rede = Executors.newCachedThreadPool();
    private final Map<String, MediaRouter.RouteInfo> rotas = new ConcurrentHashMap<>();

    private MediaRouteSelector seletor;

    /**
     * Ouvinte de rotas que fica registrado o tempo todo.
     *
     * Nao pode ser removido no fim da busca: o MediaRouter so mantem as rotas
     * enquanto alguem esta ouvindo, e sem ninguem ouvindo o selectRoute nao
     * abre sessao nenhuma. Era essa a falha em que a TV aparecia na lista mas o
     * cast morria esperando a sessao. Na busca ele fica em varredura ativa;
     * depois volta ao modo passivo, que gasta menos bateria.
     */
    private MediaRouter.Callback ouvinteRotas;

    /** Chamada de cast em andamento: existe uma de cada vez, a ultima manda. */
    private PluginCall emAndamento;
    private SessionManagerListener<CastSession> ouvinteSessao;
    private RemoteMediaClient.Callback ouvinteMidia;
    private RemoteMediaClient playerAtual;

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

    /** Conta o passo atual para a tela, para a falha nunca virar misterio. */
    private void progresso(String fase, String mensagem, String detalhe) {
        JSObject evento = new JSObject();
        evento.put("fase", fase);
        evento.put("mensagem", mensagem);
        if (detalhe != null) evento.put("detalhe", detalhe);
        notifyListeners("progresso", evento);
        Log.i(TAG, fase + ": " + mensagem + (detalhe == null ? "" : " | " + detalhe));
    }

    /** Codigo do Cast em texto, para o detalhe tecnico dizer alguma coisa. */
    private String explicar(int codigo) {
        String nome = CastStatusCodes.getStatusCodeString(codigo);
        return nome == null || nome.isEmpty() ? "codigo " + codigo : nome + " (" + codigo + ")";
    }

    /**
     * Registra (ou reajusta) o ouvinte de rotas. So na thread principal.
     *
     * O modo de descanso NAO pode ser flags 0. Com 0 o provedor do Google
     * publica descritor nulo, a TV some da lista interna e o selectRoute vira
     * "Ignoring attempt to select removed route": a TV aparecia na tela e a
     * conexao morria no timeout. REQUEST_DISCOVERY mantem a rota viva.
     */
    private void ouvirRotas(MediaRouter router, int flags) {
        if (ouvinteRotas == null) {
            ouvinteRotas = new MediaRouter.Callback() {
                // O corpo pode ser vazio: o que importa e existir alguem
                // registrado, senao o MediaRouter solta as rotas achadas.
            };
        }
        router.addCallback(seletor(), ouvinteRotas, flags);
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
                progresso("erro", "Este Google Play nao tem Cast", null);
                call.reject("Este celular nao tem o Google Play atualizado, entao nao consigo achar a TV.");
                return;
            }
            progresso("procurando", "Procurando TVs na rede Wi-Fi...", null);
            MediaRouter router = MediaRouter.getInstance(getContext());
            ouvirRotas(router, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN);

            principal.postDelayed(() -> {
                List<MediaRouter.RouteInfo> achadas = new ArrayList<>();
                for (MediaRouter.RouteInfo rota : router.getRoutes()) {
                    if (rota.isDefault() || rota.isBluetooth()) continue;
                    if (!rota.matchesSelector(seletor())) continue;
                    achadas.add(rota);
                }
                // Sai da varredura ativa mas continua pedindo descoberta: sem
                // isso a rota da TV e recolhida e o cast nao conecta depois.
                ouvirRotas(router, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY);

                rotas.clear();
                JSArray lista = new JSArray();
                StringBuilder nomes = new StringBuilder();
                for (MediaRouter.RouteInfo rota : achadas) {
                    rotas.put(rota.getId(), rota);
                    JSObject item = new JSObject();
                    item.put("id", rota.getId());
                    item.put("name", rota.getName());
                    item.put("model", rota.getDescription());
                    item.put("kind", "chromecast");
                    lista.put(item);
                    if (nomes.length() > 0) nomes.append(", ");
                    nomes.append(rota.getName());
                }
                progresso(
                    achadas.isEmpty() ? "nenhuma" : "achou",
                    achadas.isEmpty()
                        ? "Nenhuma TV com Chromecast respondeu"
                        : "Achei " + achadas.size() + " aparelho(s)",
                    nomes.length() == 0 ? null : nomes.toString());

                JSObject ret = new JSObject();
                ret.put("devices", lista);
                call.resolve(ret);
            }, espera);
        });
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
        // engasga tanto com redirect quanto com master playlist.
        progresso("preparando", "Preparando o canal...", null);
        rede.execute(() -> {
            final String pronta = resolverHls(url);
            progresso("preparado", "Canal pronto para a TV",
                pronta.equals(url) ? "endereco original" : "endereco final: " + pronta);
            principal.post(() -> iniciarCast(deviceId, pronta, titulo, call));
        });
    }

    private void iniciarCast(String deviceId, String url, String titulo, PluginCall call) {
        CastContext contexto = contexto();
        if (contexto == null) {
            call.reject("Este celular nao tem o Google Play atualizado, entao nao consigo mandar para a TV.");
            return;
        }
        emAndamento = call;
        MediaRouter router = MediaRouter.getInstance(getContext());
        // Volta para a varredura ativa: e o que a tela de escolha do proprio
        // Google faz enquanto esta aberta, e e ela que traz a rota de volta.
        ouvirRotas(router, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN);
        esperarRota(router, contexto, deviceId, url, titulo, call, 0);
    }

    /**
     * Espera a rota da TV aparecer de novo antes de conectar.
     *
     * A rota que a busca devolveu pode ter sido recolhida entre a escolha da
     * vovo e o toque, porque o provedor do Google solta as rotas quando
     * ninguem esta procurando. Selecionar o objeto velho nao da erro: nao
     * acontece nada, e o cast morre esperando uma sessao que nunca comeca.
     */
    private void esperarRota(MediaRouter router, CastContext contexto, String deviceId,
                             String url, String titulo, PluginCall call, int tentativa) {
        if (emAndamento != call) return; // outra transmissao assumiu

        MediaRouter.RouteInfo rota = rotaAtual(router, deviceId);
        if (rota == null) {
            if (tentativa >= ESPERAS_PELA_ROTA) {
                progresso("erro", "Nao reencontrei a TV na rede",
                    "a rota nao voltou em "
                        + (ESPERAS_PELA_ROTA * PAUSA_ENTRE_ESPERAS_MS / 1000) + "s");
                falhar("Perdi a TV de vista. Confira se ela esta ligada e procure de novo.");
                return;
            }
            if (tentativa == 0) {
                progresso("reprocurando", "Procurando a TV de novo...",
                    "a rota tinha sido recolhida");
            }
            principal.postDelayed(
                () -> esperarRota(router, contexto, deviceId, url, titulo, call, tentativa + 1),
                PAUSA_ENTRE_ESPERAS_MS);
            return;
        }

        SessionManager gerente = contexto.getSessionManager();
        CastSession atual = gerente.getCurrentCastSession();
        if (atual != null && atual.isConnected() && rota.isSelected()) {
            progresso("conectado", "Ja estava conectado na " + rota.getName(), null);
            enviarMidia(atual, url, titulo);
            return;
        }

        progresso("conectando", "Conectando na " + rota.getName() + "...",
            "espero ate " + (ESPERA_SESSAO_MS / 1000) + "s pela sessao");
        ouvirSessao(gerente, url, titulo);
        router.selectRoute(rota);

        principal.postDelayed(() -> {
            if (emAndamento == call) {
                soltarOuvinte(gerente);
                progresso("erro", "A TV nao abriu a sessao a tempo",
                    "a sessao nao iniciou em " + (ESPERA_SESSAO_MS / 1000) + "s");
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
                progresso("conectado", "Conectado na TV", "sessao " + id);
                enviarMidia(sessao, url, titulo);
            }

            @Override
            public void onSessionResumed(CastSession sessao, boolean retomada) {
                soltarOuvinte(gerente);
                progresso("conectado", "Reaproveitando a conexao com a TV", null);
                enviarMidia(sessao, url, titulo);
            }

            @Override
            public void onSessionStartFailed(CastSession sessao, int erro) {
                soltarOuvinte(gerente);
                progresso("erro", "A TV recusou a conexao", explicar(erro));
                falhar("Nao consegui conectar na TV: " + explicar(erro));
            }
        };
        gerente.addSessionManagerListener(ouvinteSessao, CastSession.class);
    }

    /**
     * A rota de verdade que o MediaRouter tem AGORA para aquele id.
     *
     * Devolve null quando ela nao existe mais, de proposito: cair no objeto
     * guardado durante a busca so leva ao "Ignoring attempt to select removed
     * route", que falha calado.
     */
    private MediaRouter.RouteInfo rotaAtual(MediaRouter router, String id) {
        for (MediaRouter.RouteInfo rota : router.getRoutes()) {
            if (rota.getId().equals(id)) return rota;
        }
        return null;
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
            progresso("erro", "A TV conectou mas nao abriu o player", "RemoteMediaClient nulo");
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

        progresso("enviando", "Mandando o canal para a TV...", null);
        acompanharMidia(player);

        player.load(new MediaLoadRequestData.Builder()
            .setMediaInfo(midia)
            .setAutoplay(true)
            .build()
        ).setResultCallback(resultado -> {
            if (resultado.getStatus().isSuccess()) {
                progresso("aceito", "A TV aceitou o canal", "carregando o video");
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("device", sessao.getCastDevice() != null
                    ? sessao.getCastDevice().getFriendlyName() : "TV");
                ret.put("url", url);
                concluir(ret);
                return;
            }
            int codigo = resultado.getStatus().getStatusCode();
            progresso("erro", "A TV recusou o canal", explicar(codigo));
            falhar("A TV recusou este canal: " + explicar(codigo));
        });
    }

    /**
     * Segue o que a TV faz depois de aceitar o canal.
     *
     * Aceitar nao e tocar: a TV pode ficar em buffer eterno ou cair em IDLE com
     * erro logo depois. Sem acompanhar isso a tela diria "tocando na TV" com a
     * televisao parada no preto.
     */
    private void acompanharMidia(RemoteMediaClient player) {
        pararDeAcompanhar();
        playerAtual = player;
        ouvinteMidia = new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
                MediaStatus status = player.getMediaStatus();
                if (status == null) return;
                switch (status.getPlayerState()) {
                    case MediaStatus.PLAYER_STATE_PLAYING:
                        progresso("tocando", "Tocando na TV", null);
                        break;
                    case MediaStatus.PLAYER_STATE_BUFFERING:
                        progresso("buffer", "A TV esta carregando o video...", null);
                        break;
                    case MediaStatus.PLAYER_STATE_IDLE:
                        if (status.getIdleReason() == MediaStatus.IDLE_REASON_ERROR) {
                            progresso("erro", "A TV desistiu do canal",
                                "idleReason=ERROR: canal fora do ar ou formato recusado");
                        }
                        break;
                    default:
                        break;
                }
            }
        };
        player.registerCallback(ouvinteMidia);
        principal.postDelayed(this::pararDeAcompanhar, OLHO_NA_MIDIA_MS);
    }

    private void pararDeAcompanhar() {
        if (playerAtual != null && ouvinteMidia != null) {
            playerAtual.unregisterCallback(ouvinteMidia);
        }
        ouvinteMidia = null;
        playerAtual = null;
    }

    @PluginMethod
    public void stop(PluginCall call) {
        principal.post(() -> {
            pararDeAcompanhar();
            CastContext contexto = contexto();
            if (contexto != null) {
                contexto.getSessionManager().endCurrentSession(true);
            }
            MediaRouter.getInstance(getContext()).unselect(MediaRouter.UNSELECT_REASON_STOPPED);
            progresso("parado", "Transmissao encerrada", null);
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

    @Override
    protected void handleOnDestroy() {
        principal.post(() -> {
            pararDeAcompanhar();
            if (ouvinteRotas != null) {
                MediaRouter.getInstance(getContext()).removeCallback(ouvinteRotas);
                ouvinteRotas = null;
            }
        });
        super.handleOnDestroy();
    }

    /** Solta a varredura ativa: ela e cara e so serve durante a conexao. */
    private void descansarVarredura() {
        principal.post(() -> ouvirRotas(MediaRouter.getInstance(getContext()),
            MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY));
    }

    private void concluir(JSObject ret) {
        descansarVarredura();
        PluginCall call = emAndamento;
        emAndamento = null;
        if (call != null) call.resolve(ret);
    }

    private void falhar(String mensagem) {
        descansarVarredura();
        PluginCall call = emAndamento;
        emAndamento = null;
        if (call != null) call.reject(mensagem);
    }

    // ---------------------------------------------------------------- HLS

    /**
     * Deixa a URL do jeito que o Chromecast consegue engolir.
     *
     * Duas coisas quebram o receptor padrao, e as duas quebram em silencio: a
     * TV fica presa em "carregando" e nao devolve erro nenhum.
     *
     * 1. Ele NAO segue redirect. Canal de provedor Xtream responde 302
     *    apontando para outro servidor, com token na URL, e era exatamente ai
     *    que o cast morria. Agora o redirect e seguido aqui e o que vai para a
     *    TV e o endereco final.
     * 2. Master playlist de canal ao vivo o deixa em buffer eterno, entao
     *    quando chega uma master mandamos a variante de maior banda.
     */
    private String resolverHls(String url) {
        Resposta resposta = baixarSeguindo(url);
        if (resposta == null || !resposta.texto.contains("#EXTM3U")) return url;
        String texto = resposta.texto;
        String base = resposta.urlFinal;
        if (texto.contains("#EXTINF")) return base; // ja e a lista de pedacos

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
        if (melhorUri.isEmpty()) return base;

        try {
            return URI.create(base).resolve(melhorUri).toString();
        } catch (IllegalArgumentException e) {
            return base;
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

    /** Conteudo da playlist mais o endereco em que ela realmente foi parar. */
    private static class Resposta {
        final String texto;
        final String urlFinal;

        Resposta(String texto, String urlFinal) {
            this.texto = texto;
            this.urlFinal = urlFinal;
        }
    }

    /**
     * Baixa a playlist seguindo redirect na mao.
     *
     * O setInstanceFollowRedirects do Java desiste quando o destino troca de
     * http para https, que e o que varios provedores fazem, e mesmo quando ele
     * segue nao da para saber onde a coisa parou. Aqui o endereco final volta
     * junto, porque e ele que a TV precisa receber.
     */
    private Resposta baixarSeguindo(String url) {
        String atual = url;
        for (int salto = 0; salto < MAX_REDIRECTS; salto++) {
            HttpURLConnection conexao = null;
            try {
                conexao = (HttpURLConnection) new URL(atual).openConnection();
                conexao.setRequestProperty("User-Agent", UA);
                conexao.setRequestProperty("Accept", "*/*");
                conexao.setRequestProperty("Cache-Control", "no-cache");
                conexao.setRequestProperty("Pragma", "no-cache");
                conexao.setUseCaches(false);
                conexao.setDefaultUseCaches(false);
                conexao.setConnectTimeout(6000);
                conexao.setReadTimeout(6000);
                conexao.setInstanceFollowRedirects(false);

                int codigo = conexao.getResponseCode();
                if (codigo >= 300 && codigo < 400) {
                    String destino = conexao.getHeaderField("Location");
                    if (destino == null || destino.isEmpty()) return null;
                    atual = URI.create(atual).resolve(destino).toString();
                    continue;
                }
                if (codigo >= 400) {
                    progresso("aviso", "O canal respondeu HTTP " + codigo,
                        "mando o endereco original mesmo assim");
                    return null;
                }

                try (InputStream entrada = conexao.getInputStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    int lidos = 0;
                    int passo;
                    while (lidos < buffer.length
                        && (passo = entrada.read(buffer, lidos, buffer.length - lidos)) > 0) {
                        lidos += passo;
                    }
                    return new Resposta(new String(buffer, 0, lidos, StandardCharsets.UTF_8), atual);
                }
            } catch (java.io.IOException | IllegalArgumentException e) {
                Log.w(TAG, "nao consegui ler a playlist " + atual, e);
                return null;
            } finally {
                if (conexao != null) conexao.disconnect();
            }
        }
        Log.w(TAG, "redirect demais em " + url);
        return null;
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
