<script lang="ts">
  import type { Moment } from "src/types/moment";
  import { getDateUID } from "src/io/periodicNoteHelpers";

  import type { IDayMetadata } from "../types";
  import { syncDotsDom, type RenderedDot } from "../renderDots";
  import { isMetaPressed, isWeekend } from "../utils";

  let {
    // Properties
    date,
    metadata,
    onHover,
    onClick,
    onContextMenu,
    // Global state
    today,
    displayedMonth = null,
    selectedId = null,
    selectedSecondDailyId = null,
    weekendDays = [0, 6],
  }: {
    date: Moment;
    metadata: Promise<IDayMetadata> | null;
    onHover: (date: Moment, targetEl: EventTarget, isMetaPressed: boolean) => void;
    onClick: (date: Moment, event: MouseEvent) => void;
    onContextMenu: (date: Moment, event: MouseEvent) => void;
    today: Moment;
    displayedMonth?: Moment | null;
    selectedId?: string | null;
    selectedSecondDailyId?: string | null;
    weekendDays?: number[];
  } = $props();

  const isWeekendDay = $derived(isWeekend(date, weekendDays));
  const dailyUid = $derived(getDateUID(date, "daily"));
  const isSecondDailyActive = $derived(selectedSecondDailyId === dailyUid);
  const isToday = $derived(date.isSame(today, "day"));

  // Flat, independent state avoids the Svelte 5 snippet/proxy boundary that
  // let `.dot-container` go stale while `has-note` updated.
  let resolvedClasses = $state<string[]>([]);
  let resolvedDots = $state<RenderedDot[]>([]);
  let resolvedDataAttrs = $state<Record<string, string>>({});
  let resolvedBgImage = $state<string | null>(null);

  let dotContainerEl: HTMLDivElement | null = null;

  function clearResolved(): void {
    resolvedClasses = [];
    resolvedDots = [];
    resolvedDataAttrs = {};
    resolvedBgImage = null;
    syncDotsDom(dotContainerEl, []);
  }

  // Direct DOM ownership: no Svelte `{#each}` reconciler in .dot-container.
  $effect(() => {
    syncDotsDom(dotContainerEl, resolvedDots);
  });

  $effect(() => {
    const pending = metadata;
    if (!pending) {
      clearResolved();
      return;
    }

    let cancelled = false;
    void pending
      .then((meta) => {
        if (cancelled) return;
        resolvedClasses = [...(meta.classes ?? [])];
        resolvedDots = (meta.dots ?? []).map((dot) => ({
          className: dot.className ?? "",
          isFilled: !!dot.isFilled,
        }));
        resolvedDataAttrs = { ...(meta.dataAttributes ?? {}) };
        resolvedBgImage = meta.backgroundImage ?? null;
        syncDotsDom(dotContainerEl, resolvedDots);
      })
      .catch((err: unknown) => {
        console.warn("[Cadence Calendar] day metadata rejected", err);
        if (!cancelled) clearResolved();
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<td class:weekend={isWeekendDay}>
  <div
    class={`day ${resolvedClasses.join(" ")}`}
    class:active={selectedId === dailyUid && !isSecondDailyActive}
    class:second-daily-active={isSecondDailyActive}
    class:adjacent-month={displayedMonth && !date.isSame(displayedMonth, "month")}
    class:today={isToday}
    class:has-background-image={!!resolvedBgImage}
    style={resolvedBgImage ? `background-image: url("${resolvedBgImage}")` : ""}
    onclick={onClick && ((e) => onClick(date, e))}
    oncontextmenu={onContextMenu && ((e) => onContextMenu(date, e))}
    onpointerover={onHover &&
      ((e) => onHover(date, e.currentTarget, isMetaPressed(e)))}
    {...resolvedDataAttrs}
  >
    <div
      class="day-highlight"
      data-emoji-tag={resolvedDataAttrs["data-emoji-tag"] ?? undefined}
    >
      <span class="day-number">{date.format("D")}</span>
      <div class="dot-container" bind:this={dotContainerEl}></div>
    </div>
  </div>
</td>

<style>
  .day {
    background-color: var(--color-background-day);
    border-radius: 4px;
    color: var(--color-text-day);
    cursor: pointer;
    font-size: 0.8em;
    height: 100%;
    /* isolation: isolate creates a stacking context so ::before/::after
       z-index values are resolved within .day, not the document root.
       This lets z-index: 0 overlays sit above the background image but
       below z-index: 1 text and dots. */
    isolation: isolate;
    padding: 4px;
    position: relative;
    text-align: center;
    transition: background-color 0.1s ease-in, color 0.1s ease-in;
    vertical-align: baseline;
  }
  /* Snug box that carries the today/selected highlight. The outer .day and
     td stay full-size and clickable, so cell hit areas and weekend shading
     do not change. */
  .day-highlight {
    align-items: center;
    border: 1px solid transparent;
    border-radius: 6px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    margin: 0 auto;
    min-height: 34px;
    position: relative;
    width: 32px;
  }

  .day:hover {
    background-color: var(--interactive-hover);
  }

  .day.active:hover {
    background-color: var(--interactive-accent-hover);
  }

  .adjacent-month {
    opacity: 0.25;
  }

  .today {
    color: var(--color-text-today);
  }

  .day:active,
  .day.active,
  .day.active.today {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
  }

  /* A secondary daily note is indicated by its dot only. The cell itself
     keeps its normal background so it cannot alter Today's compact highlight
     or the weekend column tint. */
  .day.second-daily-active.today {
    color: var(--color-text-day);
  }

  /* Featured image support ------------------------------------------------ */

  .day.has-background-image {
    background-size: cover;
    background-position: center;
    overflow: hidden;
  }

  /* Readability overlay: a dark gradient in front of the image so the date
     number and dots are visible regardless of photo content. Kept heavy on
     purpose — the goal is an at-a-glance "this day has an image" cue, not to
     show photo detail. z-index: 0 sits above the background image but below
     .day-number / .dot-container (z-index: 1 within the isolation context). */
  .day.has-background-image::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 4px;
    background: linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.35));
    pointer-events: none;
    transition: background 0.1s ease-in;
    z-index: 0;
  }

  /* Hover over an image cell: the base `.day:hover` background-color is hidden
     behind the photo, so instead lighten the ::before overlay (the photo
     appears to brighten). Keeping background-color stable (transparent) avoids
     a repaint that re-composites the image on every hover — that was the
     source of hover lag on image-heavy vaults. */
  .day.has-background-image:hover,
  .day.has-background-image.active:hover {
    background-color: transparent;
  }

  .day.has-background-image:hover::before {
    background: linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.1));
  }

  /* Active state over an image: suppress the solid accent background and
     use a translucent accent overlay instead so the photo stays visible
     underneath while the cell still reads as selected. */
  .day.has-background-image.active,
  .day.has-background-image.active.today,
  .day.has-background-image:active {
    background-color: transparent;
  }

  .day.has-background-image.active::after,
  .day.has-background-image.active.today::after,
  .day.has-background-image:active::after {
    content: '';
    position: absolute;
    inset: 0;
    background-color: var(--interactive-accent);
    border-radius: 4px;
    opacity: 0.65;
    pointer-events: none;
    z-index: 0;
  }

  /* The number is wrapped in a span purely for z-index: it must sit above
     both overlays within the isolation stacking context. No visual styling
     here — color, weight, and the today/active rules all come from the
     existing .day / .today / .day.active.today rules and inherit through the
     span, so the number looks identical whether or not the cell has an image. */
  .day-number {
    position: relative;
    z-index: 1;
  }

  .dot-container {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    line-height: 6px;
    min-height: 6px;
    position: relative;
    z-index: 1;
  }

  .dot-container :global(.dot),
  .dot-container :global(.hollow) {
    display: inline-block;
    height: 6px;
    width: 6px;
    margin: 0 1px;
  }

  .dot-container :global(.filled) {
    fill: var(--color-dot);
  }

  .dot-container :global(.hollow) {
    fill: none;
    stroke: var(--color-dot);
  }
</style>
