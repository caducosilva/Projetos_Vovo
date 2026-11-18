package com.vovotv.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.media.AudioManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte nativa do Vovo TV: brilho real da tela, volume do aparelho,
 * girar para paisagem, manter a tela acesa e abrir o seletor de TV (cast).
 */
@CapacitorPlugin(name = "TvBridge")
public class TvBridge extends Plugin {

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /**
     * Espaco ocupado pela barra de status, pela barra de gestos e pelo recorte
     * da camera, em pixels de CSS.
     *
     * Existe porque no Android o env(safe-area-inset-top) do CSS so enxerga o
     * recorte da camera, nunca a barra de status. Do Android 15 em diante o app
     * desenha atras dela, e sem esta medida o botao Voltar do player nascia por
     * cima do relogio.
     */
    @PluginMethod
    public void getInsets(PluginCall call) {
        JSObject ret = new JSObject();
        final View raiz = getBridge().getWebView();
        WindowInsetsCompat janela = raiz != null ? ViewCompat.getRootWindowInsets(raiz) : null;

        if (janela == null) {
            ret.put("top", 0);
            ret.put("bottom", 0);
            ret.put("left", 0);
            ret.put("right", 0);
            call.resolve(ret);
            return;
        }

        Insets barras = janela.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        float densidade = getContext().getResources().getDisplayMetrics().density;
        if (densidade <= 0) densidade = 1f;

        ret.put("top", Math.round(barras.top / densidade));
        ret.put("bottom", Math.round(barras.bottom / densidade));
        ret.put("left", Math.round(barras.left / densidade));
        ret.put("right", Math.round(barras.right / densidade));
        call.resolve(ret);
    }

    /** Brilho da janela do app (0..1). Nao precisa de permissao WRITE_SETTINGS. */
    @PluginMethod
    public void setBrightness(PluginCall call) {
        final float value = (float) Math.max(0.01, Math.min(1.0, call.getDouble("value", 1.0)));
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            WindowManager.LayoutParams params = activity.getWindow().getAttributes();
            params.screenBrightness = value;
            activity.getWindow().setAttributes(params);
        });
        call.resolve();
    }

    /** Volta o brilho para o padrao do sistema. */
    @PluginMethod
    public void resetBrightness(PluginCall call) {
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            WindowManager.LayoutParams params = activity.getWindow().getAttributes();
            params.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
            activity.getWindow().setAttributes(params);
        });
        call.resolve();
    }

    /** Volume de midia do aparelho, 0..1. */
    @PluginMethod
    public void setVolume(PluginCall call) {
        AudioManager am = audio();
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        double value = Math.max(0.0, Math.min(1.0, call.getDouble("value", 1.0)));
        int target = (int) Math.round(value * max);
        am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
        JSObject ret = new JSObject();
        ret.put("value", max == 0 ? 0 : (double) target / max);
        call.resolve(ret);
    }

    @PluginMethod
    public void getVolume(PluginCall call) {
        AudioManager am = audio();
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        JSObject ret = new JSObject();
        ret.put("value", max == 0 ? 0 : (double) cur / max);
        call.resolve(ret);
    }

    /** Um passo de volume para cima/baixo, mostrando a barrinha do sistema. */
    @PluginMethod
    public void adjustVolume(PluginCall call) {
        boolean up = call.getBoolean("up", true);
        AudioManager am = audio();
        am.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            up ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER,
            AudioManager.FLAG_SHOW_UI
        );
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        JSObject ret = new JSObject();
        ret.put("value", max == 0 ? 0 : (double) cur / max);
        call.resolve(ret);
    }

    private boolean isTv() {
        android.app.UiModeManager uiModeManager = (android.app.UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        return uiModeManager != null && uiModeManager.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;
    }

    /** Diz para o JS se isto e uma Smart TV (sem toque, controlada por controle remoto). */
    @PluginMethod
    public void getDeviceType(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isTv", isTv());
        call.resolve(ret);
    }

    /** Trava em paisagem (tela cheia) ou volta para o automatico. */
    @PluginMethod
    public void setLandscape(PluginCall call) {
        if (isTv()) {
            call.resolve();
            return;
        }
        final boolean landscape = call.getBoolean("value", true);
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> activity.setRequestedOrientation(
            landscape
                ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        ));
        call.resolve();
    }

    /**
     * Deixa a tela seguir o giroscopio do aparelho: se a vovo deitar o
     * celular, o video vira sozinho; se levantar, volta para vertical.
     * FULL_SENSOR ignora a travinha de rotacao do sistema de proposito.
     */
    @PluginMethod
    public void followSensor(PluginCall call) {
        if (isTv()) {
            call.resolve();
            return;
        }
        final Activity activity = getActivity();
        activity.runOnUiThread(() ->
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR)
        );
        call.resolve();
    }

    /** Volta a travar em vertical (lista de canais). */
    @PluginMethod
    public void lockPortrait(PluginCall call) {
        if (isTv()) {
            call.resolve();
            return;
        }
        final Activity activity = getActivity();
        activity.runOnUiThread(() ->
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
        );
        call.resolve();
    }

    /** Fecha o aplicativo e retorna ao launcher. */
    @PluginMethod
    public void exitApp(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> activity.finishAffinity());
        }
        call.resolve();
    }

    /** Mantem a tela acesa enquanto assiste. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = call.getBoolean("value", true);
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            if (on) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }

    /** Esconde as barras do sistema (modo imersivo) durante a tela cheia. */
    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean on = call.getBoolean("value", true);
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            // setSystemUiVisibility esta depreciado e o Android 15 em diante
            // simplesmente ignora, entao a vovo deitava o celular e as barras
            // continuavam por cima do video.
            WindowInsetsControllerCompat controle = WindowCompat.getInsetsController(
                activity.getWindow(), activity.getWindow().getDecorView());

            if (on) {
                controle.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controle.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                controle.show(WindowInsetsCompat.Type.systemBars());
            }
        });
        call.resolve();
    }

    /**
     * Abre o seletor de TV do Android (Transmitir / Smart View).
     * Tenta o painel de cast; se o aparelho nao tiver, cai para as
     * configuracoes de tela para o usuario achar "Transmitir".
     */
    @PluginMethod
    public void openCastPicker(PluginCall call) {
        JSObject ret = new JSObject();
        String[] targets = new String[] {
            "android.settings.CAST_SETTINGS",
            Settings.ACTION_CAST_SETTINGS,
            Settings.ACTION_DISPLAY_SETTINGS
        };
        for (String action : targets) {
            try {
                Intent intent = new Intent(action);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                ret.put("opened", true);
                ret.put("action", action);
                call.resolve(ret);
                return;
            } catch (ActivityNotFoundException ignored) {
                // tenta o proximo
            }
        }
        ret.put("opened", false);
        call.resolve(ret);
    }

    /** Permite ou bloqueia entrada automatica em PiP ao sair do app durante o video. */
    @PluginMethod
    public void setPipAllowed(PluginCall call) {
        final boolean allowed = call.getBoolean("value", false);
        final Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            activity.runOnUiThread(() -> ((MainActivity) activity).setPipPermitido(allowed));
        }
        call.resolve();
    }

    /** Coloca o player em janela flutuante (Picture-in-Picture). */
    @PluginMethod
    public void enterPip(PluginCall call) {
        final Activity activity = getActivity();
        if (!(activity instanceof MainActivity)) {
            JSObject ret = new JSObject();
            ret.put("entered", false);
            call.resolve(ret);
            return;
        }
        activity.runOnUiThread(() -> {
            boolean ok = ((MainActivity) activity).entrarEmPip();
            JSObject ret = new JSObject();
            ret.put("entered", ok);
            call.resolve(ret);
        });
    }

    /** Manda o stream para outro app (VLC, player da TV, etc). */
    @PluginMethod
    public void sendToExternalPlayer(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "CLARICE TV");
        if (url == null || url.isEmpty()) {
            call.reject("url vazia");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(android.net.Uri.parse(url), "video/*");
            intent.putExtra("title", title);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(intent, "Abrir canal em...");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("nao foi possivel abrir: " + e.getMessage());
        }
    }
}
