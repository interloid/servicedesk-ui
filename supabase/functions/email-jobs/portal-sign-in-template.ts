// The customer portal's sign-in email. Same card as the invitation email, but
// it wears the workspace's name rather than ours: the customer is signing in
// to "Northwind Support", and has likely never heard of ServiceDesk Pro.

import { escapeHtml } from "./invitation-template.ts";

/**
 * The three things this email can be: a link the customer asked for, a Tenant
 * Admin's invitation, or the account setup that follows a first ticket filed
 * signed out. One card, three sets of words.
 */
export function portalSignInEmailCopy({
  workspace,
  invited = false,
  ticketNumber = null,
}: {
  workspace: string;
  invited?: boolean;
  ticketNumber?: number | null;
}) {
  if (ticketNumber !== null) {
    return {
      subject: `We received your request #${ticketNumber} - set your password for ${workspace} Support`,
      title: `Set your password for ${workspace} Support`,
      heading: "We received your request",
      bodyHtml: `Your request <strong>#${ticketNumber}</strong> is with the <strong>${escapeHtml(workspace)} Support</strong> team. Use the button below to confirm this is your email and set a password, so you can follow its progress, reply, and raise new requests.`,
      bodyText: `Your request #${ticketNumber} is with the ${workspace} Support team. Confirm this is your email and set a password, so you can follow its progress, reply, and raise new requests`,
      button: "Set your password",
      note: "This link works once and expires in 1 hour. After that, sign in from the portal with this email address to get a new one. If you didn't contact us, you can safely ignore this email.",
    };
  }

  if (invited) {
    return {
      subject: `You're invited to ${workspace} Support`,
      title: `You're invited to ${workspace} Support`,
      heading: "You're invited",
      bodyHtml: `You've been invited to <strong>${escapeHtml(workspace)} Support</strong>, where you can raise tickets and follow their progress. Use the button below to sign in. No password needed.`,
      bodyText: `You've been invited to ${workspace} Support, where you can raise tickets and follow their progress`,
      button: "Accept invitation",
      note: "This link works once and expires in 1 hour. After that, sign in from the portal with this email address to get a new one.",
    };
  }

  return {
    subject: `Your sign-in link for ${workspace} Support`,
    title: `Sign in to ${workspace} Support`,
    heading: "Your sign-in link",
    bodyHtml: `Use the button below to sign in to <strong>${escapeHtml(workspace)} Support</strong> and see your requests. No password needed.`,
    bodyText: `Sign in to ${workspace} Support`,
    button: "Sign in",
    note: "This link works once and expires in 1 hour. If you didn't ask to sign in, you can safely ignore this email.",
  };
}

export function portalSignInEmailHtml({
  workspace,
  link,
  invited = false,
  ticketNumber = null,
}: {
  workspace: string;
  link: string;
  /** Sent by a Tenant Admin's "Invite customer" rather than asked for. */
  invited?: boolean;
  /** Sent after a first ticket filed signed out: worded as account setup. */
  ticketNumber?: number | null;
}): string {
  const copy = portalSignInEmailCopy({ workspace, invited, ticketNumber });
  const safeWorkspace = escapeHtml(workspace);
  const safeInitial = escapeHtml(
    workspace.trim().charAt(0).toUpperCase() || "S",
  );
  const safeLink = escapeHtml(link);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(copy.title)}</title>
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
                ${safeInitial}
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
                ${safeWorkspace} Support
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
                ${escapeHtml(copy.heading)}
              </h1>

              <!-- Description -->
              <p
                style="
                  margin: 0 0 28px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #475569;
                "
              >
                ${copy.bodyHtml}
              </p>

              <!-- Sign In Button -->
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
                      ${escapeHtml(copy.button)}
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
                  ${escapeHtml(copy.note)}
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
