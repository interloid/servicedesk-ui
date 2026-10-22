// What a customer hears about their own request: the confirmation when it is
// raised, each public reply from the team, and the resolution. Same card as
// the portal sign-in email and worn the same way, as "<Workspace> Support".

import { escapeHtml } from "./invitation-template.ts";

export function customerTicketEmailHtml({
  workspace,
  heading,
  intro,
  quote,
  buttonLabel,
  link,
  note,
}: {
  workspace: string;
  heading: string;
  /** Plain text; escaped here. */
  intro: string;
  /** The agent's reply, shown as a quoted block. */
  quote?: string;
  buttonLabel: string;
  /** The request in the portal, or null when the app's origin is unknown. */
  link: string | null;
  note: string;
}): string {
  const safeWorkspace = escapeHtml(workspace);
  const safeInitial = escapeHtml(
    workspace.trim().charAt(0).toUpperCase() || "S",
  );
  const safeHeading = escapeHtml(heading);

  const quoteBlock = quote
    ? `
              <div
                style="
                  margin: 0 0 28px;
                  padding: 14px 16px;
                  background-color: #f8fafc;
                  border-left: 3px solid #0f766e;
                  border-radius: 6px;
                  text-align: left;
                  font-size: 14px;
                  line-height: 22px;
                  color: #334155;
                  white-space: pre-wrap;
                "
              >${escapeHtml(quote)}</div>`
    : "";

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
                      ${escapeHtml(buttonLabel)}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Spacer -->
              <div style="height: 28px;"></div>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeHeading}</title>
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
                  font-size: 24px;
                  line-height: 32px;
                  font-weight: 700;
                  color: #0f172a;
                "
              >
                ${safeHeading}
              </h1>

              <!-- Description -->
              <p
                style="
                  margin: 0 0 24px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #475569;
                "
              >
                ${escapeHtml(intro)}
              </p>
${quoteBlock}
${button}

              <!-- Note -->
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
                  ${escapeHtml(note)}
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
