package com.vovotv.app;

import android.content.Context;

import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;

import java.util.List;

/**
 * Configuracao do Google Cast, lida pelo Play Services na primeira vez que o
 * app pede o CastContext (o nome desta classe esta no AndroidManifest).
 *
 * Usamos o Default Media Receiver, o mesmo receptor que o painel do PC usa com
 * sucesso nesta TV: e o unico que nao exige registrar um app no Cast Developer
 * Console, e ele abre HLS sozinho.
 */
public class CastOptionsProvider implements OptionsProvider {

    @Override
    public CastOptions getCastOptions(Context context) {
        return new CastOptions.Builder()
            .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
            // A vovo pode fechar o app depois de mandar o canal para a TV; sem
            // isto a sessao morreria junto e a TV voltaria para a tela inicial.
            .setStopReceiverApplicationWhenEndingSession(false)
            .setResumeSavedSession(true)
            .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
    }
}
