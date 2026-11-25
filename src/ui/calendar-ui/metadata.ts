import type { Moment } from "src/types/moment";

import type { ICalendarSource, IDayMetadata } from "./types";

async function metadataReducer(
  promisedMetadata: Promise<IDayMetadata>[]
): Promise<IDayMetadata> {
  const initial: IDayMetadata = {
    dots: [],
    classes: [],
    dataAttributes: {},
  };
  // A single source that rejects (e.g. a failed cachedRead) must not reject the
  // whole cell's metadata — that would leave the cell's rendered state stale
  // and log an unhandled rejection.
  // Treat a failed source as contributing nothing.
  const metas = await Promise.all(
    promisedMetadata.map((p) =>
      p.catch(
        (): IDayMetadata => ({ dots: [], classes: [], dataAttributes: {} })
      )
    )
  );
  return metas.reduce<IDayMetadata>(
    (acc, meta) => ({
      classes: [...(acc.classes ?? []), ...(meta.classes ?? [])],
      dataAttributes: {
        ...(acc.dataAttributes ?? {}),
        ...(meta.dataAttributes ?? {}),
      },
      dots: [...(acc.dots ?? []), ...(meta.dots ?? [])],
      // First source that provides a backgroundImage wins; later sources don't override.
      backgroundImage: acc.backgroundImage ?? meta.backgroundImage,
    }),
    initial
  );
}

// One bad source must never delay the primary dot. Sources read metadataCache
// and vault files directly; a brand-new note can be uncached for a moment, and
// a transient read error must not reject the whole cell's metadata promise.
function callSource(
  source: ICalendarSource,
  kind: "daily" | "weekly",
  date: Moment,
  revision: number
): Promise<IDayMetadata> {
  try {
    const result =
      kind === "daily"
        ? source.getDailyMetadata?.(date, revision)
        : source.getWeeklyMetadata?.(date, revision);
    return Promise.resolve(result ?? {}).catch((err: unknown) => {
      console.warn("[Cadence Calendar] source failed", kind, date.format(), err);
      return {};
    });
  } catch (err) {
    console.warn("[Cadence Calendar] source failed", kind, date.format(), err);
    return Promise.resolve({});
  }
}

export function getDailyMetadata(
  sources: ICalendarSource[],
  date: Moment,
  revision = 0
): Promise<IDayMetadata> {
  return metadataReducer(
    sources.map((source) => callSource(source, "daily", date, revision))
  );
}

export function getWeeklyMetadata(
  sources: ICalendarSource[],
  date: Moment,
  revision = 0
): Promise<IDayMetadata> {
  return metadataReducer(
    sources.map((source) => callSource(source, "weekly", date, revision))
  );
}
