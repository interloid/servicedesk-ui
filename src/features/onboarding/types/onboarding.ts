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
  // Step 1: Account
  fullName: string;
  workEmail: string;
  password: string;
  agreeToTerms: boolean;

  // Step 2: Organization
  orgName: string;
  portalAddress: string;

  // Step 3: Business Hours & Timezone (Supabase FK)
  timezone_id: string; // Foreign key referencing public.timezones.id (UUID)
  workingDays: WorkingDay[];
  dayStarts: string; // Format "HH:MM" e.g., "09:00"
  dayEnds: string;   // Format "HH:MM" e.g., "18:30"

  // Step 4: SLA Targets
  slaTargets: SlaTarget[];

  // Step 5: Team Invites
  invites: TeamInvite[];
}