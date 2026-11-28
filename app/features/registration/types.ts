export type TeamSize = 3 | 4;

export interface TeamLeader {
  name: string;
  usn: string;
  email: string;
  phone: string;
}

export interface Teammate {
  id: number; // 2, 3, or 4
  name: string;
  usn: string;
}

export interface RegistrationFormData {
  teamName: string;
  leader: TeamLeader;
  teamSize: TeamSize;
  teammates: Teammate[];
}

export interface FormErrors {
  teamName?: string;
  leaderName?: string;
  leaderUsn?: string;
  leaderEmail?: string;
  leaderPhone?: string;
  teammateErrors?: Record<number, { name?: string; usn?: string }>;
  general?: string;
}

export interface RegistrationSuccessData {
  registrationId: string;
  teamName: string;
  teamSize: TeamSize;
  registeredAt: string;
  leader: TeamLeader;
  teammates: Teammate[];
  initialPassword: string; // Added: initial password for captain login
}
