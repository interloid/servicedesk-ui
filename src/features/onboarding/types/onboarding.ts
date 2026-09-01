export type WorkingDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface TeamInvite {
  email: string;
  role: "Agent" | "Admin" | "Manager";
}

export interface SlaTarget {
  priority: "Urgent" | "High" | "Normal" | "Low";
  /** Display label only — never parsed back into a number. */
  firstReply: string;
  resolve: string;
  /** The values actually sent to the server. */
  firstReplyMins: number;
  resolveMins: number;
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
