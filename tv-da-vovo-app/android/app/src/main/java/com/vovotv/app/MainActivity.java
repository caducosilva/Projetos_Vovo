package com.vovotv.app;

import android.app.PictureInPictureParams;
import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Fundo do app, o mesmo --color-noite-900 do CSS. */
    private static final String TAG = "ClariceTV";
    private static final int FUNDO = Color.parseColor("#080B11");
    private volatile boolean pipPermitido = false;
    private final Rect ultimoRectPip = new Rect();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TvBridge.class);
        registerPlugin(DlnaBridge.class);
        registerPlugin(CastBridge.class);
        registerPlugin(UpdateBridge.class);
        super.onCreate(savedInstanceState);
        aplicarTelaAcesaEBrilhoMaximo();

        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setJavaScriptCanOpenWindowsAutomatically(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);

                // Streams de IPTV nao mandam cabecalho CORS, e o hls.js baixa
                // playlist e video por XHR. Sem este client a TV ficava com a
                // tela preta em canal que no PC (que tem proxy) abre normal.
                webView.setWebViewClient(new ProxyDeStream(getBridge()));

                // Habilita foco e navegacao por controle remoto D-Pad na TV
                webView.setFocusable(true);
                webView.setFocusableInTouchMode(true);
                webView.requestFocus();

                ajustarParaBarrasDoSistema(webView);
                webView.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
                    if (pipPermitido && (r - l != or - ol || b - t != ob - ot)) {
                        atualizarParamsPip();
                    }
                });
            }
        } catch (RuntimeException e) {
            e.printStackTrace();
        }
    }

    private void aplicarTelaAcesaEBrilhoMaximo() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.screenBrightness = 1.0f;
        getWindow().setAttributes(params);
    }

    private boolean ehTv() {
        UiModeManager ui = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        return ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    private Rect calcularAreaVideoPip() {
        Rect area = new Rect();
        View alvo = getBridge() != null ? getBridge().getWebView() : null;
        if (alvo == null) alvo = getWindow() != null ? getWindow().getDecorView() : null;
        if (alvo == null || !alvo.getGlobalVisibleRect(area) || area.isEmpty()) {
            return area;
        }
        int largura = area.width();
        int altura = area.height();
        if (largura <= 0 || altura <= 0) return new Rect();

        // Enquadra um retangulo 16:9 centralizado (sem estourar dimensoes em modo retrato)
        int alvoAltura = Math.min(altura, Math.round(largura * 9f / 16f));
        int alvoLargura = Math.min(largura, Math.round(altura * 16f / 9f));
        int left = area.left + (largura - alvoLargura) / 2;
        int top = area.top + (altura - alvoAltura) / 2;
        return new Rect(left, top, left + alvoLargura, top + alvoAltura);
    }

    private PictureInPictureParams criarParamsPip(boolean autoEnter) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null;
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(16, 9));
        Rect sourceRect = calcularAreaVideoPip();
        if (!sourceRect.isEmpty()) {
            builder.setSourceRectHint(sourceRect);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoEnter && !ehTv());
            builder.setSeamlessResizeEnabled(!sourceRect.isEmpty());
        }
        return builder.build();
    }

    private void atualizarParamsPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ehTv()) return;
        try {
            PictureInPictureParams params = criarParamsPip(this.pipPermitido);
            if (params != null) {
                ultimoRectPip.set(calcularAreaVideoPip());
                setPictureInPictureParams(params);
            }
        } catch (Exception e) {
            Log.w(TAG, "Falha ao atualizar parametros de PiP", e);
        }
    }

    public void setPipPermitido(boolean permitido) {
        this.pipPermitido = permitido && !ehTv();
        atualizarParamsPip();
    }

    public boolean entrarEmPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ehTv()) return false;
        try {
            PictureInPictureParams params = criarParamsPip(this.pipPermitido);
            return params != null && enterPictureInPictureMode(params);
        } catch (Exception e) {
            Log.w(TAG, "Nao consegui entrar em PiP", e);
            return false;
        }
    }

    @Override
    public boolean onPictureInPictureRequested() {
        if (pipPermitido && !ehTv() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return entrarEmPip();
        }
        return super.onPictureInPictureRequested();
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (pipPermitido && !ehTv() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!isInPictureInPictureMode()) {
                entrarEmPip();
            }
        }
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (pipPermitido) {
            View decor = getWindow() != null ? getWindow().getDecorView() : null;
            if (decor != null) decor.post(this::atualizarParamsPip);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Em PiP o Android dispara onPause; mantem o WebView e timers vivos para o video nao congelar.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.onResume();
                webView.resumeTimers();
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        aplicarTelaAcesaEBrilhoMaximo();
        if (pipPermitido) {
            atualizarParamsPip();
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vovo:resume'))", null);
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, @NonNull Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (!isInPictureInPictureMode && pipPermitido) {
            atualizarParamsPip();
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('vovo:pip', { detail: { active: "
                    + isInPictureInPictureMode + " } }))",
                null
            );
        }
    }

    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        if (event.getAction() == android.view.KeyEvent.ACTION_DOWN) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                int code = event.getKeyCode();
                if (code == android.view.KeyEvent.KEYCODE_CHANNEL_UP || code == android.view.KeyEvent.KEYCODE_PAGE_UP) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vovo:channel_next'))", null);
                    return true;
                } else if (code == android.view.KeyEvent.KEYCODE_CHANNEL_DOWN || code == android.view.KeyEvent.KEYCODE_PAGE_DOWN) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vovo:channel_prev'))", null);
                    return true;
                } else if (code == android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == android.view.KeyEvent.KEYCODE_MEDIA_PLAY || code == android.view.KeyEvent.KEYCODE_MEDIA_PAUSE) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vovo:play_pause'))", null);
                    return true;
                } else if (code == android.view.KeyEvent.KEYCODE_MEDIA_NEXT) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vovo:channel_next'))", null);
                    return true;
                } else if (code == android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vovo:channel_prev'))", null);
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }

    /**
     * Afasta a pagina das barras do sistema.
     *
     * Do Android 15 em diante o app desenha atras da barra de status e da barra
     * de gestos. O CSS sozinho nao resolve: no Android o
     * env(safe-area-inset-top) so enxerga o recorte da camera, nunca a barra de
     * status, entao o cabecalho subia por baixo do relogio.
     *
     * A medida certa vem daqui e vira padding da propria WebView. Quando o
     * player esconde as barras para deitar o video, os insets zeram sozinhos e
     * o padding some junto, sem tratamento especial.
     */
    private void ajustarParaBarrasDoSistema(WebView webView) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // A area do padding e pintada pela propria WebView; sem isto ela
        // apareceria branca em volta da tela escura.
        webView.setBackgroundColor(FUNDO);
        View raiz = getWindow().getDecorView();
        raiz.setBackgroundColor(FUNDO);

        // Fundo escuro pede icone claro no relogio e na bateria
        WindowInsetsControllerCompat controle =
            WindowCompat.getInsetsController(getWindow(), webView);
        controle.setAppearanceLightStatusBars(false);
        controle.setAppearanceLightNavigationBars(false);

        // Nao adianta dar setPadding na WebView: o padding nao encolhe o
        // viewport CSS, entao quem esta em position:fixed continua subindo por
        // baixo do relogio. Quem afasta o conteudo e o CSS, com a medida que o
        // TvBridge.getInsets() entrega. Aqui so avisamos a pagina que a medida
        // mudou (girou a tela, barra apareceu), e ela pede o valor novo.
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            webView.evaluateJavascript(
                "window.dispatchEvent(new Event('vovo:insets'))", null);
            return insets;
        });

        ViewCompat.requestApplyInsets(webView);
    }
}
