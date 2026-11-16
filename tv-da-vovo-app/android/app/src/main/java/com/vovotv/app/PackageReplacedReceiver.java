package com.vovotv.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Executado pelo Android assim que uma nova versao do APK termina de substituir
 * a anterior. Tenta reabrir a CLARICE TV sozinha para que a avo volte direto
 * para os canais sem precisar procurar o icone na tela inicial.
 */
public class PackageReplacedReceiver extends BroadcastReceiver {

    private static final String TAG = "PackageReplacedReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            return;
        }
        try {
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launch == null) {
                launch = new Intent(context, MainActivity.class);
            }
            launch.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            context.startActivity(launch);
        } catch (Exception e) {
            Log.w(TAG, "Nao consegui reabrir automaticamente apos atualizar", e);
        }
    }
}
