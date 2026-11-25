import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";

import { VIEW_TYPE_CALENDAR } from "./constants";
import {
  getDateFromFile as helperGetDateFromFile,
  getPeriodicNote as helperGetPeriodicNote,
  getPeriodicNotePath,
} from "./io/periodicNoteHelpers";
import { createPeriodicNote } from "./io/periodicNotes";
import { initThumbnailCache, teardownThumbnailCache } from "./io/thumbnailCache";
import { configureGlobalMomentLocale } from "./ui/calendar-ui/localization";
import {
  activeFile,
  bumpStoreRevision,
  dailyNotes,
  monthlyNotes,
  quarterlyNotes,
  secondDailyNotes,
  settings,
  syncFileToStores,
  weeklyNotes,
  yearlyNotes,
} from "./ui/stores";
import { CalendarSettingsTab, DEFAULT_WEEKEND_COLOR } from "./settings";
import type { ISettings, Periodicity } from "./settings";
import { moment } from "./types/moment";
import type { Moment, WeekSpec } from "./types/moment";
import CalendarView from "./view";

type AutoCreateResult = {
  created: string[];
  indexed: string[];
  errors: string[];
  skipped: boolean;
};

declare global {
  interface Window {
    app: App;
    _bundledLocaleWeekSpec: WeekSpec;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `patch` onto `base`, returning a new object. Plain-object
 * values merge key-by-key at any depth; everything else (primitives, arrays) is
 * replaced wholesale by the patch value, and a patch value of `undefined` is
 * ignored (keeps base).
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : (patch as T);
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;
    result[key] = deepMerge(result[key], patchValue);
  }
  return result as T;
}

const WEEKEND_VARS = [
  "--cc-weekend-saturation",
  "--cc-weekend-brightness",
  "--cc-weekend-opacity",
  "--cc-weekend-custom-color",
] as const;
const WEEKEND_CUSTOM_CLASS = "cc-weekend-use-custom-color";

/**
 * Push the weekend tint settings into CSS variables on <body>; styles.css
 * reads them. Runs on every settings change, so slider moves apply live.
 */
function applyWeekendColor(options: ISettings): void {
  const wc = { ...DEFAULT_WEEKEND_COLOR, ...(options.weekendColor ?? {}) };
  const style = document.body.style;
  style.setProperty("--cc-weekend-saturation", String(wc.saturation));
  style.setProperty("--cc-weekend-brightness", String(wc.brightness));
  style.setProperty("--cc-weekend-opacity", String(wc.opacity));
  style.setProperty("--cc-weekend-custom-color", wc.customColor);
  document.body.toggleClass(WEEKEND_CUSTOM_CLASS, wc.useCustomColor);
}

function clearWeekendColor(): void {
  for (const name of WEEKEND_VARS) document.body.style.removeProperty(name);
  document.body.removeClass(WEEKEND_CUSTOM_CLASS);
}

const PERIODIC_STORES = {
  daily: dailyNotes,
  weekly: weeklyNotes,
  monthly: monthlyNotes,
  quarterly: quarterlyNotes,
  yearly: yearlyNotes,
} as const;

function getPeriodTargetDate(now: Moment, periodicity: Periodicity): Moment {
  switch (periodicity) {
    case "daily":
      return now.clone().startOf("day");
    case "weekly":
      return now.clone().startOf("week");
    case "monthly":
      return now.clone().startOf("month");
    case "quarterly":
      return now.clone().startOf("quarter");
    case "yearly":
      return now.clone().startOf("year");
  }
}

export default class CalendarPlugin extends Plugin {
  public options!: ISettings;
  private autoCreateInFlight = false;

  async onload(): Promise<void> {
    if (this.manifest.dir) {
      initThumbnailCache(
        this.app,
        normalizePath(`${this.manifest.dir}/thumbnail-cache`)
      );
    }

    this.register(
      settings.subscribe((value) => {
        this.options = value;
        applyWeekendColor(value);
      })
    );

    // Load saved options BEFORE registering the view so any restored CalendarView
    // mounts with the user's real folders/formats rather than defaultSettings.
    await this.loadOptions();

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf: WorkspaceLeaf) => new CalendarView(leaf, this)
    );

    // Watch vault mutations at the PLUGIN level (not only inside the calendar
    // view). The old design registered these in CalendarView's constructor, so
    // notes created automatically (midnight rollover, daily-note-automater,
    // core Daily Notes, sync) could be missed when no calendar leaf was open,
    // or dropped by the view's `layoutReady` guard — leaving the day's dot
    // missing until a reload reindexed everything. Store updates are cheap and
    // idempotent (keyed by date UID); the Svelte wrapper re-renders cells via
    // `storeRevision`, and `refreshAllCalendarViews` ticks any open views.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        const changed = [
          dailyNotes.addFile(file),
          weeklyNotes.addFile(file),
          monthlyNotes.addFile(file),
          quarterlyNotes.addFile(file),
          yearlyNotes.addFile(file),
          secondDailyNotes.addFile(file),
        ].some(Boolean);
        if (changed) {
          this.refreshAllCalendarViews();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        const changed = [
          dailyNotes.removeFile(file),
          weeklyNotes.removeFile(file),
          monthlyNotes.removeFile(file),
          quarterlyNotes.removeFile(file),
          yearlyNotes.removeFile(file),
          secondDailyNotes.removeFile(file),
        ].some(Boolean);
        if (changed) {
          this.refreshAllCalendarViews();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const removed = [
          dailyNotes.removeByOldPath(oldPath, file),
          weeklyNotes.removeByOldPath(oldPath, file),
          monthlyNotes.removeByOldPath(oldPath, file),
          quarterlyNotes.removeByOldPath(oldPath, file),
          yearlyNotes.removeByOldPath(oldPath, file),
          secondDailyNotes.removeByOldPath(oldPath, file),
        ].some(Boolean);
        const added = [
          dailyNotes.addFile(file),
          weeklyNotes.addFile(file),
          monthlyNotes.addFile(file),
          quarterlyNotes.addFile(file),
          yearlyNotes.addFile(file),
          secondDailyNotes.addFile(file),
        ].some(Boolean);
        if (removed || added) {
          this.refreshAllCalendarViews();
        }
      })
    );

    // A full resolve pass is rare (startup / bulk index). Tag and featured
    // image sources read metadataCache directly, so a view tick is enough;
    // per-file changes are handled by the `changed` listener below.
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.refreshAllCalendarViews();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!(file instanceof TFile)) return;
        const matchedDaily =
          this.options.daily.enabled &&
          helperGetDateFromFile(file, "daily", this.options.daily.format);
        const matchedWeekly =
          this.options.weekly.enabled &&
          helperGetDateFromFile(file, "weekly", this.options.weekly.format);
        if (!matchedDaily && !matchedWeekly) return;
        if (syncFileToStores(file)) {
          bumpStoreRevision();
          this.refreshAllCalendarViews();
        }
      })
    );

    this.addRibbonIcon("calendar-days", "Open Cadence Calendar", () => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
      if (leaves.length) {
        void this.app.workspace.revealLeaf(leaves[0]);
      } else {
        this.initLeaf();
      }
    });

    this.addCommand({
      id: "show-calendar-view",
      name: "Open view",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return (
            this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
          );
        }
        this.initLeaf();
      },
    });

    this.addCommand({
      id: "open-weekly-note",
      name: "Open Weekly Note",
      checkCallback: (checking) => {
        if (checking) {
          return this.options.weekly.enabled;
        }
        void this.ensureCalendarView().then((view) => {
          void view?.openOrCreateWeeklyNote(moment(), false);
        });
      },
    });

    this.addCommand({
      id: "reveal-active-note",
      name: "Reveal active note",
      callback: () => {
        this.getCalendarView()?.revealActiveNote();
      },
    });

    this.addCommand({
      id: "ensure-auto-created-notes",
      name: "Create missing notes",
      callback: () => {
        void this.ensureAutoCreatedNotes(true);
      },
    });

    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      this.initLeaf();
      // One initial full scan; creation/open paths sync their own files via
      // vault events and syncFileToStores(), so no extra full rescans here.
      this.reindexAllStores();
      await this.ensureAutoCreatedNotes();
      // Must run AFTER auto-create so a note created at startup exists before opening.
      await this.openDailyNoteOnStartup();
      this.refreshAllCalendarViews();
    });
  }

  onunload(): void {
    teardownThumbnailCache();
    clearWeekendColor();
  }

  private reindexAllStores(): void {
    configureGlobalMomentLocale(this.options.localeOverride, this.options.weekStart);
    dailyNotes.reindex();
    weeklyNotes.reindex();
    monthlyNotes.reindex();
    quarterlyNotes.reindex();
    yearlyNotes.reindex();
    secondDailyNotes.reindex();
  }

  public async ensureAutoCreatedNotes(
    notify = false
  ): Promise<AutoCreateResult> {
    if (!this.app.workspace.layoutReady || this.autoCreateInFlight) {
      return { created: [], indexed: [], errors: [], skipped: true };
    }
    this.autoCreateInFlight = true;
    const created: string[] = [];
    const indexed: string[] = [];
    const errors: string[] = [];
    try {
      configureGlobalMomentLocale(
        this.options.localeOverride,
        this.options.weekStart
      );
      const now = moment();
      const periodicities: Periodicity[] = [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ];
      let anyChanged = false;

      for (const periodicity of periodicities) {
        const perPeriod = this.options[periodicity];
        if (!perPeriod.enabled || !perPeriod.autoCreate) continue;

        const store = PERIODIC_STORES[periodicity];
        const targetDate = getPeriodTargetDate(now, periodicity);
        const existingInStore = helperGetPeriodicNote(
          targetDate,
          periodicity,
          get(store) ?? {}
        );
        if (existingInStore) continue;

        // Also check the vault directly in case the note already exists on disk
        // (e.g. created by another plugin during startup before reindex).
        const expectedPath = getPeriodicNotePath(perPeriod, targetDate);
        const existingOnDisk = this.app.vault.getAbstractFileByPath(expectedPath);
        if (existingOnDisk instanceof TFile) {
          if (store.addFile(existingOnDisk)) {
            anyChanged = true;
            indexed.push(`${periodicity}: ${existingOnDisk.basename}`);
          }
          continue;
        }

        try {
          const createdFile = await createPeriodicNote(
            periodicity,
            targetDate,
            perPeriod
          );
          store.addFile(createdFile);
          anyChanged = true;
          created.push(`${periodicity}: ${createdFile.basename}`);
        } catch (err) {
          errors.push(periodicity);
          console.error(
            `[Cadence Calendar] Failed to auto-create ${periodicity} note`,
            err
          );
        }
      }

      if (anyChanged) {
        this.reindexAllStores();
        this.refreshAllCalendarViews();
      }

      if (notify) {
        const parts: string[] = [];
        if (created.length) parts.push(`Created ${created.join(", ")}`);
        if (indexed.length) parts.push(`Indexed ${indexed.join(", ")}`);
        if (errors.length) parts.push(`Failed: ${errors.join(", ")}`);
        if (!parts.length) parts.push("All current notes are up to date");
        new Notice(`Cadence Calendar — ${parts.join("; ")}`, errors.length ? 8000 : 4000);
      }

      return { created, indexed, errors, skipped: false };
    } finally {
      this.autoCreateInFlight = false;
    }
  }

  /**
   * Open today's daily note on startup. Runs after ensureAutoCreatedNotes().
   * Never creates a note itself: if auto-create is off and the note is missing,
   * it simply reports that and leaves the vault untouched.
   */
  private async openDailyNoteOnStartup(): Promise<void> {
    if (!this.options.openDailyNoteOnStartup || !this.options.daily.enabled) return;

    configureGlobalMomentLocale(
      this.options.localeOverride,
      this.options.weekStart
    );
    const perPeriod = this.options.daily;
    const targetDate = getPeriodTargetDate(moment(), "daily");
    let file: TFile | null = helperGetPeriodicNote(
      targetDate,
      "daily",
      get(dailyNotes) ?? {}
    );

    if (!file) {
      const expectedPath = getPeriodicNotePath(perPeriod, targetDate);
      const existingOnDisk = this.app.vault.getAbstractFileByPath(expectedPath);
      if (existingOnDisk instanceof TFile) {
        file = existingOnDisk;
        dailyNotes.addFile(existingOnDisk);
      } else if (!perPeriod.autoCreate) {
        new Notice(
          "Cadence Calendar — today's daily note does not exist and auto-create is off; nothing was created.",
          6000
        );
        return;
      } else {
        try {
          file = await createPeriodicNote("daily", targetDate, perPeriod);
          dailyNotes.addFile(file);
        } catch (err) {
          console.error(
            "[Cadence Calendar] Failed to create daily note for startup open",
            err
          );
          return;
        }
      }
    }

    // The file may have been created/opened by this helper; make sure the
    // note store and calendar are synced before returning.
    this.reindexAllStores();
    this.refreshAllCalendarViews();

    if (this.app.workspace.getActiveFile()?.path === file.path) {
      activeFile.setFile(file);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    activeFile.setFile(file);
  }

  private refreshAllCalendarViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)) {
      if (leaf.view instanceof CalendarView) {
        leaf.view.refreshAfterStoreSync();
      }
    }
  }

  initLeaf(): void {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length) {
      return;
    }
    const right = this.app.workspace.getRightLeaf(false);
    if (!right) return;
    void right.setViewState({
      type: VIEW_TYPE_CALENDAR,
    });
  }

  private getCalendarView(): CalendarView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
    if (!leaf) return null;
    return leaf.view instanceof CalendarView ? leaf.view : null;
  }

  private async ensureCalendarView(): Promise<CalendarView | null> {
    const existing = this.getCalendarView();
    if (existing) return existing;
    const right = this.app.workspace.getRightLeaf(false);
    if (!right) return null;
    await right.setViewState({ type: VIEW_TYPE_CALENDAR });
    return this.getCalendarView();
  }

  async loadOptions(): Promise<void> {
    const saved: unknown = (await this.loadData()) ?? {};
    settings.update((defaults) => deepMerge(defaults, saved));

    // Migrate the old single "viewMode" setting: it used to serve as both the
    // startup view and the last active view. New installs use the explicit
    // defaultViewMode / lastViewMode pair.
    const savedRecord =
      saved && typeof saved === "object"
        ? (saved as Record<string, unknown>)
        : {};
    const legacyViewMode = savedRecord.viewMode;
    if (
      savedRecord.defaultViewMode === undefined &&
      (legacyViewMode === "month" || legacyViewMode === "week")
    ) {
      settings.update((current) =>
        deepMerge(current, {
          defaultViewMode: legacyViewMode,
          lastViewMode: legacyViewMode,
        })
      );
    }

    await this.saveData(this.options);
  }

  async writeOptions(
    changeOpts: (settings: ISettings) => Partial<ISettings>
  ): Promise<void> {
    settings.update((old) => deepMerge(old, changeOpts(old)));
    await this.saveData(this.options);
  }
}
