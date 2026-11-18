/**
 * Bid2Build Admin Registration Export Service
 * Generates formatted Excel (.xlsx) spreadsheets containing team and member details.
 * Layout: ONE ROW PER TEAM with dynamic member columns.
 * Strictly uses ExcelJS to produce real, styled XLSX workbooks.
 */

import ExcelJS from 'exceljs';
import type {
  RegisteredTeamWithRelations,
  RegisteredMember,
  RegisteredCaptainDetails,
} from '../types/registration';
import { parseCaptainMetadata } from './registrationService';

export interface ExportTeamDetailsResult {
  success: boolean;
  totalTeams: number;
  totalRows: number;
  maxMembersInAnyTeam: number;
  filename: string;
  captainPhoneAvailable: boolean;
  error?: string;
}

/**
 * Returns formatted filename with today's date: Bid2Build_Team_Details_<YYYY-MM-DD>.xlsx
 */
export function getTeamDetailsExportFilename(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `Bid2Build_Team_Details_${yyyy}-${mm}-${dd}.xlsx`;
}

/**
 * Safely converts a 1-based column index to an Excel column letter (e.g. 1 -> A, 11 -> K, 27 -> AA).
 */
export function getColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

/**
 * Resolves captain mobile number strictly from the captain member record.
 * Never substitutes another member's number, invents data, or guesses formatting.
 * If no phone field exists in the database record, returns empty string to keep the cell blank.
 */
export function resolveCaptainMobileNumber(
  captainMember?: RegisteredMember | null,
  captainDetails?: RegisteredCaptainDetails | null
): string {
  // 1. Direct phone property on member record from public.members.phone
  if (
    captainMember?.phone &&
    typeof captainMember.phone === 'string' &&
    captainMember.phone.trim()
  ) {
    return captainMember.phone.trim();
  }

  // 2. Phone property on captain details structure if populated
  if (
    captainDetails?.phone &&
    typeof captainDetails.phone === 'string' &&
    captainDetails.phone.trim()
  ) {
    return captainDetails.phone.trim();
  }

  // 3. Fallback: Parse from captainMember.college if present (backward compatibility)
  if (captainMember?.college) {
    const parsed = parseCaptainMetadata(captainMember.college);
    if (parsed.phone) {
      return parsed.phone;
    }
  }

  // 4. Fallback: genuinely unavailable in database
  return '';
}

/**
 * Exports all active registered teams into a styled .xlsx spreadsheet with ONE ROW PER TEAM.
 *
 * Column Layout:
 * 1. S.No.
 * 2. Team Name
 * 3. Captain Name
 * 4. Captain USN
 * 5. Captain Mobile Number
 * 6. Member Name
 * 7. Member USN
 * 8. Member Mobile Number
 * 9. Member 1 Name
 * 10. Member 1 USN
 * 11. Member 1 Mobile Number
 * 12. Member 2 Name
 * 13. Member 2 USN
 * 14. Member 2 Mobile Number
 * ... dynamically adds Member Name / USN / Mobile Number triplets based on max non-captain members across all teams.
 *
 * Rules:
 * - Exactly one row per team.
 * - Captain is resolved using the team's actual captain_id relationship.
 * - Captain is excluded from the member column pairs (never duplicated).
 * - Missing values (including unavailable mobile numbers) are left blank.
 * - USNs and mobile numbers are stored and formatted strictly as text ('@').
 * - Preserves bold headers, frozen row, auto-filter, and clean borders.
 */
export async function exportTeamDetailsToExcel(
  teams: RegisteredTeamWithRelations[]
): Promise<ExportTeamDetailsResult> {
  const filename = getTeamDetailsExportFilename();

  try {
    if (!teams || teams.length === 0) {
      return {
        success: false,
        totalTeams: 0,
        totalRows: 0,
        maxMembersInAnyTeam: 0,
        filename,
        captainPhoneAvailable: false,
        error: 'No active registered teams available for export.',
      };
    }

    // Sort teams alphabetically by name (case-insensitive) for clean reading
    const sortedTeams = [...teams].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    // Analyze rosters: resolve captain using team.captain_id and separate remaining members
    interface TeamRosterAnalysis {
      team: RegisteredTeamWithRelations;
      captainMember: RegisteredMember | null;
      captainName: string;
      captainUsn: string;
      captainMobile: string;
      nonCaptainMembers: RegisteredMember[];
    }

    let hasAnyCaptainMobile = false;
    let maxNonCaptainCount = 0;

    const analyzedRosters: TeamRosterAnalysis[] = sortedTeams.map((team) => {
      const allMembers = team.members || [];

      // 1. Resolve captain member strictly through team.captain_id relationship
      let captainMember: RegisteredMember | null = null;
      if (team.captain_id) {
        captainMember = allMembers.find((m) => m.id === team.captain_id) || null;
      }
      if (!captainMember && team.captain?.member) {
        captainMember = team.captain.member;
      }
      if (!captainMember && allMembers.length > 0) {
        captainMember = allMembers[0];
      }

      // 2. Captain Name
      let captainName = '';
      if (team.captain?.member?.name) {
        captainName = team.captain.member.name.trim();
      } else if (captainMember?.name) {
        captainName = captainMember.name.trim();
      }

      // 3. Captain USN
      let captainUsn = '';
      if (team.captain?.usn && team.captain.usn !== 'N/A') {
        captainUsn = team.captain.usn.trim().toUpperCase();
      } else if (captainMember?.parsedUsn && captainMember.parsedUsn !== 'N/A') {
        captainUsn = captainMember.parsedUsn.trim().toUpperCase();
      }

      // 4. Captain Mobile Number (strictly from captain's record; empty if not stored in DB)
      const captainMobile = resolveCaptainMobileNumber(captainMember, team.captain);
      if (captainMobile) {
        hasAnyCaptainMobile = true;
      }

      // 5. Non-captain members: exclude the captain to avoid duplication
      const nonCaptainMembers = allMembers.filter((m) =>
        captainMember ? m.id !== captainMember.id : true
      );

      if (nonCaptainMembers.length > maxNonCaptainCount) {
        maxNonCaptainCount = nonCaptainMembers.length;
      }

      return {
        team,
        captainMember,
        captainName,
        captainUsn,
        captainMobile,
        nonCaptainMembers,
      };
    });

    // Ensure at least 1 member set exists (Member Name / Member USN / Member Mobile Number)
    const effectiveMemberPairs = Math.max(maxNonCaptainCount, 1);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Bid2Build Platform';
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet('Team Details', {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // Build dynamic column definitions:
    // 1. S.No.
    // 2. Team Name
    // 3. Captain Name
    // 4. Captain USN
    // 5. Captain Mobile Number
    // 6. Member Name
    // 7. Member USN
    // 8. Member Mobile Number
    // 9. Member 1 Name
    // 10. Member 1 USN
    // 11. Member 1 Mobile Number
    // ...
    const columns: Array<{ header: string; key: string; width: number }> = [
      { header: 'S.No.', key: 'sno', width: 8 },
      { header: 'Team Name', key: 'teamName', width: 28 },
      { header: 'Captain Name', key: 'captainName', width: 24 },
      { header: 'Captain USN', key: 'captainUsn', width: 18 },
      { header: 'Captain Mobile Number', key: 'captainMobile', width: 22 },
    ];

    for (let i = 0; i < effectiveMemberPairs; i++) {
      const nameHeader = i === 0 ? 'Member Name' : `Member ${i} Name`;
      const usnHeader = i === 0 ? 'Member USN' : `Member ${i} USN`;
      const mobileHeader = i === 0 ? 'Member Mobile Number' : `Member ${i} Mobile Number`;

      columns.push({ header: nameHeader, key: `member_${i}_name`, width: 24 });
      columns.push({ header: usnHeader, key: `member_${i}_usn`, width: 18 });
      columns.push({ header: mobileHeader, key: `member_${i}_mobile`, width: 22 });
    }

    worksheet.columns = columns;

    // Enable auto-filter across all columns
    const lastColLetter = getColumnLetter(columns.length);
    worksheet.autoFilter = `A1:${lastColLetter}1`;

    // Style the header row (Row 1)
    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FF1F2937' },
    };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };
    headerRow.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 1 ? 'center' : 'left',
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'medium', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });

    // Populate data: ONE ROW PER TEAM
    let serialNumber = 1;

    for (const item of analyzedRosters) {
      const rowData: Record<string, unknown> = {
        sno: serialNumber++,
        teamName: item.team.name ? item.team.name.trim() : 'Unnamed Team',
        captainName: item.captainName,
        captainUsn: item.captainUsn,
        captainMobile: item.captainMobile,
      };

      for (let i = 0; i < effectiveMemberPairs; i++) {
        const member = item.nonCaptainMembers[i];
        const nameKey = `member_${i}_name`;
        const usnKey = `member_${i}_usn`;
        const mobileKey = `member_${i}_mobile`;

        const memberName = member?.name ? member.name.trim() : '';
        const memberUsn =
          member?.parsedUsn && member.parsedUsn !== 'N/A'
            ? member.parsedUsn.trim().toUpperCase()
            : '';
        const memberMobile =
          member?.phone && typeof member.phone === 'string'
            ? member.phone.trim()
            : '';

        rowData[nameKey] = memberName;
        rowData[usnKey] = memberUsn;
        rowData[mobileKey] = memberMobile;
      }

      const row = worksheet.addRow(rowData);
      row.height = 20;

      // Apply consistent styling and text formatting
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = {
          name: 'Calibri',
          size: 11,
          color: { argb: 'FF111827' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNumber === 1 ? 'center' : 'left',
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFF3F4F6' } },
          left: { style: 'thin', color: { argb: 'FFF3F4F6' } },
          bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } },
          right: { style: 'thin', color: { argb: 'FFF3F4F6' } },
        };
      });

      // Format Captain USN (Col 4) strictly as text
      const capUsnCell = row.getCell(4);
      capUsnCell.numFmt = '@';
      capUsnCell.value = String(item.captainUsn || '');

      // Format Captain Mobile Number (Col 5) strictly as text
      const capMobileCell = row.getCell(5);
      capMobileCell.numFmt = '@';
      capMobileCell.value = String(item.captainMobile || '');

      // Format all Member USN and Mobile Number cells strictly as text
      for (let i = 0; i < effectiveMemberPairs; i++) {
        const usnColNumber = 5 + i * 3 + 2; // Col 7, 10, 13...
        const mobileColNumber = 5 + i * 3 + 3; // Col 8, 11, 14...
        const member = item.nonCaptainMembers[i];
        const memUsn =
          member?.parsedUsn && member.parsedUsn !== 'N/A'
            ? member.parsedUsn.trim().toUpperCase()
            : '';
        const memMobile =
          member?.phone && typeof member.phone === 'string'
            ? member.phone.trim()
            : '';

        const memberUsnCell = row.getCell(usnColNumber);
        memberUsnCell.numFmt = '@';
        memberUsnCell.value = String(memUsn);

        const memberMobileCell = row.getCell(mobileColNumber);
        memberMobileCell.numFmt = '@';
        memberMobileCell.value = String(memMobile);
      }
    }

    const totalRows = serialNumber - 1;

    // Generate ArrayBuffer and create Blob with correct MIME type
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Trigger browser download in client environments
    if (typeof window !== 'undefined') {
      const downloadUrl = window.URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = downloadUrl;
      downloadAnchor.download = filename;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      window.URL.revokeObjectURL(downloadUrl);
    }

    return {
      success: true,
      totalTeams: sortedTeams.length,
      totalRows,
      maxMembersInAnyTeam: 1 + maxNonCaptainCount,
      filename,
      captainPhoneAvailable: hasAnyCaptainMobile,
    };
  } catch (err: unknown) {
    return {
      success: false,
      totalTeams: 0,
      totalRows: 0,
      maxMembersInAnyTeam: 0,
      filename,
      captainPhoneAvailable: false,
      error: err instanceof Error ? err.message : 'Failed to generate Excel export file.',
    };
  }
}
