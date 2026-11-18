import { registerPlugin, Capacitor } from '@capacitor/core';

/** Espaco das barras do sistema, em pixels de CSS. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TvBridgePlugin {
  getInsets(): Promise<Insets>;
  setBrightness(options: { value: number }): Promise<void>;
  resetBrightness(): Promise<void>;
  setVolume(options: { value: number }): Promise<{ value: number }>;
  getVolume(): Promise<{ value: number }>;
  adjustVolume(options: { up: boolean }): Promise<{ value: number }>;
  setLandscape(options: { value: boolean }): Promise<void>;
  followSensor(): Promise<void>;
  lockPortrait(): Promise<void>;
  keepAwake(options: { value: boolean }): Promise<void>;
  setImmersive(options: { value: boolean }): Promise<void>;
  setPipAllowed(options: { value: boolean }): Promise<void>;
  enterPip(): Promise<{ entered: boolean }>;
  openCastPicker(): Promise<{ opened: boolean; action?: string }>;
  sendToExternalPlayer(options: { url: string; title?: string }): Promise<void>;
  exitApp(): Promise<void>;
  getDeviceType(): Promise<{ isTv: boolean }>;
}

const TvBridge = registerPlugin<TvBridgePlugin>('TvBridge');

export const isNative = Capacitor.isNativePlatform();

/** Chama o plugin nativo sem estourar erro quando roda no navegador. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!isNative) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

export const tv = {
  getInsets: () => safe(() => TvBridge.getInsets()),
  setBrightness: (value: number) => safe(() => TvBridge.setBrightness({ value })),
  resetBrightness: () => safe(() => TvBridge.resetBrightness()),
  setVolume: (value: number) => safe(() => TvBridge.setVolume({ value })),
  getVolume: () => safe(() => TvBridge.getVolume()),
  adjustVolume: (up: boolean) => safe(() => TvBridge.adjustVolume({ up })),
  setLandscape: (value: boolean) => safe(() => TvBridge.setLandscape({ value })),
  followSensor: () => safe(() => TvBridge.followSensor()),
  lockPortrait: () => safe(() => TvBridge.lockPortrait()),
  keepAwake: (value: boolean) => safe(() => TvBridge.keepAwake({ value })),
  setImmersive: (value: boolean) => safe(() => TvBridge.setImmersive({ value })),
  setPipAllowed: (value: boolean) => safe(() => TvBridge.setPipAllowed({ value })),
  enterPip: () => safe(() => TvBridge.enterPip()),
  openCastPicker: () => safe(() => TvBridge.openCastPicker()),
  sendToExternalPlayer: (url: string, title?: string) =>
    safe(() => TvBridge.sendToExternalPlayer({ url, title })),
  exitApp: () => safe(() => TvBridge.exitApp()),
  getDeviceType: () =>
    // previa no PC com ?tv=1: mostra o app como fica na TV (sem botoes na tela)
    !isNative && import.meta.env.DEV && new URLSearchParams(location.search).has('tv')
      ? Promise.resolve({ isTv: true })
      : safe(() => TvBridge.getDeviceType())
};
