package com.tvdavovo.inicio;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Tela inicial da TV da vovo: so as entradas HDMI e os aplicativos.
 *
 * Sem fileira de filme recomendado, sem propaganda, sem menu escondido. A
 * casinha do controle sempre volta para ca. Voltar aqui nao faz nada, para a
 * tela nao sumir com um aperto sem querer.
 *
 * Tudo e montado em codigo (sem XML de layout) para o app ficar pequeno e sem
 * dependencia nenhuma alem do proprio Android.
 */
public class MainActivity extends Activity {

    /** Primeiro estes, nesta ordem; o resto vem depois em ordem alfabetica. */
    private static final List<String> PRIMEIROS = Arrays.asList(
        "com.tvdavovo.app",                   // TV da Vovo
        "com.netflix.ninja",                  // Netflix
        "com.globo.globotv",                  // Globoplay
        "com.google.android.youtube.tv",      // YouTube
        "org.smarttube.stable",               // SmartTube
        "tv.pluto.android",                   // Pluto TV
        "br.com.claro.now.smarttvclient",     // Claro TV+
        "com.amazon.amazonvideo.livingroom",  // Prime Video
        "com.android.vending",                // Play Store
        "com.android.tv.settings"             // Configuracoes
    );

    /** Nao aparecem: esta propria tela, o launcher antigo e telas de sistema sem uso. */
    private static final List<String> ESCONDIDOS = Arrays.asList(
        "com.tvdavovo.inicio",
        "com.spocky.projengmenu",
        "com.android.tv.tou",                        // termos de uso da fabrica
        "com.mstar.android.tv.disclaimercustomization",
        "com.mediatek.tv.service"                    // servico interno do sintonizador
    );

    private static final int COR_FUNDO = Color.parseColor("#080B11");
    private static final int COR_CARTAO = Color.parseColor("#171E2A");
    private static final int COR_TEXTO = Color.parseColor("#F7FAFC");
    private static final int COR_SUAVE = Color.parseColor("#C2CCD9");
    private static final int COR_DESTAQUE = Color.parseColor("#FBBF24");

    private LinearLayout raiz;
    private View primeiroFocavel;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        ScrollView rolagem = new ScrollView(this);
        rolagem.setBackgroundColor(COR_FUNDO);
        rolagem.setFillViewport(true);
        raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        // margem de ~5% da tela: a TV corta um pouco de cada borda (overscan)
        raiz.setPadding(dp(48), dp(27), dp(48), dp(27));
        raiz.setClipChildren(false);
        raiz.setClipToPadding(false);
        rolagem.addView(raiz);
        setContentView(rolagem);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // remonta sempre: app instalado ou removido aparece/some sozinho
        montar();
    }

    @Override
    public void onBackPressed() {
        // tela inicial: Voltar nao tem para onde ir
    }

    @Override
    public boolean onKeyDown(int codigo, KeyEvent evento) {
        if (codigo == KeyEvent.KEYCODE_BACK) return true;
        return super.onKeyDown(codigo, evento);
    }

    private void montar() {
        raiz.removeAllViews();
        primeiroFocavel = null;

        List<Item> entradas = entradasHdmi();
        if (!entradas.isEmpty()) {
            raiz.addView(titulo("Entradas"));
            raiz.addView(grade(entradas, 4, 96));
        }
        raiz.addView(titulo("Aplicativos"));
        raiz.addView(grade(aplicativos(), 5, 96));

        if (primeiroFocavel != null) primeiroFocavel.requestFocus();
    }

    // ------------------------------------------------------------ entradas

    private List<Item> entradasHdmi() {
        List<Item> itens = new ArrayList<>();
        TvInputManager tvs = (TvInputManager) getSystemService(Context.TV_INPUT_SERVICE);
        if (tvs == null) return itens;
        int numero = 0;
        for (TvInputInfo info : tvs.getTvInputList()) {
            if (info.getType() != TvInputInfo.TYPE_HDMI) continue;
            if (info.getParentId() != null) continue; // aparelho ligado via CEC: ja esta na porta
            if (info.isHidden(this)) continue;
            numero++;
            CharSequence proprio = info.loadCustomLabel(this);
            CharSequence padrao = info.loadLabel(this);
            String nome = proprio != null && proprio.length() > 0 ? proprio.toString()
                : padrao != null && padrao.length() > 0 ? padrao.toString()
                : "HDMI " + numero;
            Intent abrir = new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(info.getId()));
            abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Item item = new Item(nome, null, abrir);
            item.sigla = "ENTRADA";
            itens.add(item);
        }
        itens.sort((x, y) -> Integer.compare(numeroNoNome(x.nome), numeroNoNome(y.nome)));
        return itens;
    }

    private static int numeroNoNome(String nome) {
        String digitos = nome.replaceAll("[^0-9]+", "");
        try {
            return digitos.isEmpty() ? 99 : Integer.parseInt(digitos);
        } catch (NumberFormatException e) {
            return 99;
        }
    }

    // ------------------------------------------------------------ apps

    private List<Item> aplicativos() {
        PackageManager pm = getPackageManager();
        Map<String, ResolveInfo> porPacote = new LinkedHashMap<>();
        // app feito para TV primeiro; o de celular so entra se nao houver o de TV
        for (String categoria : new String[] { Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER }) {
            Intent busca = new Intent(Intent.ACTION_MAIN).addCategory(categoria);
            for (ResolveInfo r : pm.queryIntentActivities(busca, 0)) {
                String pacote = r.activityInfo.packageName;
                if (ESCONDIDOS.contains(pacote) || porPacote.containsKey(pacote)) continue;
                porPacote.put(pacote, r);
            }
        }

        List<Item> itens = new ArrayList<>();
        for (Map.Entry<String, ResolveInfo> e : porPacote.entrySet()) {
            ActivityInfo a = e.getValue().activityInfo;
            Intent abrir = pm.getLeanbackLaunchIntentForPackage(e.getKey());
            if (abrir == null) abrir = pm.getLaunchIntentForPackage(e.getKey());
            if (abrir == null) continue;
            abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Drawable banner = a.loadBanner(pm);
            if (banner == null) banner = a.applicationInfo.loadBanner(pm);
            Item item = new Item(String.valueOf(a.loadLabel(pm)), banner, abrir);
            item.icone = banner == null ? a.loadIcon(pm) : null;
            item.pacote = e.getKey();
            itens.add(item);
        }

        final Collator ordem = Collator.getInstance(new Locale("pt", "BR"));
        itens.sort((x, y) -> {
            int px = PRIMEIROS.indexOf(x.pacote);
            int py = PRIMEIROS.indexOf(y.pacote);
            if (px >= 0 || py >= 0) {
                if (px < 0) return 1;
                if (py < 0) return -1;
                return px - py;
            }
            return ordem.compare(x.nome, y.nome);
        });
        return itens;
    }

    // ------------------------------------------------------------ desenho

    private TextView titulo(String texto) {
        TextView t = new TextView(this);
        t.setText(texto);
        t.setTextColor(COR_SUAVE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(dp(4), dp(10), 0, dp(8));
        return t;
    }

    private GridLayout grade(List<Item> itens, int colunas, int alturaDp) {
        GridLayout g = new GridLayout(this);
        // o cartao em foco cresce 8%: sem isto a borda dele era cortada
        g.setClipChildren(false);
        g.setClipToPadding(false);
        g.setPadding(dp(8), dp(6), 0, 0);
        g.setColumnCount(colunas);
        g.setUseDefaultMargins(false);
        int largura = (larguraUtilDp() - (colunas - 1) * 14) / colunas;
        for (Item item : itens) {
            View cartao = cartao(item, largura, alturaDp);
            GridLayout.LayoutParams lp = new GridLayout.LayoutParams();
            lp.width = dp(largura);
            lp.height = dp(alturaDp);
            lp.setMargins(0, 0, dp(14), dp(14));
            g.addView(cartao, lp);
            if (primeiroFocavel == null) primeiroFocavel = cartao;
        }
        return g;
    }

    private View cartao(final Item item, int larguraDp, int alturaDp) {
        final FrameLayout f = new FrameLayout(this);
        f.setFocusable(true);
        f.setClickable(true);
        f.setClipToOutline(true);

        final GradientDrawable fundo = new GradientDrawable();
        fundo.setCornerRadius(dp(14));
        fundo.setColor(COR_CARTAO);
        f.setBackground(fundo);

        if (item.banner != null) {
            ImageView img = new ImageView(this);
            img.setImageDrawable(item.banner);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            f.addView(img, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        } else {
            LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setGravity(Gravity.CENTER);
            col.setPadding(dp(8), dp(8), dp(8), dp(8));
            if (item.icone != null) {
                ImageView ic = new ImageView(this);
                ic.setImageDrawable(item.icone);
                col.addView(ic, new LinearLayout.LayoutParams(dp(44), dp(44)));
            } else if (item.sigla != null) {
                TextView s = new TextView(this);
                s.setText(item.sigla);
                s.setTextColor(COR_DESTAQUE);
                s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                s.setTypeface(Typeface.DEFAULT_BOLD);
                col.addView(s);
            }
            TextView nome = new TextView(this);
            nome.setText(item.nome);
            nome.setTextColor(COR_TEXTO);
            nome.setTextSize(TypedValue.COMPLEX_UNIT_SP, item.sigla != null ? 20 : 15);
            nome.setTypeface(Typeface.DEFAULT_BOLD);
            nome.setGravity(Gravity.CENTER);
            nome.setMaxLines(2);
            nome.setPadding(0, dp(6), 0, 0);
            col.addView(nome);
            f.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        // Foco bem visivel: borda amarela grossa e o cartao cresce um pouco
        f.setOnFocusChangeListener((v, temFoco) -> {
            fundo.setStroke(temFoco ? dp(4) : 0, COR_DESTAQUE);
            v.animate().scaleX(temFoco ? 1.08f : 1f).scaleY(temFoco ? 1.08f : 1f).setDuration(120).start();
            v.setElevation(temFoco ? dp(8) : 0);
        });

        f.setOnClickListener(v -> {
            try {
                startActivity(item.abrir);
            } catch (ActivityNotFoundException | SecurityException erro) {
                Toast.makeText(this, "Não deu para abrir " + item.nome, Toast.LENGTH_SHORT).show();
            }
        });
        f.setContentDescription(item.nome);
        return f;
    }

    private int larguraUtilDp() {
        float densidade = getResources().getDisplayMetrics().density;
        int larguraDp = (int) (getResources().getDisplayMetrics().widthPixels / densidade);
        return larguraDp - 96 - 8; // padding esquerdo + direito + respiro do foco
    }

    private int dp(int valor) {
        return Math.round(valor * getResources().getDisplayMetrics().density);
    }

    private static class Item {
        final String nome;
        final Drawable banner;
        final Intent abrir;
        Drawable icone;
        String sigla;
        String pacote = "";

        Item(String nome, Drawable banner, Intent abrir) {
            this.nome = nome;
            this.banner = banner;
            this.abrir = abrir;
        }
    }
}
