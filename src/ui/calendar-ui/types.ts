import type { Moment } from "src/types/moment";

export interface IDot {
  className?: string;
  isFilled: boolean;
}

export interface IDayMetadata {
  classes?: string[];
  dataAttributes?: Record<string, string>;
  dots?: IDot[];
  /** `app://` resource URL from vault.getResourcePath, or undefined for no image. */
  backgroundImage?: string;
}

export interface ICalendarSource {
  /** `revision` is an explicit reactive dependency for store-backed sources. */
  getDailyMetadata?: (date: Moment, revision?: number) => Promise<IDayMetadata>;
  getWeeklyMetadata?: (date: Moment, revision?: number) => Promise<IDayMetadata>;
}

export interface IWeek {
  days: Moment[];
  weekNum: number;
}

export type IMonth = IWeek[];
