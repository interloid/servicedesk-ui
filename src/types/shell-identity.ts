export type ShellIdentity = {
  org: {
    id: string;
    name: string;
    initial: string;
    planSummary: string;
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
