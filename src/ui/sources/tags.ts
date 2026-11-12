import type { Moment } from "src/types/moment";
import { parseFrontMatterTags, TFile } from "obsidian";
import type { ICalendarSource, IDayMetadata } from "src/ui/calendar-ui/types";
import { getPeriodicNote as helperGetPeriodicNote } from "src/io/periodicNoteHelpers";
import { get } from "svelte/store";

import { partition } from "src/ui/utils";

import { dailyNotes, weeklyNotes } from "../stores";

function getNoteTags(note: TFile | null): string[] {
  if (!note) {
    return [];
  }

  const { metadataCache } = window.app;
  const frontmatter = metadataCache.getFileCache(note)?.frontmatter;

  const tags: string[] = [];

  if (frontmatter) {
    const frontmatterTags = parseFrontMatterTags(frontmatter) || [];
    tags.push(...frontmatterTags);
  }

  // strip the '#' at the beginning
  return tags.map((tag) => tag.substring(1));
}

function getFormattedTagAttributes(note: TFile | null): Record<string, string> {
  const attrs: Record<string, string> = {};
  const tags = getNoteTags(note);

  const [emojiTags, nonEmojiTags] = partition(tags, (tag) =>
    /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(tag)
  );

  if (nonEmojiTags.length) {
    attrs["data-tags"] = nonEmojiTags.join(" ");
  }
  if (emojiTags.length) {
    attrs["data-emoji-tag"] = emojiTags[0];
  }

  return attrs;
}

export const customTagsSource: ICalendarSource = {
  getDailyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const file = helperGetPeriodicNote(date, "daily", get(dailyNotes) ?? {});
    return {
      dataAttributes: getFormattedTagAttributes(file),
      dots: [],
    };
  },
  getWeeklyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const file = helperGetPeriodicNote(date, "weekly", get(weeklyNotes) ?? {});
    return {
      dataAttributes: getFormattedTagAttributes(file),
      dots: [],
    };
  },
};
