import { Plugin, TFile, normalizePath } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";

import { VIEW_TYPE_CALENDAR } from "./constants";
import {
  getPeriodicNote as helperGetPeriodicNote,
  getPeriodicNotePath,
} from "./io/periodicNoteHelpers";
import { createPeriodicNote } from "./io/periodicNotes";
import { initThumbnailCache, teardownThumbnailCache } from "./io/thumbnailCache";
import { configureGlobalMomentLocale } from "./ui/calendar-ui/localization";
import {
  activeFile,
  dailyNotes,
  monthlyNotes,
  quarterlyNotes,
  secondDailyNotes,
  settings,
  weeklyNotes,
  yearlyNotes,
} from "./ui/stores";
import { CalendarSettingsTab, DEFAULT_WEEKEND_COLOR } from "./settings";
import type { ISettings, Periodicity } from "./settings";
import { moment } from "./types/moment";
import type { Moment, WeekSpec } from "./types/moment";
import CalendarView from "./view";

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
      name: "Create missing current periodic notes now",
      callback: () => {
        void this.ensureAutoCreatedNotes();
      },
    });

    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      this.initLeaf();
      this.reindexAllStores();
      await this.ensureAutoCreatedNotes();
      this.refreshAllCalendarViews();
    });

    // Check once a minute so period rollovers (midnight, new week/month/quarter/year)
    // automatically create the new note when autoCreate is enabled.
    this.registerInterval(
      window.setInterval(() => {
        if (this.app.workspace.layoutReady) {
          void this.ensureAutoCreatedNotes();
        }
      }, 60 * 1000)
    );
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

  public async ensureAutoCreatedNotes(): Promise<void> {
    if (!this.app.workspace.layoutReady || this.autoCreateInFlight) return;
    this.autoCreateInFlight = true;
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

          if (perPeriod.openOnAutoCreate) {
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(createdFile, { active: true });
            activeFile.setFile(createdFile);
          }
        } catch (err) {
          console.error(
            `[Cadence Calendar] Failed to auto-create ${periodicity} note`,
            err
          );
        }
      }

      if (anyChanged) {
        this.refreshAllCalendarViews();
      }
    } finally {
      this.autoCreateInFlight = false;
    }
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

    await this.saveData(this.options);
  }

  async writeOptions(
    changeOpts: (settings: ISettings) => Partial<ISettings>
  ): Promise<void> {
    settings.update((old) => deepMerge(old, changeOpts(old)));
    await this.saveData(this.options);
  }
}
