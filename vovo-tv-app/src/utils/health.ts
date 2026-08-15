import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './tvBridge';

/**
 * Saude dos canais (força de sinal) com suporte total a TV e Rádios (Icecast/Shoutcast/HLS/AAC/MP3).
 */

export type HealthStatus = 'unknown' | 'ok' | 'doubt' | 'dead' | 'confirmed';

export interface HealthEntry {
  status: HealthStatus;
  fail_count: number;
  ok_count: number;
  confirmed: boolean;
  last_check: string;
  last_error: string;
  class: string;
  latency_ms?: number;
  signal: number;
}

export type HealthMap = Record<string, HealthEntry>;

const STORAGE_KEY = 'vovo_tv_health';
const FAILS_TO_DEAD = 3;
export const STALE_MINUTES = 45;

export function emptyEntry(): HealthEntry {
  return {
    status: 'unknown',
    fail_count: 0,
    ok_count: 0,
    confirmed: false,
    last_check: '',
    last_error: '',
    class: '',
    signal: 80
  };
}

export function loadHealth(): HealthMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.channels && typeof parsed.channels === 'object') return parsed.channels as HealthMap;
      return parsed as HealthMap;
    }
  } catch {
    /* cache corrompido: comeca de novo */
  }
  return {};
}

export function saveHealth(map: HealthMap): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ updated_at: new Date().toISOString(), channels: map })
    );
  } catch {
    /* sem espaço: segue sem cache */
  }
}

/** Qualidade 0-100 usada para ordenar a lista (melhor = maior). */
export function signalScore(entry: Partial<HealthEntry>): number {
  const st = (entry.status || 'unknown') as HealthStatus;
  const fails = entry.fail_count || 0;
  const lat = entry.latency_ms;

  if (st === 'dead') return 0;
  if (st === 'doubt') return Math.max(5, 35 - fails * 6);
  if (st === 'unknown') return 80;

  let base = st === 'confirmed' ? 95 : 82;
  if (typeof lat === 'number' && !Number.isNaN(lat)) {
    if (lat < 250) base += 8;
    else if (lat < 600) base += 4;
    else if (lat < 1200) base += 1;
    else if (lat < 2500) base -= 6;
    else base -= 15;
  }
  if ((entry.ok_count || 0) >= 2) base += 2;
  if (st === 'confirmed') base = Math.max(base, 90);

  return Math.max(0, Math.min(100, Math.round(base)));
}

/** Barras de sinal 0-4 para mostrar no card. */
export function signalBars(score: number): number {
  if (score <= 0) return 0;
  if (score < 36) return 1;
  if (score < 60) return 2;
  if (score < 85) return 3;
  return 4;
}

export function statusLabel(status: HealthStatus): string {
  switch (status) {
    case 'confirmed':
      return 'Sinal ótimo';
    case 'ok':
      return 'Sinal bom';
    case 'doubt':
      return 'Sinal fraco';
    case 'dead':
      return 'Sem sinal';
    default:
      return 'Sinal pronto';
  }
}

const HARD_TOKENS = [
  '404',
  '410',
  '403',
  '401',
  '451',
  'dns',
  'getaddrinfo',
  'unable to resolve host',
  'no such host',
  'nodename nor servname',
  'econnrefused',
  'connection refused',
  'recusou',
  'malformed',
  'unsupported'
];

export function classifyProbeError(error: string): 'hard' | 'soft' {
  const msg = (error || '').toLowerCase();
  return HARD_TOKENS.some((t) => msg.includes(t)) ? 'hard' : 'soft';
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  latency_ms?: number;
  bytes?: number;
}

/**
 * Testa um canal ou rádio de verdade usando o HTTP nativo do Capacitor.
 */
export async function probeChannel(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  const started = performance.now();
  const isManifest = /\.m3u8(\?|$)/i.test(url) || /\.m3u(\?|$)/i.test(url);

  if (!isNative) {
    return { ok: true, latency_ms: 120 };
  }

  const common = {
    url,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
    headers: {
      'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
      'Accept': '*/*',
      'Icy-MetaData': '1'
    }
  };

  const elapsed = () => Math.round(performance.now() - started);

  try {
    if (isManifest) {
      const res = await CapacitorHttp.request({
        ...common,
        method: 'GET',
        responseType: 'text'
      });
      const body = typeof res.data === 'string' ? res.data : '';
      if (res.status >= 200 && res.status < 400 && (body.includes('#EXTM3U') || body.length > 0)) {
        return { ok: true, latency_ms: elapsed(), bytes: body.length };
      }
      return { ok: false, error: `http ${res.status}`, latency_ms: elapsed() };
    }

    // Stream de áudio ou direto (MP3 / AAC / Shoutcast / Icecast / TS)
    // Tenta HEAD primeiro
    const head = await CapacitorHttp.request({ ...common, method: 'HEAD' });
    if (head.status >= 200 && head.status < 400) {
      return { ok: true, latency_ms: elapsed() };
    }

    // Se HEAD for recusado (comum em servidores de rádio Shoutcast), faz GET com Range
    const res = await CapacitorHttp.request({
      ...common,
      method: 'GET',
      responseType: 'text',
      headers: { ...common.headers, Range: 'bytes=0-1023' }
    });
    if (res.status >= 200 && res.status < 400) {
      return { ok: true, latency_ms: elapsed() };
    }
    return { ok: false, error: `http ${res.status || head.status}`, latency_ms: elapsed() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || 'falha de rede', latency_ms: elapsed() };
  }
}

/** Aplica o resultado de um teste na entrada de saude. */
export function applyProbeResult(
  prev: HealthEntry | undefined,
  result: ProbeResult
): HealthEntry {
  const e: HealthEntry = { ...emptyEntry(), ...(prev || {}) };
  e.last_check = new Date().toISOString();
  e.last_error = (result.error || '').slice(0, 240);
  if (typeof result.latency_ms === 'number') e.latency_ms = Math.round(result.latency_ms);

  if (result.ok) {
    e.ok_count = (e.ok_count || 0) + 1;
    e.fail_count = 0;
    e.class = 'ok';
    e.status = e.confirmed ? 'confirmed' : 'ok';
  } else {
    const cls = classifyProbeError(result.error || '');
    e.class = cls;
    e.fail_count = (e.fail_count || 0) + 1;
    if (e.confirmed) {
      e.status = 'doubt';
    } else if (cls === 'hard' || e.fail_count >= FAILS_TO_DEAD) {
      e.status = 'dead';
    } else {
      e.status = 'doubt';
    }
  }

  e.signal = signalScore(e);
  return e;
}

/** Canal/Rádio tocou de verdade no player: promove para confirmado. */
export function markConfirmed(prev: HealthEntry | undefined): HealthEntry {
  const e: HealthEntry = { ...emptyEntry(), ...(prev || {}) };
  e.status = 'confirmed';
  e.confirmed = true;
  e.fail_count = 0;
  e.ok_count = (e.ok_count || 0) + 1;
  e.last_check = new Date().toISOString();
  e.last_error = '';
  e.class = 'play_ok';
  e.signal = signalScore(e);
  return e;
}

/** Falhou no player: nunca mata canal confirmado. */
export function markPlaybackFail(prev: HealthEntry | undefined, error: string): HealthEntry {
  return applyProbeResult(prev, { ok: false, error: error || 'falha ao tocar' });
}

export function isStale(entry: HealthEntry | undefined, minutes = STALE_MINUTES): boolean {
  if (!entry || !entry.last_check) return true;
  const t = Date.parse(entry.last_check);
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= minutes * 60_000;
}

/** Roda testes em paralelo com limite de workers. */
export async function runBatchProbe(
  urls: string[],
  workers: number,
  onResult: (url: string, result: ProbeResult) => void,
  shouldStop?: () => boolean
): Promise<void> {
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < urls.length) {
      if (shouldStop?.()) return;
      const url = urls[cursor++];
      const result = await probeChannel(url);
      if (shouldStop?.()) return;
      onResult(url, result);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, workers) }, () => next()));
}
