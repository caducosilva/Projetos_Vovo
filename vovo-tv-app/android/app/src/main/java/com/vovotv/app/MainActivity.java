package com.vovotv.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Fundo do app, o mesmo --color-noite-900 do CSS. */
    private static final int FUNDO = Color.parseColor("#080B11");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TvBridge.class);
        registerPlugin(DlnaBridge.class);
        registerPlugin(CastBridge.class);
        registerPlugin(UpdateBridge.class);
        super.onCreate(savedInstanceState);

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

                ajustarParaBarrasDoSistema(webView);
            }
        } catch (RuntimeException e) {
            e.printStackTrace();
        }
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
