/**
 * Natural Language Task Date Parser
 *
 * Parses natural language date and time expressions from task titles
 * (e.g., "assignment due this friday", "call doctor tomorrow at 3pm", "pay bills in 3 days")
 * and extracts structured due dates in Markdown task format (📅 YYYY-MM-DD).
 */

export interface ParsedTaskDate {
  dueDate: Date | null;
  formattedDate: string | null; // e.g. "2026-09-04" or "2026-09-04 15:00"
  cleanText: string;
  matchedPhrase: string | null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tuesday_: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function formatDateISO(date: Date, includeTime = false): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  if (!includeTime) return `${yyyy}-${mm}-${dd}`;

  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Parse natural language date & time from a task string.
 */
export function parseTaskDate(text: string, referenceDate: Date = new Date()): ParsedTaskDate {
  if (!text || typeof text !== "string") {
    return { dueDate: null, formattedDate: null, cleanText: text || "", matchedPhrase: null };
  }

  // Check if a Markdown due date emoji format already exists (📅 YYYY-MM-DD)
  if (/📅\s*\d{4}-\d{2}-\d{2}/.test(text)) {
    return { dueDate: null, formattedDate: null, cleanText: text, matchedPhrase: null };
  }

  let matchedPhrase: string | null = null;
  let targetDate: Date | null = null;
  let hasTime = false;

  const now = new Date(referenceDate);

  // Helper to extract time if present (e.g., "at 3pm", "at 10:30am", "at 15:00", "3pm")
  const extractTime = (str: string): { hours: number; minutes: number; timeStr: string } | null => {
    const timeRegex = /(?:at\s+)?\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(am|pm)\b|(?:at\s+)\b([0-1]?[0-9]|2[0-3]):([0-5][0-9])\b/i;
    const match = str.match(timeRegex);
    if (!match) return null;

    const timeStr = match[0];
    let hours = 0;
    let minutes = 0;

    if (match[1] !== undefined) {
      // 12-hour AM/PM
      hours = parseInt(match[1], 10);
      minutes = match[2] ? parseInt(match[2], 10) : 0;
      const ampm = match[3].toLowerCase();
      if (ampm === "pm" && hours < 12) hours += 12;
      if (ampm === "am" && hours === 12) hours = 0;
    } else if (match[4] !== undefined) {
      // 24-hour time
      hours = parseInt(match[4], 10);
      minutes = parseInt(match[5], 10);
    }

    return { hours, minutes, timeStr };
  };

  // 1. Relative Days & Quick Keywords: today, tomorrow, yesterday, this weekend, next weekend, end of week
  const relativeMatch = text.match(/\b(?:due\s+)?(?:on\s+)?(today|tomorrow|yesterday|this\s+weekend|next\s+weekend|end\s+of\s+week|end\s+of\s+month)\b/i);
  if (relativeMatch) {
    matchedPhrase = relativeMatch[0];
    const kw = relativeMatch[1].toLowerCase().replace(/\s+/g, " ");
    targetDate = new Date(now);
    if (kw === "tomorrow") targetDate.setDate(now.getDate() + 1);
    else if (kw === "yesterday") targetDate.setDate(now.getDate() - 1);
    else if (kw === "this weekend" || kw === "next weekend") {
      let daysUntilSat = (6 - now.getDay() + 7) % 7;
      if (daysUntilSat === 0) daysUntilSat = 7;
      if (kw === "next weekend") daysUntilSat += 7;
      targetDate.setDate(now.getDate() + daysUntilSat);
    } else if (kw === "end of week") {
      let daysUntilFri = (5 - now.getDay() + 7) % 7;
      if (daysUntilFri === 0) daysUntilFri = 7;
      targetDate.setDate(now.getDate() + daysUntilFri);
    } else if (kw === "end of month") {
      targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
  }

  // 2. Relative offsets: "in X days", "in X weeks", "in X months", "in a week"
  if (!targetDate) {
    const offsetMatch = text.match(/\b(?:due\s+)?in\s+(\d+|a|an)\s+(day|days|week|weeks|month|months)\b/i);
    if (offsetMatch) {
      matchedPhrase = offsetMatch[0];
      const qtyStr = offsetMatch[1].toLowerCase();
      const qty = (qtyStr === "a" || qtyStr === "an") ? 1 : parseInt(qtyStr, 10);
      const unit = offsetMatch[2].toLowerCase();
      targetDate = new Date(now);
      if (unit.startsWith("day")) {
        targetDate.setDate(now.getDate() + qty);
      } else if (unit.startsWith("week")) {
        targetDate.setDate(now.getDate() + qty * 7);
      } else if (unit.startsWith("month")) {
        targetDate.setMonth(now.getMonth() + qty);
      }
    }
  }

  // 3. Days of the week: "this friday", "next monday", "coming tuesday", "by friday", "on friday", "friday"
  if (!targetDate) {
    const dayOfWeekRegex = /\b(?:due\s+)?(?:by\s+|on\s+)?(?:(this|next|coming)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;
    const dayMatch = text.match(dayOfWeekRegex);
    if (dayMatch) {
      const modifier = (dayMatch[1] || "").toLowerCase();
      const dayName = dayMatch[2].toLowerCase();
      const targetDay = DAY_NAMES[dayName];

      if (targetDay !== undefined) {
        matchedPhrase = dayMatch[0];
        targetDate = new Date(now);
        let currentDay = now.getDay();
        let daysToAdd = (targetDay - currentDay + 7) % 7;

        if (daysToAdd === 0) {
          daysToAdd = 7; // Same day next week if today is that day
        }

        targetDate.setDate(now.getDate() + daysToAdd);
      }
    }
  }

  // 4. Specific Month and Day: "Oct 15", "15th October", "October 15th", "15 Oct 2026"
  if (!targetDate) {
    const monthDayRegex = /\b(?:due\s+)?(?:by\s+|on\s+)?(?:(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s*,?\s*(\d{4}))?)\b/i;
    const mdMatch = text.match(monthDayRegex);
    if (mdMatch) {
      matchedPhrase = mdMatch[0];
      let monthName = "";
      let dayNum = 0;
      let yearNum = now.getFullYear();

      if (mdMatch[1]) {
        monthName = mdMatch[1].toLowerCase();
        dayNum = parseInt(mdMatch[2], 10);
        if (mdMatch[3]) yearNum = parseInt(mdMatch[3], 10);
      } else if (mdMatch[5]) {
        dayNum = parseInt(mdMatch[4], 10);
        monthName = mdMatch[5].toLowerCase();
        if (mdMatch[6]) yearNum = parseInt(mdMatch[6], 10);
      }

      const monthIndex = MONTH_NAMES[monthName];
      if (monthIndex !== undefined && dayNum >= 1 && dayNum <= 31) {
        targetDate = new Date(yearNum, monthIndex, dayNum);
        // If no year specified and date is past in current year, advance to next year
        if (!mdMatch[3] && !mdMatch[6] && targetDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          targetDate.setFullYear(now.getFullYear() + 1);
        }
      }
    }
  }

  // 5. ISO Format: "YYYY-MM-DD" or "MM/DD/YYYY"
  if (!targetDate) {
    const isoMatch = text.match(/\b(?:due\s+)?(?:by\s+|on\s+)?(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
      matchedPhrase = isoMatch[0];
      const [y, m, d] = isoMatch[1].split("-").map(Number);
      targetDate = new Date(y, m - 1, d);
    }
  }

  if (!targetDate) {
    return { dueDate: null, formattedDate: null, cleanText: text, matchedPhrase: null };
  }

  // Check for time in surrounding text or matched phrase
  const timeInfo = extractTime(text);
  if (timeInfo) {
    targetDate.setHours(timeInfo.hours, timeInfo.minutes, 0, 0);
    hasTime = true;
    // Append time phrase to matched phrase if not already included
    if (matchedPhrase && !matchedPhrase.toLowerCase().includes(timeInfo.timeStr.toLowerCase())) {
      matchedPhrase = `${matchedPhrase} ${timeInfo.timeStr}`;
    }
  } else {
    targetDate.setHours(0, 0, 0, 0);
  }

  // Clean the text by removing matched phrase & time
  let cleanText = text;
  if (matchedPhrase) {
    // Also remove leading "due ", "due on ", "by ", "on " if part of phrase
    cleanText = cleanText.replace(matchedPhrase, "");
  }
  if (timeInfo && matchedPhrase && !matchedPhrase.includes(timeInfo.timeStr)) {
    cleanText = cleanText.replace(timeInfo.timeStr, "");
  }

  // Clean up extra whitespace and trailing punctuation left behind
  cleanText = cleanText
    .replace(/\s+/g, " ")
    .replace(/\s+([,.:;])/g, "$1")
    .trim();

  const formattedDate = formatDateISO(targetDate, hasTime);

  return {
    dueDate: targetDate,
    formattedDate,
    cleanText,
    matchedPhrase,
  };
}

/**
 * Convert a task string line into formatted Markdown task format with 📅 due date.
 * Example:
 * Input:  "- [ ] Assignment due this Friday"
 * Output: "- [ ] Assignment 📅 2026-09-04"
 */
export function formatTaskLineWithDate(line: string, referenceDate: Date = new Date()): string {
  if (!line || typeof line !== "string") return line;

  // Preserve task prefix e.g. "- [ ] ", "* [ ] ", "- [x] ", "1. [ ] "
  const taskPrefixMatch = line.match(/^(\s*[-*+]\s*\[[ xX]\]\s*|\s*\d+\.\s*\[[ xX]\]\s*|\s*[-*+]\s+|\s*\d+\.\s+)(.*)$/);

  let prefix = "- [ ] ";
  let taskBody = line;

  if (taskPrefixMatch) {
    prefix = taskPrefixMatch[1];
    taskBody = taskPrefixMatch[2];
  }

  const parsed = parseTaskDate(taskBody, referenceDate);
  if (!parsed.dueDate || !parsed.formattedDate) {
    return line;
  }

  const cleanBody = parsed.cleanText;
  const formattedTask = `${prefix}${cleanBody}  ${parsed.formattedDate}`.trimEnd();

  return formattedTask;
}
