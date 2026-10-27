import type { World } from '../sim/world';

/** Bump this whenever the saved shape of World changes, and add a migration from the previous version. */
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'summit-tycoon/save';

export interface SaveFile {
  readonly version: number;
  readonly savedAt: string;
  readonly world: World;
}

/** A raw save as read from storage, before migration. */
interface VersionedData {
  readonly version: number;
  readonly savedAt: string;
  readonly world: unknown;
}

/**
 * MIGRATIONS[n] upgrades a version n save to version n + 1. Old saves run every step up to SAVE_VERSION,
 * so each migration only ever has to understand its neighbour.
 */
const MIGRATIONS: Readonly<Record<number, (save: VersionedData) => VersionedData>> = {};

/** The subset of the Web Storage API we use, so tests can pass a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LoadResult = { readonly ok: true; readonly world: World } | { readonly ok: false; readonly error: string };

export const serialize = (world: World, now: Date = new Date()): string =>
  JSON.stringify({ version: SAVE_VERSION, savedAt: now.toISOString(), world } satisfies SaveFile);

function isVersioned(data: unknown): data is VersionedData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return Number.isInteger(d['version']) && typeof d['savedAt'] === 'string' && typeof d['world'] === 'object' && d['world'] !== null;
}

export function deserialize(json: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'The save is corrupted.' };
  }
  if (!isVersioned(data)) return { ok: false, error: 'That is not a Summit Tycoon save.' };
  if (data.version > SAVE_VERSION) return { ok: false, error: 'This save is from a newer version of the game.' };
  let save = data;
  while (save.version < SAVE_VERSION) {
    const migrate = MIGRATIONS[save.version];
    if (!migrate) return { ok: false, error: `No upgrade path from save version ${save.version}.` };
    save = migrate(save);
  }
  // The shape now matches the current World because it was written by this version or migrated to it.
  return { ok: true, world: save.world as World };
}

export function saveGame(store: KeyValueStore, world: World): void {
  store.setItem(SAVE_KEY, serialize(world));
}

export function loadGame(store: KeyValueStore): LoadResult | null {
  const json = store.getItem(SAVE_KEY);
  return json === null ? null : deserialize(json);
}
