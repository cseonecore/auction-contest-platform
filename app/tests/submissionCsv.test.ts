import { describe, expect, it } from "vitest";
import {
  SUBMISSION_CSV_FIELDS,
  buildSubmissionCsvRow,
  buildSubmissionCsvRows,
  submissionCsvText,
} from "@/features/submission/utils/submissionCsv";

describe("submissionCsv", () => {
  it("has exactly the 8 required fields in order", () => {
    expect(SUBMISSION_CSV_FIELDS).toHaveLength(8);
    expect([...SUBMISSION_CSV_FIELDS]).toEqual([
      "team_name",
      "slot_id",
      "round",
      "topic_title",
      "repository_url",
      "live_url",
      "status",
      "submitted_at",
    ]);
  });

  it("builds a row with defaults for missing values", () => {
    const row = buildSubmissionCsvRow({});
    expect(row).toEqual({
      team_name: "",
      slot_id: "",
      round: 0,
      topic_title: "",
      repository_url: "",
      live_url: "",
      status: "",
      submitted_at: "",
    });
  });

  it("falls back to topic.title when topic_title is missing", () => {
    const row = buildSubmissionCsvRow({ topic: { title: "Web Marketplace" } });
    expect(row.topic_title).toBe("Web Marketplace");
  });

  it("buildSubmissionCsvRows maps an array of sources", () => {
    const rows = buildSubmissionCsvRows([
      { team_name: "Alpha", slot_id: "slot-1", round: 1, topic_title: "T", status: "submitted", submitted_at: "2026-01-01" },
      { team_name: "Beta", slot_id: "slot-2", round: 2, repository_url: "https://github.com/b/repo", live_url: "https://live.app" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].team_name).toBe("Alpha");
    expect(rows[1].repository_url).toBe("https://github.com/b/repo");
    expect(rows[1].live_url).toBe("https://live.app");
  });

  it("submissionCsvText emits the header and all 8 columns", () => {
    const text = submissionCsvText([
      buildSubmissionCsvRow({
        team_name: "Alpha",
        slot_id: "s1",
        round: 1,
        topic_title: "Problem One",
        repository_url: "https://github.com/a/r",
        live_url: "https://a.vercel.app",
        status: "submitted",
        submitted_at: "2026-11-22T10:00:00Z",
      }),
    ]);
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(SUBMISSION_CSV_FIELDS.join(","));
    const cols = lines[1].split(",");
    expect(cols).toHaveLength(8);
    expect(cols[0]).toBe("Alpha");
    expect(cols[1]).toBe("s1");
    expect(cols[2]).toBe("1");
    expect(cols[3]).toBe("Problem One");
  });

  it("quotes values containing commas, quotes or newlines", () => {
    const text = submissionCsvText([
      buildSubmissionCsvRow({ team_name: 'Team "A", Inc', topic_title: "Line1\nLine2" }),
    ]);
    expect(text).toContain('"Team ""A"", Inc"');
    expect(text).toContain('"Line1\nLine2"');
  });

  it("produces an empty header line for an empty list", () => {
    expect(submissionCsvText([])).toBe(SUBMISSION_CSV_FIELDS.join(",") + "\n");
  });
});
