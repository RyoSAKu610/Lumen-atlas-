import type { WorldSnapshot } from './types';

/**
 * Browser persistence envelope is deliberately separate from the simulation snapshot schema.
 * The simulation checksum validates the ecological state; this envelope version validates
 * the browser-storage wrapper and lets us change storage policy without migrating the world.
 */
export const WORLD_STORAGE_FORMAT_VERSION = 1;

export interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SnapshotReadStatus = 'empty' | 'ready' | 'corrupt' | 'unavailable';

export interface SnapshotReadResult {
  status: SnapshotReadStatus;
  snapshot: WorldSnapshot | null;
  message: string;
}

export interface SnapshotWriteResult {
  saved: boolean;
  message: string;
}

/** Read a snapshot without trusting browser storage. Simulation.restore performs full schema/checksum validation. */
export function readWorldSnapshot(storage: SnapshotStorage | null, key: string): SnapshotReadResult {
  if (!storage) {
    return { status: 'unavailable', snapshot: null, message: 'このブラウザではローカル保存を利用できません' };
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) return { status: 'empty', snapshot: null, message: '新しい観察記録' };
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || envelope.formatVersion !== WORLD_STORAGE_FORMAT_VERSION || !isRecord(envelope.snapshot)) {
      safeRemove(storage, key);
      return { status: 'corrupt', snapshot: null, message: '保存形式が古いか壊れているため、新しい世界を開始します' };
    }
    const snapshot = envelope.snapshot as unknown as WorldSnapshot;
    if (
      typeof snapshot.schemaVersion !== 'number' ||
      typeof snapshot.regionId !== 'string' ||
      typeof snapshot.savedAtWallClockMs !== 'number' ||
      !Number.isFinite(snapshot.savedAtWallClockMs)
    ) {
      safeRemove(storage, key);
      return { status: 'corrupt', snapshot: null, message: '保存データの必須項目が不足しているため、新しい世界を開始します' };
    }
    return { status: 'ready', snapshot, message: '前回の世界を復元します' };
  } catch {
    return { status: 'unavailable', snapshot: null, message: '保存データを読み込めません。今回は新しい世界を開始します' };
  }
}

/** Save the complete checksummed simulation snapshot. Quota / privacy errors never crash the simulation. */
export function writeWorldSnapshot(
  storage: SnapshotStorage | null,
  key: string,
  snapshot: WorldSnapshot,
): SnapshotWriteResult {
  if (!storage) return { saved: false, message: 'ローカル保存が利用できません' };
  try {
    const value = JSON.stringify({ formatVersion: WORLD_STORAGE_FORMAT_VERSION, snapshot });
    storage.setItem(key, value);
    return { saved: true, message: '世界の状態を保存しました' };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = name === 'QuotaExceededError'
      ? '保存容量が不足しています。ブラウザの保存領域を確認してください'
      : '保存に失敗しました。シミュレーションは継続します';
    return { saved: false, message };
  }
}

/**
 * Convert elapsed wall-clock seconds to in-game seconds.
 * Negative time (clock correction / timezone changes) is treated as zero.
 */
export function offlineGameSeconds(savedAtWallClockMs: number, nowWallClockMs: number, clockScale: number): number {
  if (
    !Number.isFinite(savedAtWallClockMs) ||
    !Number.isFinite(nowWallClockMs) ||
    !Number.isFinite(clockScale) ||
    clockScale <= 0
  ) return 0;
  return Math.max(0, (nowWallClockMs - savedAtWallClockMs) / 1000) * clockScale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRemove(storage: SnapshotStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can become unavailable between getItem and removeItem; the caller falls back safely.
  }
}
