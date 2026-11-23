/**
 * Shared CSV serialization for submission records (8 fields):
 *   team_name, slot_id, round, topic_title, repository_url, live_url,
 *   status, submitted_at
 *
 * Used by the participant /submit portal ("Download my submissions CSV")
 * and by the admin dashboard export ("Export CSV" on Submissions & Evaluation).
 */

export interface SubmissionCsvRow {
  team_name: string;
  slot_id: string;
  round: number;
  topic_title: string;
  repository_url: string;
  live_url: string;
  status: string;
  submitted_at: string;
}

/** The 8 columns every submission CSV export must contain, in order. */
export const SUBMISSION_CSV_FIELDS = [
  'team_name',
  'slot_id',
  'round',
  'topic_title',
  'repository_url',
  'live_url',
  'status',
  'submitted_at',
] as const;

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface SubmissionCsvSource {
  team_name?: string | null;
  slot_id?: string | null;
  round?: number | null;
  topic_title?: string | null;
  topic?: { title?: string | null } | null;
  repository_url?: string | null;
  live_url?: string | null;
  status?: string | null;
  submitted_at?: string | null;
}

/** Normalize an enriched submission row into the stable 8-field CSV row. */
export function buildSubmissionCsvRow(sub: SubmissionCsvSource): SubmissionCsvRow {
  const topicTitle = sub.topic_title ?? sub.topic?.title ?? '';
  return {
    team_name: sub.team_name ?? '',
    slot_id: sub.slot_id ?? '',
    round: sub.round ?? 0,
    topic_title: topicTitle,
    repository_url: sub.repository_url ?? '',
    live_url: sub.live_url ?? '',
    status: sub.status ?? '',
    submitted_at: sub.submitted_at ?? '',
  };
}

export function buildSubmissionCsvRows(subs: SubmissionCsvSource[]): SubmissionCsvRow[] {
  return subs.map(buildSubmissionCsvRow);
}

/** Header + one line per row, newline-terminated. */
export function submissionCsvText(rows: SubmissionCsvRow[]): string {
  const header = SUBMISSION_CSV_FIELDS.join(',');
  const lines = rows.map((row) => SUBMISSION_CSV_FIELDS.map((field) => csvCell(row[field])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

/** Trigger a browser download of the CSV text (participant & admin exports). */
export function downloadSubmissionCsv(filename: string, rows: SubmissionCsvRow[]): void {
  const text = submissionCsvText(rows);
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
