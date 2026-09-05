import { describe, expect, it } from "vitest";
import {
  parseTaskDate,
  formatTaskLineWithDate,
} from "../src/utils/taskDateParser";

describe("taskDateParser", () => {
  // Fixed reference date: Tuesday, 2026-09-01
  const REF_DATE = new Date(2026, 8, 1, 10, 0, 0); // Month is 0-indexed (8 = Sept)

  it("parses 'today'", () => {
    const res = parseTaskDate("Finish report today", REF_DATE);
    expect(res.formattedDate).toBe("2026-09-01");
    expect(res.cleanText).toBe("Finish report");
    expect(res.matchedPhrase).toBe("today");
  });

  it("parses 'tomorrow'", () => {
    const res = parseTaskDate("Submit draft tomorrow", REF_DATE);
    expect(res.formattedDate).toBe("2026-09-02");
    expect(res.cleanText).toBe("Submit draft");
  });

  it("parses 'this friday'", () => {
    // 2026-09-01 is Tuesday. Friday is 2026-09-04.
    const res = parseTaskDate("Assignment due this Friday", REF_DATE);
    expect(res.formattedDate).toBe("2026-09-04");
    expect(res.cleanText).toBe("Assignment");
  });

  it("parses 'next monday'", () => {
    // 2026-09-01 is Tuesday. Next Monday is 2026-09-07.
    const res = parseTaskDate("Team sync next Monday", REF_DATE);
    expect(res.formattedDate).toBe("2026-09-07");
    expect(res.cleanText).toBe("Team sync");
  });

  it("parses relative offsets like 'in 3 days'", () => {
    const res = parseTaskDate("Pay bills in 3 days", REF_DATE);
    expect(res.formattedDate).toBe("2026-09-04");
    expect(res.cleanText).toBe("Pay bills");
  });

  it("parses month and day like 'Oct 15'", () => {
    const res = parseTaskDate("Review budget on Oct 15", REF_DATE);
    expect(res.formattedDate).toBe("2026-10-15");
    expect(res.cleanText).toBe("Review budget");
  });

  it("parses explicit times like 'at 3pm'", () => {
    const res = parseTaskDate("Call doctor tomorrow at 3pm", REF_DATE);
    expect(res.formattedDate).toBe("2026-09-02 15:00");
    expect(res.cleanText).toBe("Call doctor");
  });

  it("returns unchanged text when no date expression is found", () => {
    const res = parseTaskDate("Buy milk and bread", REF_DATE);
    expect(res.dueDate).toBeNull();
    expect(res.formattedDate).toBeNull();
    expect(res.cleanText).toBe("Buy milk and bread");
  });

  it("formats task list items into standard Markdown due date format", () => {
    const input = "- [ ] Assignment due this Friday";
    const formatted = formatTaskLineWithDate(input, REF_DATE);
    expect(formatted).toBe("- [ ] Assignment 📅 2026-09-04");
  });

  it("preserves task checkmark state and indentation", () => {
    const input = "  - [x] Complete project review tomorrow";
    const formatted = formatTaskLineWithDate(input, REF_DATE);
    expect(formatted).toBe("  - [x] Complete project review 📅 2026-09-02");
  });

  it("avoids duplicate formatting if 📅 due date is already present", () => {
    const input = "- [ ] Already scheduled 📅 2026-09-10";
    const formatted = formatTaskLineWithDate(input, REF_DATE);
    expect(formatted).toBe("- [ ] Already scheduled 📅 2026-09-10");
  });
});
