package com.vovotv.app;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Faz na TV o que o painel do PC faz no servidor: busca o stream por fora do
 * navegador e devolve arrumado para o player.
 *
 * Dois problemas, os dois invisiveis no PC porque la existe um proxy:
 *
 * 1. CORS. O hls.js baixa playlist e video por XHR, e XHR obedece CORS. O
 *    encurtador jmp2.uk nao manda Access-Control-Allow-Origin nenhum e o Pluto
 *    so libera http://pluto.tv, entao a pagina (que roda em http://localhost)
 *    levava bloqueio antes de tocar qualquer coisa.
 *
 * 2. Endereco de base depois do redirecionamento. jmp2.uk responde 302 para o
 *    servidor do Pluto, mas a WebView entrega a resposta como se tivesse vindo
 *    do proprio jmp2.uk. Ai o hls.js montava o caminho dos pedacos em cima do
 *    encurtador (jmp2.uk/1539795/playlist.m3u8) e nao achava video nenhum: a
 *    playlist carregava, o canal ficava preto e nada aparecia no log de erro.
 *    Por isso a playlist e reescrita aqui com todos os enderecos absolutos.
 *
 * So passam por aqui os pedidos com cabecalho Origin, que sao os do XHR/fetch.
 * Logo, fonte e imagem seguem o caminho normal da WebView.
 */
public class ProxyDeStream extends BridgeWebViewClient {

    private static final int TEMPO_CONEXAO_MS = 6000;
    private static final int TEMPO_LEITURA_MS = 10000;
    /** Playlist e texto pequeno; o teto so evita segurar um arquivo gigante na memoria. */
    private static final int LIMITE_PLAYLIST_BYTES = 4 * 1024 * 1024;

    /**
     * Cabecalhos repassados ao servidor de origem.
     *
     * Accept-Encoding NAO entra de proposito: quando o pedido nao pede
     * compressao, o HttpURLConnection cuida do gzip sozinho e entrega o texto
     * pronto. Repassando, a resposta voltaria comprimida e o player receberia
     * bytes ilegiveis.
     */
    private static final String[] REPASSADOS = { "Range", "User-Agent", "Referer", "Accept", "Cookie", "Authorization" };

    /** URI="..." dentro de #EXT-X-KEY, #EXT-X-MEDIA e #EXT-X-MAP. */
    private static final Pattern URI_EM_TAG = Pattern.compile("URI=\"([^\"]+)\"");

    public ProxyDeStream(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (!deveInterceptar(request)) {
            return super.shouldInterceptRequest(view, request);
        }

        // Preflight (o hls.js manda quando pede faixa de bytes): responde na hora
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return new WebResourceResponse(
                "text/plain", "utf-8", 200, "OK",
                cabecalhosLiberados(new HashMap<>()),
                new ByteArrayInputStream(new byte[0])
            );
        }

        try {
            return buscar(request);
        } catch (Exception erro) {
            // Deixa seguir o caminho normal; o player trata a falha e cai para
            // a proxima fonte do canal.
            return super.shouldInterceptRequest(view, request);
        }
    }

    private boolean deveInterceptar(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String esquema = uri.getScheme();
        if (esquema == null) return false;
        if (!esquema.equals("http") && !esquema.equals("https")) return false;

        String host = uri.getHost();
        if (host == null) return false;
        // o proprio app e servido de http://localhost pelo Capacitor
        if (host.equals("localhost") || host.equals("127.0.0.1")) return false;

        Map<String, String> cabecalhos = request.getRequestHeaders();
        if (cabecalhos == null) return false;
        // Origin so aparece em XHR/fetch, que sao os pedidos que o CORS barra
        return valorDe(cabecalhos, "Origin") != null;
    }

    private WebResourceResponse buscar(WebResourceRequest request) throws Exception {
        String endereco = request.getUrl().toString();
        HttpURLConnection conexao = (HttpURLConnection) new URL(endereco).openConnection();
        conexao.setInstanceFollowRedirects(true); // jmp2.uk responde 302
        conexao.setConnectTimeout(TEMPO_CONEXAO_MS);
        conexao.setReadTimeout(TEMPO_LEITURA_MS);
        conexao.setRequestMethod(request.getMethod() == null ? "GET" : request.getMethod());

        Map<String, String> pedido = request.getRequestHeaders();
        for (String nome : REPASSADOS) {
            String valor = valorDe(pedido, nome);
            if (valor != null) conexao.setRequestProperty(nome, valor);
        }

        int codigo = conexao.getResponseCode();
        String motivo = conexao.getResponseMessage();
        if (motivo == null || motivo.isEmpty()) motivo = "OK"; // vazio derruba a WebView

        InputStream corpo = codigo >= 400 ? conexao.getErrorStream() : conexao.getInputStream();
        if (corpo == null) corpo = new ByteArrayInputStream(new byte[0]);

        String tipo = conexao.getContentType();
        String codificacao = null;
        if (tipo != null && tipo.contains(";")) {
            String[] partes = tipo.split(";");
            tipo = partes[0].trim();
            for (String parte : partes) {
                String limpo = parte.trim().toLowerCase();
                if (limpo.startsWith("charset=")) codificacao = limpo.substring(8);
            }
        }
        if (tipo == null || tipo.isEmpty()) tipo = "application/octet-stream";

        Map<String, String> resposta = new HashMap<>();
        for (Map.Entry<String, List<String>> item : conexao.getHeaderFields().entrySet()) {
            String nome = item.getKey();
            if (nome == null || item.getValue().isEmpty()) continue;
            String minusculo = nome.toLowerCase();
            // content-encoding e transfer-encoding ja foram resolvidos na leitura;
            // content-type e content-length viram outros valores se a playlist
            // for reescrita, e o access-control certo e o nosso
            if (minusculo.equals("content-encoding")
                || minusculo.equals("transfer-encoding")
                || minusculo.equals("content-length")
                || minusculo.equals("content-type")) continue;
            if (minusculo.startsWith("access-control-")) continue;
            resposta.put(nome, item.getValue().get(0));
        }

        // O endereco que valeu no fim: e contra ele que os caminhos relativos
        // da playlist tem de ser resolvidos.
        String enderecoFinal = conexao.getURL() != null ? conexao.getURL().toString() : endereco;

        if (codigo < 400 && ehPlaylist(enderecoFinal, tipo)) {
            byte[] bruto = lerTudo(corpo, LIMITE_PLAYLIST_BYTES);
            String texto = new String(bruto, StandardCharsets.UTF_8);
            if (texto.contains("#EXTM3U")) {
                byte[] arrumado = absolutizar(texto, enderecoFinal).getBytes(StandardCharsets.UTF_8);
                return new WebResourceResponse(
                    "application/vnd.apple.mpegurl", "utf-8", codigo, motivo,
                    cabecalhosLiberados(resposta), new ByteArrayInputStream(arrumado)
                );
            }
            corpo = new ByteArrayInputStream(bruto);
        }

        return new WebResourceResponse(
            tipo, codificacao, codigo, motivo, cabecalhosLiberados(resposta), corpo
        );
    }

    private static boolean ehPlaylist(String endereco, String tipo) {
        String semQuery = endereco.split("\\?")[0].toLowerCase();
        if (semQuery.endsWith(".m3u8") || semQuery.endsWith(".m3u")) return true;
        String t = tipo == null ? "" : tipo.toLowerCase();
        return t.contains("mpegurl") || t.contains("x-mpegurl");
    }

    /**
     * Troca todo caminho relativo da playlist por endereco absoluto, tomando
     * como base o endereco que a resposta realmente teve.
     */
    private static String absolutizar(String playlist, String base) {
        URI raiz;
        try {
            raiz = new URI(base);
        } catch (Exception e) {
            return playlist;
        }

        StringBuilder saida = new StringBuilder(playlist.length() + 512);
        for (String linha : playlist.split("\r?\n", -1)) {
            String limpa = linha.trim();
            if (limpa.isEmpty()) {
                saida.append(linha).append('\n');
                continue;
            }
            if (limpa.startsWith("#")) {
                Matcher m = URI_EM_TAG.matcher(linha);
                if (m.find()) {
                    String resolvido = resolver(raiz, m.group(1));
                    saida.append(linha.substring(0, m.start(1)))
                         .append(resolvido)
                         .append(linha.substring(m.end(1)))
                         .append('\n');
                } else {
                    saida.append(linha).append('\n');
                }
                continue;
            }
            saida.append(resolver(raiz, limpa)).append('\n');
        }
        return saida.toString();
    }

    private static String resolver(URI base, String alvo) {
        try {
            if (alvo.startsWith("http://") || alvo.startsWith("https://")) return alvo;
            return base.resolve(alvo).toString();
        } catch (Exception e) {
            return alvo;
        }
    }

    private static byte[] lerTudo(InputStream entrada, int limite) throws Exception {
        ByteArrayOutputStream saida = new ByteArrayOutputStream(8192);
        byte[] pedaco = new byte[8192];
        int lidos;
        while ((lidos = entrada.read(pedaco)) != -1) {
            saida.write(pedaco, 0, lidos);
            if (saida.size() > limite) break;
        }
        entrada.close();
        return saida.toByteArray();
    }

    private static Map<String, String> cabecalhosLiberados(Map<String, String> base) {
        base.put("Access-Control-Allow-Origin", "*");
        base.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        // o curinga "*" nao cobre Authorization (regra do CORS), e o guia do
        // Pluto exige esse cabecalho
        base.put("Access-Control-Allow-Headers", "*, Authorization");
        base.put("Access-Control-Expose-Headers", "*");
        base.put("Access-Control-Max-Age", "600");
        return base;
    }

    private static String valorDe(Map<String, String> cabecalhos, String nome) {
        if (cabecalhos == null) return null;
        for (Map.Entry<String, String> item : cabecalhos.entrySet()) {
            if (item.getKey() != null && item.getKey().equalsIgnoreCase(nome)) {
                return item.getValue();
            }
        }
        return null;
    }
}
