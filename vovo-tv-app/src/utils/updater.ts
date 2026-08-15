import { registerPlugin } from '@capacitor/core';
import { isNative } from './tvBridge';

/**
 * Endereco do aviso de versao. Fica no proprio repositorio para publicar uma
 * atualizacao ser so editar um arquivo e subir o APK na aba de releases.
 */
const MANIFEST_URL =
  'https://raw.githubusercontent.com/caducosilva/Projetos_Vovo/main/vovo-tv-app/update.json';

const SKIP_KEY = 'vovo_tv_versao_dispensada';
const LAST_CHECK_KEY = 'vovo_tv_ultima_checagem';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface UpdateBridgePlugin {
  getInfo(): Promise<{ versionCode: number; versionName: string; packageName: string }>;
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallPermission(): Promise<void>;
  downloadAndInstall(options: { url: string }): Promise<{ installing: boolean }>;
  addListener(
    event: 'downloadProgress',
    handler: (data: { percent: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const UpdateBridge = registerPlugin<UpdateBridgePlugin>('UpdateBridge');

/** O que o update.json precisa ter. */
export interface UpdateManifest {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes?: string;
  minVersionCode?: number;
}

export interface AvailableUpdate {
  versionName: string;
  notes: string;
  apkUrl: string;
  versionCode: number;
}

function isManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.versionCode === 'number' &&
    typeof m.versionName === 'string' &&
    typeof m.apkUrl === 'string' &&
    m.apkUrl.startsWith('https://')
  );
}

/** Versao instalada. Devolve 0 fora do Android, onde atualizar nao faz sentido. */
export async function installedVersionCode(): Promise<number> {
  if (!isNative) return 0;
  try {
    const info = await UpdateBridge.getInfo();
    return info.versionCode;
  } catch {
    return 0;
  }
}

export async function installedVersionName(): Promise<string> {
  if (!isNative) return 'web';
  try {
    const info = await UpdateBridge.getInfo();
    return info.versionName;
  } catch {
    return '?';
  }
}

/**
 * Procura versao nova.
 *
 * Devolve null quando nao ha nada novo, quando a pessoa ja dispensou aquela
 * versao ou quando a rede falhou: nenhum desses casos merece assustar a vovo
 * com mensagem de erro, o app simplesmente segue funcionando.
 */
export async function checkForUpdate(force = false): Promise<AvailableUpdate | null> {
  if (!isNative) return null;

  if (!force) {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
    if (Date.now() - last < CHECK_INTERVAL_MS) return null;
  }
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

  let manifest: unknown;
  try {
    const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null;
  }

  if (!isManifest(manifest)) return null;

  const current = await installedVersionCode();
  if (current === 0 || manifest.versionCode <= current) return null;

  if (!force && localStorage.getItem(SKIP_KEY) === String(manifest.versionCode)) return null;

  return {
    versionCode: manifest.versionCode,
    versionName: manifest.versionName,
    apkUrl: manifest.apkUrl,
    notes: manifest.notes?.trim() || 'Melhorias e correcoes.'
  };
}

/** Marca a versao como dispensada para nao perguntar de novo toda hora. */
export function skipVersion(versionCode: number): void {
  localStorage.setItem(SKIP_KEY, String(versionCode));
}

export async function canInstallApks(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { allowed } = await UpdateBridge.canInstall();
    return allowed;
  } catch {
    return false;
  }
}

export async function openInstallPermission(): Promise<void> {
  if (!isNative) return;
  try {
    await UpdateBridge.openInstallPermission();
  } catch {
    /* a tela de permissao nao existe neste aparelho; o proximo passo ja avisa */
  }
}

/** Baixa o APK e chama o instalador, reportando o progresso na barra. */
export async function downloadAndInstall(
  apkUrl: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const listener = await UpdateBridge.addListener('downloadProgress', ({ percent }) => {
    onProgress(percent);
  });

  try {
    await UpdateBridge.downloadAndInstall({ url: apkUrl });
  } finally {
    await listener.remove();
  }
}
