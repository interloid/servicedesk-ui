// A notification from the notification center, sent because the recipient
// has "Email" switched on for its event. Same card as the invitation and
// portal sign-in emails, worn by the workspace: the agent knows it as
// "Northwind", not as ServiceDesk Pro.

import { escapeHtml } from "./invitation-template.ts";

export function notificationEmailHtml({
  workspace,
  title,
  body,
  link,
}: {
  workspace: string;
  title: string;
  body: string;
  /** The ticket, when the notification is about one. */
  link: string | null;
}): string {
  const safeWorkspace = escapeHtml(workspace);
  const safeInitial = escapeHtml(
    workspace.trim().charAt(0).toUpperCase() || "S",
  );
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);

  const button = link
    ? `
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
                      href="${escapeHtml(link)}"
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
                      View ticket
                    </a>
                  </td>
                </tr>
              </table>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
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
                ${safeWorkspace}
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
                  font-size: 22px;
                  line-height: 30px;
                  font-weight: 700;
                  color: #0f172a;
                "
              >
                ${safeTitle}
              </h1>

              ${
                safeBody
                  ? `<!-- Description -->
              <p
                style="
                  margin: 0 0 28px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #475569;
                "
              >
                ${safeBody}
              </p>`
                  : ""
              }
${button}

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
                You're getting this because email is on for this event in your
                notification settings. This is an automated email. Please don't
                reply.
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
