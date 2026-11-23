<script lang="ts">
  import type { Moment } from "src/types/moment";
  import { Platform } from "obsidian";
  import Arrow from "./Arrow.svelte";
  import { isMetaPressed } from "../utils";
  let {
    displayedMonth,
    today,
    resetDisplayedMonth,
    incrementPeriod,
    decrementPeriod,
    viewMode = "month",
    onToggleView = undefined,
    weekStart = today,
    weekEnd = today,
    weekNum = 0,
    isCurrentWeek = false,
    quarterVisible,
    onClickMonth,
    onClickYear,
    onClickQuarter,
    // Optional Today-click callback. When provided, the Today button jumps to
    // the current month *and* invokes this with `today` so the parent can open
    // or create today's daily note via the same path day-cell clicks use.
    onClickToday = undefined,
    // Mobile-only opt-in: render the Today button in the mobile header. Off
    // by default to keep the mobile header uncrowded. Desktop always shows
    // the Today button regardless of this prop.
    showTodayButtonOnMobile = false,
    // Year overview: `showYearOverviewButton` gates whether the history button
    // renders (the persisted setting); `yearOverviewOpen` drives its active
    // styling (the transient popup state); `onToggleYearOverview` opens/closes.
    showYearOverviewButton = false,
    yearOverviewOpen = false,
    onToggleYearOverview = undefined,
  }: {
    displayedMonth: Moment;
    today: Moment;
    resetDisplayedMonth: () => void;
    incrementPeriod: () => void;
    decrementPeriod: () => void;
    viewMode?: "month" | "week";
    onToggleView?: () => void;
    weekStart?: Moment;
    weekEnd?: Moment;
    weekNum?: number;
    isCurrentWeek?: boolean;
    quarterVisible: boolean;
    onClickMonth: (date: Moment, isMetaPressed: boolean) => void;
    onClickYear: (date: Moment, isMetaPressed: boolean) => void;
    onClickQuarter: (date: Moment, isMetaPressed: boolean) => void;
    onClickToday?: (date: Moment) => void;
    showTodayButtonOnMobile?: boolean;
    showYearOverviewButton?: boolean;
    yearOverviewOpen?: boolean;
    onToggleYearOverview?: () => void;
  } = $props();
  // Get the word 'Today' but localized to the current language
  const todayDisplayStr = $derived(today.calendar().split(/\d|\s/)[0]);
  const isMobile = Platform.isMobile;

  // Function to determine the current quarter
  function getCurrentQuarter(month: number): number {
    return Math.floor(month / 3) + 1;
  }
  // Function to get the start of a quarter
  function getStartOfQuarter(year: number, quarter: number): Moment {
    const startMonth = (quarter - 1) * 3; // Calculate the starting month of the quarter
    return displayedMonth.clone().year(year).month(startMonth).startOf("month");
  }
  const currentQuarter = $derived(getCurrentQuarter(displayedMonth.month()));

  const weekTitle = $derived.by(() => {
    if (viewMode !== "week") return { range: "", year: "" };

    // A week crossing years carries both years inline; a week crossing only
    // a month boundary omits spaces around the dash to stay on one line.
    if (weekStart.year() !== weekEnd.year()) {
      return {
        range: `${weekStart.format("MMM D, YYYY")}–${weekEnd.format("MMM D, YYYY")}`,
        year: "",
      };
    }
    if (weekStart.isSame(weekEnd, "month")) {
      return {
        range: `${weekStart.format("MMM D")}–${weekEnd.format("D")}`,
        year: `, ${weekEnd.format("YYYY")}`,
      };
    }
    return {
      range: `${weekStart.format("MMM D")}–${weekEnd.format("MMM D")}`,
      year: `, ${weekEnd.format("YYYY")}`,
    };
  });
</script>

<div class="calendar-header">
  <div class="nav" class:is-mobile="{isMobile}">
    <div class="title-container">
      {#if viewMode === "week"}
        <h3 class="title week-title"><span class="month">{weekTitle.range}</span><span class="year">{weekTitle.year}</span></h3>
      {:else}
        <h3 class="title"
          ><span
            class="month"
            onclick={(event) => {
              onClickMonth(displayedMonth, isMetaPressed(event));
            }}>{displayedMonth.format("MMM")}</span
          ><span
            class="year"
            onclick={(event) => {
              onClickYear(displayedMonth, isMetaPressed(event));
            }}>{displayedMonth.format("YYYY")}</span
          ></h3
        >
      {/if}
    </div>
    <div class="right-nav">
      {#if showYearOverviewButton}
        <div
          class="year-overview-toggle"
          class:active={yearOverviewOpen}
          onclick={(e) => {
            e.stopPropagation();
            onToggleYearOverview?.();
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
            <path d="M12 7v5l4 2"></path>
          </svg>
        </div>
      {/if}
      <div class="view-toggle" role="group" aria-label="Calendar view">
        <button
          type="button"
          class:active={viewMode === "month"}
          aria-pressed={viewMode === "month"}
          title="Month view"
          onclick={() => {
            if (viewMode !== "month") onToggleView?.();
          }}>Mᴏ</button
        >
        <button
          type="button"
          class:active={viewMode === "week"}
          aria-pressed={viewMode === "week"}
          title="Week view"
          onclick={() => {
            if (viewMode !== "week") onToggleView?.();
          }}>Wᴋ</button
        >
      </div>
      <Arrow direction="left" onClick={decrementPeriod} />
      {#if !isMobile || showTodayButtonOnMobile}
        <div
          class="reset-button"
          onclick={() => {
            resetDisplayedMonth();
            onClickToday?.(today);
          }}
        >
          {todayDisplayStr}
        </div>
      {/if}
      <Arrow direction="right" onClick={incrementPeriod} />
    </div>
  </div>
  {#if viewMode === "week"}
    <div class="sub-header" class:hidden={!isCurrentWeek} aria-hidden={!isCurrentWeek}>
      <div class="week-sublabel">This Week</div>
    </div>
  {:else if quarterVisible}
    <div class="sub-header">
      <div class="quarters">
        {#each [1, 2, 3, 4] as quarter, index}
          <span
            class="quarter"
            class:active={quarter === currentQuarter}
            onclick={(event) =>
              onClickQuarter(
                getStartOfQuarter(displayedMonth.year(), quarter),
                isMetaPressed(event),
              )}>Q{quarter}</span
          >
          {#if index < 3}
            <span class="divider">•</span>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .nav {
    align-items: center;
    display: flex;
    gap: 6px;
    justify-content: space-between;
    margin: 0.6em 0 0;
    padding: 0;
    width: 100%;
  }

  .nav.is-mobile {
    /* The container supplies the 10px inset for both views. */
    padding: 0;
  }

  .title-container {
    align-items: center;
    display: flex;
    min-width: 0;
  }

  .sub-header {
    margin: 2px 0 8px;
  }

  .sub-header.hidden {
    display: none;
  }

  .title {
    color: var(--color-text-title);
    flex-shrink: 0;
    font-size: 1.5em;
    line-height: 1.2;
    margin: 0;
    white-space: nowrap;
  }

  .title.week-title {
    font-size: 1.05rem;
    white-space: nowrap;
  }

  .is-mobile .title {
    font-size: 1.3em;
  }

  .is-mobile .title.week-title {
    font-size: 1.05rem;
  }

  .month {
    font-weight: 500;
    text-transform: capitalize;
    cursor: pointer;
  }

  .year {
    color: var(--interactive-accent);
    cursor: pointer;
  }

  .quarters {
    display: flex;
    align-items: center;
    margin-top: 0;
    /* 2px optical nudge to the right — sits the cluster just inside the
       month title's left edge instead of perfectly flush, which reads
       better at this font size. Not restoring the old per-item margins
       or container padding (those caused the larger 6px indent). */
    margin-left: 2px;
    /* gap replaces per-item horizontal margins + the container's side
       padding. The previous setup gave Q1 a 4px margin-left plus 2px of
       container padding-left, leaving the row visually indented relative
       to the month title (which has margin: 0). Using gap puts the first
       child flush at the container's left edge while preserving the same
       6px spacing between adjacent items (was 4px quarter-margin + 2px
       divider-margin = 6px between each quarter and its divider). */
    gap: 6px;
  }

  .quarter {
    font-size: 0.6em;
    color: var(--text-muted);
    cursor: pointer;
  }

  .quarter.active {
    color: var(--interactive-accent);
    font-weight: bold;
    /* Background / pill defenses against theme overrides (e.g. Minimal)
       live in styles.css with a `#calendar-container` ID prefix — Svelte's
       component-scoped specificity (0,4,0) isn't enough to beat a theme
       targeting generic `.active` with higher specificity. */
  }

  .divider {
    font-size: 0.4em;
    color: var(--text-muted);
  }

  .right-nav {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    justify-content: flex-end;
    margin-left: 0;
  }

  .reset-button {
    align-items: center;
    display: inline-flex;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.7em;
    font-weight: 600;
    letter-spacing: 1px;
    margin: 0 2px;
    padding: 0 2px;
    text-transform: uppercase;
  }

  .reset-button:hover {
    opacity: 0.7;
  }

  .week-sublabel {
    color: var(--text-muted);
    cursor: default;
    font-size: 0.7em;
    margin: 0;
    padding-left: 2px;
  }

  .view-toggle {
    align-items: center;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    display: inline-flex;
    gap: 1px;
    margin-right: 2px;
    padding: 2px;
  }

  .view-toggle button {
    background: transparent;
    border: 0;
    border-radius: 999px;
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 10px;
    font-weight: 600;
    height: auto;
    line-height: 1.3;
    min-height: 0;
    padding: 1px 7px;
  }

  .view-toggle button:hover {
    color: var(--text-normal);
  }

  .view-toggle button.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    margin: 0;
  }

  .year-overview-toggle {
    align-items: center;
    cursor: pointer;
    display: flex;
    justify-content: center;
    width: 24px;
  }

  .year-overview-toggle:hover {
    opacity: 0.7;
  }

  .is-mobile .year-overview-toggle {
    width: 32px;
  }

  /* Light grey when off, brightening to the normal (white-ish) text color
     when the panel is open, so the icon's state is legible without color. */
  .year-overview-toggle svg {
    color: var(--text-muted);
    height: 15px;
    width: 15px;
  }

  .year-overview-toggle.active svg {
    color: var(--text-normal);
  }
</style>
