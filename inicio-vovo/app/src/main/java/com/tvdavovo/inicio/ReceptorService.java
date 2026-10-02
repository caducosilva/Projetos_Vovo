package com.tvdavovo.inicio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Mantem o receptor DLNA ligado o tempo todo: servico em primeiro plano (o
 * Android nao mata), sobe no boot (InicioNoBoot), toda vez que a tela inicial
 * abre e, de garantia, num vigia a cada 15 minutos (VigiaJob).
 */
public class ReceptorService extends Service {

    static final String NOME = "TV da Vovó";
    private static final String CANAL = "receptor";
    private static final String TAG = "ReceptorDLNA";

    private ServidorUpnp servidor;
    private Ssdp ssdp;
    private PowerManager.WakeLock acordado;
    private WifiManager.MulticastLock multicast;

    /** Liga o receptor se ainda nao estiver ligado. Pode chamar quantas vezes quiser. */
    static void garantir(Context ctx) {
        Intent i = new Intent(ctx, ReceptorService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (RuntimeException e) {
            Log.w(TAG, "nao deu para ligar o receptor agora: " + e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ficarEmPrimeiroPlano();

        // CPU acordada mesmo com a tela apagada: o celular pode mandar video a qualquer hora
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        acordado = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tvdavovo:receptor");
        acordado.setReferenceCounted(false);
        acordado.acquire();
        // sem isto o Android joga fora os pacotes multicast do Wi-Fi (busca do celular)
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi != null) {
            multicast = wifi.createMulticastLock("tvdavovo:ssdp");
            multicast.setReferenceCounted(false);
            multicast.acquire();
        }

        String id = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        String uuid = UUID.nameUUIDFromBytes(("tvdavovo-receptor-" + id).getBytes(StandardCharsets.UTF_8)).toString();
        servidor = new ServidorUpnp(this, uuid, NOME);
        servidor.iniciar();
        ssdp = new Ssdp(uuid);
        ssdp.iniciar();
        VigiaJob.agendar(this);
        Log.i(TAG, "receptor ligado como \"" + NOME + "\" uuid " + uuid);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ficarEmPrimeiroPlano();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (ssdp != null) ssdp.parar();
        if (servidor != null) servidor.parar();
        if (acordado != null && acordado.isHeld()) acordado.release();
        if (multicast != null && multicast.isHeld()) multicast.release();
        Log.i(TAG, "receptor desligado");
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // tiraram o app da lista de recentes: volta sozinho
        garantir(this);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ficarEmPrimeiroPlano() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel c = new NotificationChannel(CANAL, "Receptor de vídeos do celular",
                NotificationManager.IMPORTANCE_MIN);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
            b = new Notification.Builder(this, CANAL);
        } else {
            b = new Notification.Builder(this);
        }
        Notification n = b.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(NOME)
            .setContentText("Pronta para receber vídeos do celular")
            .setOngoing(true)
            .build();
        startForeground(1, n);
    }
}
