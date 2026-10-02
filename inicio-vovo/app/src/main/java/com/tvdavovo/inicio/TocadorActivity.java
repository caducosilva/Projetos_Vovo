package com.tvdavovo.inicio;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.VideoView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Tela cheia que toca o que veio do celular. Usa o player do proprio Android
 * da TV (decodificacao por hardware da MediaTek), que abre MKV, AC3 e afins
 * sem o celular precisar converter nada.
 *
 * Controle remoto: OK pausa/continua, esquerda/direita voltam/avancam 10s,
 * Voltar encerra e devolve a TV para onde estava.
 */
public class TocadorActivity extends Activity implements Receptor.Tocador {

    private static final int PULO_MS = 10_000;

    private VideoView video;
    private ImageView imagem;
    private TextView aviso;
    private TextView faixa;
    private Receptor.Tipo tipo = Receptor.Tipo.VIDEO;
    private String titulo = "";
    private boolean preparado;
    private boolean querTocar = true;
    private int geracao; // descarta resposta atrasada de uma midia anterior

    private final Runnable posicao = new Runnable() {
        @Override
        public void run() {
            if (preparado && tipo != Receptor.Tipo.IMAGEM) {
                Receptor.posicaoMs = video.getCurrentPosition();
            }
            Receptor.PRINCIPAL.postDelayed(this, 500);
        }
    };
    private final Runnable esconderFaixa = () -> faixa.setVisibility(View.GONE);

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.BLACK);

        video = new VideoView(this);
        FrameLayout.LayoutParams centro = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER);
        raiz.addView(video, centro);

        imagem = new ImageView(this);
        imagem.setScaleType(ImageView.ScaleType.FIT_CENTER);
        imagem.setVisibility(View.GONE);
        raiz.addView(imagem, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        aviso = new TextView(this);
        aviso.setTextColor(Color.WHITE);
        aviso.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        aviso.setTypeface(Typeface.DEFAULT_BOLD);
        aviso.setGravity(Gravity.CENTER);
        aviso.setPadding(dp(48), dp(27), dp(48), dp(27));
        raiz.addView(aviso, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        faixa = new TextView(this);
        faixa.setTextColor(Color.WHITE);
        faixa.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        faixa.setTypeface(Typeface.DEFAULT_BOLD);
        faixa.setPadding(dp(24), dp(14), dp(24), dp(14));
        faixa.setMaxLines(2);
        GradientDrawable fundo = new GradientDrawable();
        fundo.setColor(Color.argb(200, 8, 11, 17));
        fundo.setCornerRadius(dp(14));
        faixa.setBackground(fundo);
        FrameLayout.LayoutParams embaixo = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        embaixo.setMargins(dp(48), 0, dp(48), dp(36));
        raiz.addView(faixa, embaixo);
        faixa.setVisibility(View.GONE);

        setContentView(raiz);

        video.setOnPreparedListener(this::aoPreparar);
        video.setOnCompletionListener(mp -> aoTerminar());
        video.setOnErrorListener((mp, o, e) -> {
            falhou();
            return true;
        });
        video.setOnInfoListener((mp, o, e) -> {
            if (o == MediaPlayer.MEDIA_INFO_BUFFERING_START) aviso.setText("Carregando…");
            else if (o == MediaPlayer.MEDIA_INFO_BUFFERING_END || o == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START)
                aviso.setText(tipo == Receptor.Tipo.AUDIO ? "♪  " + titulo : "");
            return false;
        });

        Receptor.tocador = this;
        carregar(Receptor.uri, Receptor.meta, true);
        Receptor.PRINCIPAL.post(posicao);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Receptor.tocador = this;
        carregar(Receptor.uri, Receptor.meta, true);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // apertaram a casinha ou trocaram de app: encerra, para nao ficar tocando escondido
        if (!isFinishing()) finish();
    }

    @Override
    protected void onDestroy() {
        Receptor.PRINCIPAL.removeCallbacks(posicao);
        Receptor.PRINCIPAL.removeCallbacks(esconderFaixa);
        video.stopPlayback();
        if (Receptor.tocador == this) {
            Receptor.tocador = null;
            Receptor.posicaoMs = 0;
            Receptor.mudar(Receptor.uri.isEmpty() ? Receptor.SEM_MIDIA : Receptor.PARADO);
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------ midia

    private void carregar(String uri, String meta, boolean tocarLogo) {
        geracao++;
        preparado = false;
        querTocar = tocarLogo;
        Receptor.duracaoMs = 0;
        Receptor.posicaoMs = 0;
        if (uri == null || uri.isEmpty()) {
            finish();
            return;
        }
        tipo = Receptor.tipo(uri, meta);
        titulo = Receptor.titulo(meta);
        Receptor.mudar(Receptor.CARREGANDO);
        aviso.setText("Recebendo do celular…");

        if (tipo == Receptor.Tipo.IMAGEM) {
            video.stopPlayback();
            video.setVisibility(View.GONE);
            imagem.setVisibility(View.VISIBLE);
            imagem.setImageDrawable(null);
            baixarImagem(uri, geracao);
        } else {
            imagem.setVisibility(View.GONE);
            imagem.setImageDrawable(null);
            video.setVisibility(View.VISIBLE);
            video.setVideoURI(Uri.parse(uri));
        }
    }

    private void aoPreparar(MediaPlayer mp) {
        preparado = true;
        Receptor.duracaoMs = Math.max(0, mp.getDuration());
        aviso.setText(tipo == Receptor.Tipo.AUDIO ? "♪  " + (titulo.isEmpty() ? "Música" : titulo) : "");
        if (querTocar) {
            video.start();
            Receptor.mudar(Receptor.TOCANDO);
            mostrarFaixa(titulo.isEmpty() ? "Do celular" : titulo);
        } else {
            Receptor.mudar(Receptor.PARADO);
        }
        Receptor.avisar(); // duracao nova para quem assinou
    }

    private void aoTerminar() {
        String prox = Receptor.proxUri;
        if (!prox.isEmpty()) {
            Receptor.uri = prox;
            Receptor.meta = Receptor.proxMeta;
            Receptor.proxUri = "";
            Receptor.proxMeta = "";
            carregar(Receptor.uri, Receptor.meta, true);
            return;
        }
        Receptor.mudar(Receptor.PARADO);
        Receptor.PRINCIPAL.postDelayed(this::finish, 1500);
    }

    private void falhou() {
        Receptor.mudar(Receptor.PARADO);
        aviso.setText("Não deu para abrir este arquivo na TV.");
        faixa.setVisibility(View.GONE);
        Receptor.PRINCIPAL.postDelayed(this::finish, 5000);
    }

    private void baixarImagem(final String uri, final int minha) {
        new Thread(() -> {
            Bitmap bmp = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(uri).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                ByteArrayOutputStream dados = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0 && dados.size() < 64 * 1024 * 1024) dados.write(buf, 0, n);
                }
                byte[] b = dados.toByteArray();
                // foto de celular tem 12 MP ou mais: reduz para caber na memoria da TV
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(b, 0, b.length, o);
                int escala = 1;
                while (o.outWidth / (escala * 2) >= 1920 || o.outHeight / (escala * 2) >= 1080) escala *= 2;
                o = new BitmapFactory.Options();
                o.inSampleSize = escala;
                bmp = BitmapFactory.decodeByteArray(b, 0, b.length, o);
            } catch (Exception | OutOfMemoryError e) {
                bmp = null;
            }
            final Bitmap pronto = bmp;
            Receptor.PRINCIPAL.post(() -> {
                if (minha != geracao || isFinishing()) return;
                if (pronto == null) {
                    falhou();
                    return;
                }
                imagem.setImageBitmap(pronto);
                aviso.setText("");
                preparado = true;
                Receptor.mudar(Receptor.TOCANDO);
            });
        }, "baixar-imagem").start();
    }

    // ------------------------------------------------------------ Receptor.Tocador

    @Override
    public void tocar() {
        if (tipo == Receptor.Tipo.IMAGEM) return;
        if (!preparado) {
            querTocar = true;
            return;
        }
        video.start();
        Receptor.mudar(Receptor.TOCANDO);
        mostrarFaixa("▶  " + (titulo.isEmpty() ? "Tocando" : titulo));
    }

    @Override
    public void pausar() {
        if (tipo == Receptor.Tipo.IMAGEM) return;
        if (!preparado) {
            querTocar = false;
            return;
        }
        video.pause();
        Receptor.mudar(Receptor.PAUSADO);
        mostrarFaixa("❚❚  Pausado  " + Receptor.hms(video.getCurrentPosition()) + " / " + Receptor.hms(Receptor.duracaoMs));
    }

    @Override
    public void parar() {
        finish();
    }

    @Override
    public void buscar(long ms) {
        if (!preparado || tipo == Receptor.Tipo.IMAGEM) return;
        long alvo = Math.max(0, Receptor.duracaoMs > 0 ? Math.min(ms, Receptor.duracaoMs - 1000) : ms);
        video.seekTo((int) alvo);
        Receptor.posicaoMs = alvo;
        mostrarFaixa(Receptor.hms(alvo) + " / " + Receptor.hms(Receptor.duracaoMs));
    }

    @Override
    public void trocar(String uri, String meta) {
        carregar(uri, meta, false);
    }

    // ------------------------------------------------------------ controle remoto

    @Override
    public boolean onKeyDown(int codigo, KeyEvent evento) {
        switch (codigo) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (video.isPlaying()) pausar();
                else tocar();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                tocar();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                pausar();
                return true;
            case KeyEvent.KEYCODE_MEDIA_STOP:
                finish();
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                buscar(video.getCurrentPosition() - PULO_MS);
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                buscar(video.getCurrentPosition() + PULO_MS);
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_INFO:
                mostrarFaixa((titulo.isEmpty() ? "Do celular" : titulo)
                    + (tipo == Receptor.Tipo.IMAGEM ? "" : "\n" + Receptor.hms(video.getCurrentPosition())
                    + " / " + Receptor.hms(Receptor.duracaoMs)));
                return true;
            default:
                return super.onKeyDown(codigo, evento);
        }
    }

    private void mostrarFaixa(String texto) {
        faixa.setText(texto);
        faixa.setVisibility(View.VISIBLE);
        Receptor.PRINCIPAL.removeCallbacks(esconderFaixa);
        Receptor.PRINCIPAL.postDelayed(esconderFaixa, 4000);
    }

    private int dp(int valor) {
        return Math.round(valor * getResources().getDisplayMetrics().density);
    }
}
