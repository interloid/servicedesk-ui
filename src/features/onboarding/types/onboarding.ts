export type WorkingDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface TeamInvite {
  email: string;
  role: "Agent" | "Admin" | "Manager";
}

export interface SlaTarget {
  priority: "Urgent" | "High" | "Normal" | "Low";
  firstReply: string;
  resolve: string;
}

export interface OnboardingState {
  fullName: string;
  workEmail: string;
  password: string;
  agreeToTerms: boolean;

  orgName: string;
  portalAddress: string;

  timezone_id: string;
  workingDays: WorkingDay[];
  dayStarts: string;
  dayEnds: string;

  slaTargets: SlaTarget[];

  invites: TeamInvite[];
}
