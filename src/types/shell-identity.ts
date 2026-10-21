export type ShellIdentity = {
  org: {
    id: string;
    name: string;
    initial: string;
    planSummary: string;
    /** The plan's display name, e.g. "Free" or "Pro". */
    planName: string;
  };

  user: {
    id: string;
    name: string;
    email: string;
    initials: string;
    avatarUrl?: string;
    role: string;
  };
};
