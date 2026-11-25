import type { TFile } from "obsidian";
import {
  getAllPeriodicNotes as helperGetAllPeriodicNotes,
  getDateFromFile,
  getDateFromFilename,
  getDateUID,
  isFileInConfiguredFolder,
  isPathInConfiguredFolder,
} from "src/io/periodicNoteHelpers";
import { get, writable } from "svelte/store";

import { defaultSettings } from "src/settings";
import type { ISettings, Periodicity } from "src/settings";

import { getDateUIDFromFile } from "./utils";

// Monotonically increasing revision counter bumped whenever any periodic-note
// store is mutated (reindex, addFile, removeFile, removeByOldPath). Subscribed
// to by Calendar.svelte so every visible cell's metadata re-derives
// deterministically under Svelte 5 runes whenever a note is created, deleted,
// renamed, or reindexed.
export const storeRevision = writable<number>(0);

export function bumpStoreRevision(): void {
  storeRevision.update((n) => n + 1);
}

function createPeriodicNotesStore(periodicity: Periodicity) {
  let hasError = false;
  const store = writable<Record<string, TFile> | null>(null);
  return {
    reindex: () => {
      const currentSettings = get(settings);
      if (!currentSettings[periodicity].enabled) {
        store.set({});
        hasError = false;
        bumpStoreRevision();
        return;
      }
      try {
        const notes = helperGetAllPeriodicNotes(
          periodicity,
          currentSettings[periodicity]
        );
        store.set(notes);
        hasError = false;
      } catch (err) {
        store.set({});
        if (!hasError) {
          // Avoid error being shown multiple times
          console.log(
            `[Calendar] Failed to find ${periodicity} notes folder`,
            err
          );
        }
        hasError = true;
      }
      bumpStoreRevision();
    },
    // Incremental update for a single newly-created file. No-op when the
    // periodicity is disabled, when the file is outside the configured folder,
    // or when the basename doesn't parse against the configured format.
    // Returns true if the store was mutated.
    addFile: (file: TFile): boolean => {
      const currentSettings = get(settings);
      const periodSettings = currentSettings[periodicity];
      if (!periodSettings.enabled) return false;
      if (!isFileInConfiguredFolder(file, periodSettings)) return false;
      const date = getDateFromFile(file, periodicity, periodSettings.format);
      if (!date) return false;
      const uid = getDateUID(date, periodicity);
      let changed = false;
      store.update((current) => {
        if (current?.[uid] === file) return current;
        changed = true;
        // Always emit a new object reference so Svelte subscribers fire.
        return { ...(current ?? {}), [uid]: file };
      });
      // Unconditional: a store write is a render signal even when the file
      // reference happens to be unchanged (e.g. a post-mount rescan reuses
      // the same TFile). The cell metadata sources are non-reactive.
      bumpStoreRevision();
      return changed;
    },
    // Incremental remove for a single deleted file. Same guards as addFile.
    // Returns true if the UID was actually present in the store.
    removeFile: (file: TFile): boolean => {
      const currentSettings = get(settings);
      const periodSettings = currentSettings[periodicity];
      if (!periodSettings.enabled) return false;
      if (!isFileInConfiguredFolder(file, periodSettings)) return false;
      const date = getDateFromFile(file, periodicity, periodSettings.format);
      const uids: string[] = [];
      if (date) {
        uids.push(getDateUID(date, periodicity));
      } else {
        // A deleted TFile can fail the normal parser (path detached, nested
        // folder format changed mid-session). Fall back to a path scan so the
        // stored UID is still cleared.
        for (const [uid, stored] of Object.entries(get(store) ?? {})) {
          if (stored.path === file.path || stored.basename === file.basename) {
            uids.push(uid);
          }
        }
      }
      if (!uids.length) return false;
      let removed = false;
      store.update((current) => {
        if (!current) return current;
        let next = current;
        for (const uid of uids) {
          const stored = current[uid];
          if (!stored) continue;
          // Only remove if this exact file owns the UID — two files under a
          // recursively-scanned folder can parse to the same date.
          if (stored !== file && stored.path !== file.path) continue;
          if (next === current) next = { ...current };
          delete next[uid];
          removed = true;
        }
        return next;
      });
      bumpStoreRevision();
      return removed;
    },
    // Remove the entry that the old path mapped to, given the vault `rename`
    // event's `oldPath`. The file's current path/basename already reflect the
    // post-rename state, so we can't derive the old UID from a TFile — we
    // parse the old basename out of `oldPath` directly. Pairs with `addFile`
    // in the rename handler to move dots cleanly.
    removeByOldPath: (oldPath: string, file: TFile): boolean => {
      const currentSettings = get(settings);
      const periodSettings = currentSettings[periodicity];
      if (!periodSettings.enabled) return false;
      if (!isPathInConfiguredFolder(oldPath, periodSettings)) return false;
      const lastSlash = oldPath.lastIndexOf("/");
      const filename = lastSlash >= 0 ? oldPath.substring(lastSlash + 1) : oldPath;
      const oldBasename = filename.endsWith(".md")
        ? filename.substring(0, filename.length - 3)
        : filename;
      const date = getDateFromFilename(
        oldBasename,
        periodicity,
        periodSettings.format
      );
      if (!date) return false;
      const uid = getDateUID(date, periodicity);
      let removed = false;
      store.update((current) => {
        if (
          !current ||
          !current[uid] ||
          (current[uid] !== file &&
            current[uid].path !== file.path &&
            current[uid].path !== oldPath)
        ) {
          return current;
        }
        removed = true;
        const next = { ...current };
        delete next[uid];
        return next;
      });
      bumpStoreRevision();
      return removed;
    },
    ...store,
  };
}

// Exporting the stores
export const settings = writable<ISettings>(defaultSettings);
export const dailyNotes = createPeriodicNotesStore("daily");
export const weeklyNotes = createPeriodicNotesStore("weekly");
export const monthlyNotes = createPeriodicNotesStore("monthly");
export const yearlyNotes = createPeriodicNotesStore("yearly");
export const quarterlyNotes = createPeriodicNotesStore("quarterly");

// Second daily notes: same date granularity as daily, but independent folder/
// format/template. Uses "daily" periodicity for date parsing and UID generation;
// keyed separately from dailyNotes since it is a distinct store object.
function createSecondDailyNotesStore() {
  let hasError = false;
  const store = writable<Record<string, TFile> | null>(null);
  return {
    reindex: () => {
      const { secondDaily } = get(settings);
      if (!secondDaily.enabled) {
        store.set({});
        hasError = false;
        bumpStoreRevision();
        return;
      }
      try {
        store.set(helperGetAllPeriodicNotes("daily", secondDaily));
        hasError = false;
      } catch (err) {
        store.set({});
        if (!hasError) {
          console.log("[Calendar] Failed to find second daily notes folder", err);
        }
        hasError = true;
      }
      bumpStoreRevision();
    },
    addFile: (file: TFile): boolean => {
      const { secondDaily } = get(settings);
      if (!secondDaily.enabled) return false;
      if (!isFileInConfiguredFolder(file, secondDaily)) return false;
      const date = getDateFromFile(file, "daily", secondDaily.format);
      if (!date) return false;
      const uid = getDateUID(date, "daily");
      let changed = false;
      store.update((current) => {
        if (current?.[uid] === file) return current;
        changed = true;
        return { ...(current ?? {}), [uid]: file };
      });
      // Unconditional: a store write is a render signal even when the file
      // reference happens to be unchanged (e.g. a post-mount rescan reuses
      // the same TFile). The cell metadata sources are non-reactive.
      bumpStoreRevision();
      return changed;
    },
    removeFile: (file: TFile): boolean => {
      const { secondDaily } = get(settings);
      if (!secondDaily.enabled) return false;
      if (!isFileInConfiguredFolder(file, secondDaily)) return false;
      const date = getDateFromFile(file, "daily", secondDaily.format);
      const uids: string[] = [];
      if (date) {
        uids.push(getDateUID(date, "daily"));
      } else {
        for (const [uid, stored] of Object.entries(get(store) ?? {})) {
          if (stored.path === file.path || stored.basename === file.basename) {
            uids.push(uid);
          }
        }
      }
      if (!uids.length) return false;
      let removed = false;
      store.update((current) => {
        if (!current) return current;
        let next = current;
        for (const uid of uids) {
          const stored = current[uid];
          if (!stored) continue;
          if (stored !== file && stored.path !== file.path) continue;
          if (next === current) next = { ...current };
          delete next[uid];
          removed = true;
        }
        return next;
      });
      bumpStoreRevision();
      return removed;
    },
    removeByOldPath: (oldPath: string, file: TFile): boolean => {
      const { secondDaily } = get(settings);
      if (!secondDaily.enabled) return false;
      if (!isPathInConfiguredFolder(oldPath, secondDaily)) return false;
      const lastSlash = oldPath.lastIndexOf("/");
      const filename = lastSlash >= 0 ? oldPath.substring(lastSlash + 1) : oldPath;
      const oldBasename = filename.endsWith(".md")
        ? filename.substring(0, filename.length - 3)
        : filename;
      const date = getDateFromFilename(oldBasename, "daily", secondDaily.format);
      if (!date) return false;
      const uid = getDateUID(date, "daily");
      let removed = false;
      store.update((current) => {
        if (
          !current ||
          !current[uid] ||
          (current[uid] !== file &&
            current[uid].path !== file.path &&
            current[uid].path !== oldPath)
        ) {
          return current;
        }
        removed = true;
        const next = { ...current };
        delete next[uid];
        return next;
      });
      bumpStoreRevision();
      return removed;
    },
    ...store,
  };
}

export const secondDailyNotes = createSecondDailyNotesStore();

/**
 * Upsert one vault file into every enabled periodic-note store. Used by the
 * plugin-level vault watcher, by startup creation/open, and by file-open, so
 * a note created before a calendar view mounts is still indexed the moment it
 * is observed. Returns true if any store changed.
 */
export function syncFileToStores(file: TFile): boolean {
  const current = get(settings);
  const changed = [
    current.daily.enabled ? dailyNotes.addFile(file) : false,
    current.weekly.enabled ? weeklyNotes.addFile(file) : false,
    current.monthly.enabled ? monthlyNotes.addFile(file) : false,
    current.quarterly.enabled ? quarterlyNotes.addFile(file) : false,
    current.yearly.enabled ? yearlyNotes.addFile(file) : false,
    current.secondDaily.enabled ? secondDailyNotes.addFile(file) : false,
  ].some(Boolean);
  return changed;
}

function createSelectedFileStore() {
  const store = writable<string | null>(null);

  return {
    setFile: (file: TFile | null) => {
      const id = file ? getDateUIDFromFile(file, get(settings)) : null;
      store.set(id);
    },
    ...store,
  };
}

export const activeFile = createSelectedFileStore();

// Tracks whether the active file is a *second* daily note, so its day cell can
// show a distinct (grey) highlight. Detection is folder-aware (checks the
// configured second-daily folder + format) rather than relying on
// getDateUIDFromFile, so a second daily note is never mistaken for a primary
// daily note even when the two share a date format.
function createActiveSecondDailyStore() {
  const store = writable<string | null>(null);

  return {
    setFile: (file: TFile | null) => {
      const { secondDaily } = get(settings);
      if (!file || !secondDaily.enabled || !isFileInConfiguredFolder(file, secondDaily)) {
        store.set(null);
        return;
      }
      const date = getDateFromFile(file, "daily", secondDaily.format);
      store.set(date ? getDateUID(date, "daily") : null);
    },
    ...store,
  };
}

export const activeSecondDailyFile = createActiveSecondDailyStore();
