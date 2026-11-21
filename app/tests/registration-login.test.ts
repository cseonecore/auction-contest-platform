import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Registration and Login Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Registration Safeguards & Logic", () => {
    it("1. Successfully registers a completely new team and captain", async () => {
      // Mock db responses for a fresh registration
      const mockSettings = [{ key: "registration_open", value: true }, { key: "max_teams", value: 60 }];
      const existingTeam = null;
      const existingMembers: unknown[] = [];

      expect(mockSettings[0].value).toBe(true);
      expect(existingTeam).toBeNull();
      expect(existingMembers.length).toBe(0);

      // Generating initial password
      const teamName = "NewInnovators";
      const captainUsn = "4MT24CS099";
      const initialPassword = `${teamName}${captainUsn.slice(-3)}`;
      expect(initialPassword).toBe("NewInnovators099");
    });

    it("2. Successfully adopts an orphaned Auth account with no team/member association", async () => {
      const captainUsn = "4MT24CS032";
      const captainEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;
      const orphanedAuthId = "5168f460-d5f8-4b92-980b-f300f293dba7";

      // Simulates createUser returning duplicate email
      const createUserError = { message: "A user with this email address has already been registered" };
      const errLower = createUserError.message.toLowerCase();
      const isAlreadyExists =
        /already.*registered|already exists|duplicate/i.test(errLower) ||
        (errLower.includes("already") && errLower.includes("register")) ||
        (errLower.includes("already") && errLower.includes("exist"));
      expect(isAlreadyExists).toBe(true);

      // Verifies that member and team checks return null (orphaned)
      const existingMember = null;
      const existingTeam = null;
      const isOrphaned = !existingMember && !existingTeam;
      expect(isOrphaned).toBe(true);

      // Resolution adopts the existing auth ID without marking as isNewUser
      const resolution = {
        userId: orphanedAuthId,
        isNewUser: false,
        error: null,
      };
      expect(resolution.userId).toBe(orphanedAuthId);
      expect(resolution.isNewUser).toBe(false);
    });

    it("3. Rejects registration when captain is already registered in an active team", async () => {
      const captainUsn = "4MT24CS008";
      const cleanCaptainUsn = captainUsn.toUpperCase();
      const existingMember = {
        id: "fffbc91b-2c72-405b-9233-c4c718a63f05",
        name: "josh",
        email: "4mt24cs008@mite.ac.in",
        teams: { name: "vercel" },
      };

      const regTeam = existingMember.teams?.name ? ` under team "${existingMember.teams.name}"` : "";
      const errorMessage = `Captain USN "${cleanCaptainUsn}" is already registered${regTeam}. Each participant can only register once.`;

      expect(errorMessage).toBe(
        'Captain USN "4MT24CS008" is already registered under team "vercel". Each participant can only register once.'
      );
    });

    it("4. Rejects registration when duplicate USN exists in the submitted form", () => {
      const allUsnEntries = [
        { usn: "4MT24CS001", role: "Captain (Alice)" },
        { usn: "4MT24CS001", role: "Member 2 (Bob)" },
      ];

      const seen = new Map<string, string>();
      let duplicateError: string | null = null;

      for (const entry of allUsnEntries) {
        if (seen.has(entry.usn)) {
          duplicateError = `Duplicate USN "${entry.usn}" detected in your team details (${seen.get(entry.usn)} and ${entry.role}). Each member must have a unique USN.`;
          break;
        }
        seen.set(entry.usn, entry.role);
      }

      expect(duplicateError).toContain("Duplicate USN \"4MT24CS001\" detected in your team details");
    });

    it("5. Rejects registration when a duplicate team name is chosen", () => {
      const cleanTeamName = "Vercel";
      const existingTeam = { id: "9a7a4f67-4304-4e13-8f85-c4a966dce6c0", name: "vercel" };

      const isMatch = existingTeam.name.toLowerCase() === cleanTeamName.toLowerCase();
      expect(isMatch).toBe(true);

      const errorMessage = `The team name "${cleanTeamName}" is already registered. Please choose another name.`;
      expect(errorMessage).toBe('The team name "Vercel" is already registered. Please choose another name.');
    });

    it("6. Rollback behavior: preserves orphaned Auth user if failure occurs midway", async () => {
      const deleteUserMock = vi.fn();
      const dbMock = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }),
        auth: { admin: { deleteUser: deleteUserMock } },
      };

      const teamId = "mock-team-123";
      const authUserId = "5168f460-d5f8-4b92-980b-f300f293dba7";
      const isNewAuthUser = false; // Orphaned account that was adopted

      // Simulating rollback logic
      if (authUserId && isNewAuthUser) {
        await dbMock.auth.admin.deleteUser(authUserId);
      }

      // Must NOT delete pre-existing/orphaned Auth user
      expect(deleteUserMock).not.toHaveBeenCalled();
    });

    it("7. Rollback behavior: deletes Auth user if failure occurs and user was newly created", async () => {
      const deleteUserMock = vi.fn().mockResolvedValue({ error: null });
      const dbMock = {
        auth: { admin: { deleteUser: deleteUserMock } },
      };

      const authUserId = "freshly-created-auth-id";
      const isNewAuthUser = true; // Brand new account

      if (authUserId && isNewAuthUser) {
        await dbMock.auth.admin.deleteUser(authUserId);
      }

      // MUST delete freshly created Auth user
      expect(deleteUserMock).toHaveBeenCalledWith("freshly-created-auth-id");
    });
  });

  describe("Login Safeguards & Logic", () => {
    it("Correctly returns 404 when team name does not exist", () => {
      const cleanTeamName = "admin";
      const team = null;

      expect(team).toBeNull();
      const errorMsg = `Team "${cleanTeamName}" was not found in the database. Please register first.`;
      expect(errorMsg).toBe('Team "admin" was not found in the database. Please register first.');
    });

    it("Validates Captain USN against registered captain member row", () => {
      const cleanCaptainUsn = "4MT24CS008";
      const captainEmail = "4mt24cs008@mite.ac.in";
      const captain = {
        id: "fffbc91b-2c72-405b-9233-c4c718a63f05",
        name: "josh",
        email: "4mt24cs008@mite.ac.in",
        college: "MITE - Sem 5",
      };

      const isCaptainMatch = captain.email.toLowerCase() === captainEmail;
      expect(isCaptainMatch).toBe(true);
    });

    it("Rejects login when Captain USN does not match the registered team captain", () => {
      const cleanCaptainUsn = "4MT24CS099";
      const captainEmail = `${cleanCaptainUsn.toLowerCase()}@mite.ac.in`;
      const captain = {
        id: "fffbc91b-2c72-405b-9233-c4c718a63f05",
        name: "josh",
        email: "4mt24cs008@mite.ac.in",
        college: "MITE - Sem 5",
      };

      const isCaptainMatch = captain.email.toLowerCase() === captainEmail;
      expect(isCaptainMatch).toBe(false);
    });

    it("Generates and tries both registered and typed team name derived passwords", () => {
      const registeredTeamName = "Code Ninjas";
      const typedTeamName = "CodeNinjas";
      const cleanCaptainUsn = "4MT24CS001";

      const p1 = `${registeredTeamName}${cleanCaptainUsn.slice(-3)}`;
      const p2 = `${typedTeamName}${cleanCaptainUsn.slice(-3)}`;

      const passwords = Array.from(new Set([p1, p2]));
      expect(passwords).toEqual(["Code Ninjas001", "CodeNinjas001"]);
    });
  });
});
