import * as z from "zod";

export const profileFormSchema = z.object({
  fullName: z
    .string()
    .min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  avatarUrl: z.string().optional(),
  slaNotification: z.boolean(),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
