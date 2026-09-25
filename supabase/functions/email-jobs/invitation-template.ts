// The "You've been invited" email, for someone who already has an account
// (Supabase's own invite template only reaches accounts that were never
// confirmed). Moved here from the Next.js app with the email queue; the markup
// is unchanged.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "an Agent", "a Manager" -- same wording as roleWithArticle in the app. */
export function roleWithArticle(role: string): string {
  return `${/^[AEIOU]/.test(role) ? "an" : "a"} ${role}`;
}

export function invitationEmailHtml({
  workspace,
  role,
  link,
}: {
  workspace: string;
  role: string;
  link: string;
}): string {
  const safeWorkspace = escapeHtml(workspace);
  const safeRole = escapeHtml(roleWithArticle(role));
  const safeLink = escapeHtml(link);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're Invited</title>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background-color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
  "
>
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      background-color: #f8fafc;
      padding: 40px 16px;
    "
  >
    <tr>
      <td align="center">

        <!-- Main Card -->
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width: 520px;
            background-color: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            overflow: hidden;
          "
        >

          <!-- Header -->
          <tr>
            <td
              style="
                padding: 32px 32px 24px;
                text-align: center;
              "
            >
              <!-- Logo -->
              <div
                style="
                  width: 40px;
                  height: 40px;
                  line-height: 40px;
                  margin: 0 auto 14px;
                  background-color: #0f766e;
                  color: #ffffff;
                  border-radius: 10px;
                  font-size: 18px;
                  font-weight: 800;
                  text-align: center;
                "
              >
                S
              </div>

              <!-- Brand -->
              <div
                style="
                  font-size: 18px;
                  line-height: 24px;
                  font-weight: 700;
                  color: #0f172a;
                "
              >
                ServiceDesk Pro
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td
              style="
                padding: 8px 40px 40px;
                text-align: center;
              "
            >

              <!-- Heading -->
              <h1
                style="
                  margin: 0 0 16px;
                  font-size: 26px;
                  line-height: 34px;
                  font-weight: 700;
                  color: #0f172a;
                "
              >
                You're Invited
              </h1>

              <!-- Description -->
              <p
                style="
                  margin: 0 0 16px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #475569;
                "
              >
                You've been invited to join
                <strong>${safeWorkspace}</strong>
                as ${safeRole}.
              </p>

              <p
                style="
                  margin: 0 0 28px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #64748b;
                "
              >
                Accept your invitation below to create your account
                and get started with your workspace.
              </p>

              <!-- Accept Invitation Button -->
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td align="center">
                    <a
                      href="${safeLink}"
                      style="
                        display: inline-block;
                        padding: 13px 28px;
                        background-color: #0f766e;
                        color: #ffffff;
                        text-decoration: none;
                        font-size: 14px;
                        font-weight: 600;
                        line-height: 20px;
                        border-radius: 8px;
                        border: 1px solid #0f766e;
                      "
                    >
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Spacer -->
              <div style="height: 28px;"></div>

              <!-- Security Note -->
              <div
                style="
                  padding: 14px 16px;
                  background-color: #f0fdfa;
                  border: 1px solid #ccfbf1;
                  border-radius: 8px;
                  text-align: left;
                "
              >
                <p
                  style="
                    margin: 0;
                    font-size: 12px;
                    line-height: 19px;
                    color: #475569;
                  "
                >
                  If you weren't expecting this invitation,
                  you can safely ignore this email.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td
              style="
                padding: 20px 32px;
                border-top: 1px solid #f1f5f9;
                text-align: center;
              "
            >
              <p
                style="
                  margin: 0;
                  font-size: 12px;
                  line-height: 18px;
                  color: #94a3b8;
                "
              >
                © 2026 ServiceDesk Pro. All rights reserved.
              </p>

              <p
                style="
                  margin: 6px 0 0;
                  font-size: 12px;
                  line-height: 18px;
                  color: #94a3b8;
                "
              >
                This is an automated email. Please don't reply.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
