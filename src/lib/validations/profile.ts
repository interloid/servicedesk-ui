import * as z from "zod";

export const profileFormSchema = z.object({
  fullName: z
    .string()
    .min(2, { message: "Name must be at least 2 characters." }),
  // Shown read-only; the server never saves it (it follows the auth account).
  email: z.string().email({ message: "Please enter a valid email address." }),
  avatarUrl: z.string().optional(),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
