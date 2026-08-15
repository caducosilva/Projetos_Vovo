package com.vovotv.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Atualizacao pelo proprio app: baixa o APK novo e chama o instalador.
 *
 * Existe porque o app nao vive na Play Store. Sem isso, atualizar significaria
 * a vovo baixar arquivo pelo navegador e achar a pasta de downloads sozinha,
 * que e justamente o tipo de passo que ela nao consegue dar.
 */
@CapacitorPlugin(name = "UpdateBridge")
public class UpdateBridge extends Plugin {

    private static final String TAG = "UpdateBridge";
    private static final String APK_NAME = "VovoTV-atualizacao.apk";

    /** Versao instalada agora, para comparar com a publicada. */
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;

            ret.put("versionCode", code);
            ret.put("versionName", info.versionName);
            ret.put("packageName", ctx.getPackageName());
            call.resolve(ret);
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(TAG, "nao li a versao instalada", e);
            call.reject("Nao consegui ler a versao instalada", e);
        }
    }

    /**
     * Android 8 em diante exige permissao explicita para instalar APK de fora
     * da loja. Sem checar antes, o download termina e o instalador morre calado.
     */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            ret.put("allowed", true);
            call.resolve(ret);
            return;
        }
        ret.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(ret);
    }

    /** Abre a tela onde a pessoa libera "instalar apps desconhecidos". */
    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            Log.w(TAG, "tela de permissao de instalacao nao existe", e);
            call.reject("Nao achei a tela de permissao neste aparelho", e);
        }
    }

    /**
     * Baixa o APK e abre o instalador no fim.
     *
     * Emite "downloadProgress" (0..100) enquanto baixa, para a tela mostrar
     * barra em vez de deixar a vovo olhando para nada.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (TextUtils.isEmpty(url)) {
            call.reject("url do APK vazia");
            return;
        }

        final Context ctx = getContext();
        final File target = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_NAME);
        if (target.exists() && !target.delete()) {
            Log.w(TAG, "nao apaguei o APK anterior, seguindo assim mesmo");
        }

        final DownloadManager manager =
            (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Este aparelho nao tem gerenciador de downloads");
            return;
        }

        final long downloadId;
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Vovo TV");
            request.setDescription("Baixando a atualizacao");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationUri(Uri.fromFile(target));
            request.setAllowedOverRoaming(false);
            downloadId = manager.enqueue(request);
        } catch (IllegalArgumentException | SecurityException e) {
            Log.w(TAG, "download recusado", e);
            call.reject("Nao consegui comecar o download: " + e.getMessage(), e);
            return;
        }

        new Thread(() -> watchDownload(manager, downloadId, target, call)).start();
    }

    /**
     * Acompanha o download ate acabar.
     *
     * DownloadManager nao tem callback de progresso, so a tabela consultavel,
     * entao a leitura periodica e o unico jeito de alimentar a barra.
     */
    private void watchDownload(DownloadManager manager, long downloadId, File target, PluginCall call) {
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        int lastPercent = -1;

        while (true) {
            try (Cursor cursor = manager.query(query)) {
                if (cursor == null || !cursor.moveToFirst()) {
                    call.reject("O download sumiu antes de terminar");
                    return;
                }

                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long done = cursor.getLong(
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = cursor.getLong(
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));

                if (total > 0) {
                    int percent = (int) (done * 100 / total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject progress = new JSObject();
                        progress.put("percent", percent);
                        notifyListeners("downloadProgress", progress);
                    }
                }

                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    launchInstaller(target, call);
                    return;
                }
                if (status == DownloadManager.STATUS_FAILED) {
                    int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                    manager.remove(downloadId);
                    call.reject("O download falhou (codigo " + reason + ")");
                    return;
                }
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "consulta do download falhou", e);
                call.reject("Perdi o download no meio do caminho", e);
                return;
            }

            try {
                Thread.sleep(400);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                call.reject("Download interrompido");
                return;
            }
        }
    }

    /** Entrega o APK ao instalador do sistema via FileProvider. */
    private void launchInstaller(File apk, PluginCall call) {
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ctx.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("installing", true);
            call.resolve(ret);
        } catch (IllegalArgumentException | android.content.ActivityNotFoundException e) {
            Log.w(TAG, "instalador nao abriu", e);
            call.reject("Baixou, mas nao consegui abrir o instalador: " + e.getMessage(), e);
        }
    }
}
