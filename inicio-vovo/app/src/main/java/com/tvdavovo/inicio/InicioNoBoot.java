package com.tvdavovo.inicio;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Liga o receptor quando a TV liga e quando o app e atualizado. */
public class InicioNoBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        ReceptorService.garantir(ctx);
    }
}
