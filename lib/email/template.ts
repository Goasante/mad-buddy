import "server-only";

const logoUrl = "https://mad-buddy.com/icons/pwa/icon-192.png";
const fontStack = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMessage(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

export function buildMadBuddyAdminEmailHtml(message: string) {
  const body = formatMessage(message);

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <style>
      :root { color-scheme: light only; supported-color-schemes: light only; }
      .mb-nowrap { white-space: nowrap !important; }
      @media only screen and (max-width: 520px) {
        .mb-shell { padding: 10px 6px !important; }
        .mb-message { padding: 22px 18px 18px 18px !important; }
        .mb-signature-wrap { padding: 0 10px 12px 10px !important; }
        .mb-brand-cell,
        .mb-details-cell {
          display: block !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .mb-brand-cell {
          padding: 18px 16px !important;
          text-align: left !important;
        }
        .mb-brand-inner {
          width: 100% !important;
        }
        .mb-logo-cell {
          width: 70px !important;
          padding-right: 14px !important;
        }
        .mb-logo {
          width: 64px !important;
          height: 64px !important;
          border-radius: 15px !important;
          margin: 0 !important;
        }
        .mb-brand-name {
          font-size: 20px !important;
        }
        .mb-brand-kicker {
          font-size: 11px !important;
          letter-spacing: .14em !important;
        }
        .mb-details-cell {
          padding: 20px 18px 18px 18px !important;
        }
        .mb-team-title {
          font-size: 21px !important;
          line-height: 1.2 !important;
        }
        .mb-contact {
          font-size: 14px !important;
          line-height: 1.9 !important;
        }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f7f4f2;font-family:${fontStack};color:#231f20;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="mb-shell" style="width:100%;background:#f7f4f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #eee4df;">
            <tr>
              <td class="mb-message" style="padding:30px 30px 24px 30px;font-family:${fontStack};font-size:16px;line-height:1.7;color:#2a2527;">
                ${body}
              </td>
            </tr>
            <tr>
              <td class="mb-signature-wrap" style="padding:0 20px 20px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fffaf7;border:1px solid #f2ddd5;border-radius:18px;overflow:hidden;">
                  <tr>
                    <td class="mb-brand-cell" width="190" style="width:190px;padding:22px 18px;background:#ff5343;background-image:linear-gradient(135deg,#ff5343,#f56a54);text-align:center;vertical-align:middle;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" class="mb-brand-inner" style="margin:0 auto;">
                        <tr>
                          <td class="mb-logo-cell" style="padding:0;">
                            <img class="mb-logo" src="${logoUrl}" width="82" height="82" alt="Mad Buddy" style="display:block;width:82px;height:82px;border:0;border-radius:18px;margin:0 auto 12px auto;" />
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <div class="mb-brand-name" style="font-family:${fontStack};font-size:19px;line-height:1.2;font-weight:800;color:#ffffff!important;-webkit-text-fill-color:#ffffff;letter-spacing:-0.02em;">Mad Buddy</div>
                            <div class="mb-brand-kicker" style="font-family:${fontStack};font-size:10px;line-height:1.5;font-weight:700;color:#ffffff!important;-webkit-text-fill-color:#ffffff;letter-spacing:.16em;margin-top:8px;text-transform:uppercase;">Closer · Brighter · Together</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td class="mb-details-cell" style="padding:22px 24px;vertical-align:middle;font-family:${fontStack};background:#fffaf7;">
                      <div class="mb-team-title" style="font-size:22px;line-height:1.22;font-weight:800;color:#241e20;margin:0 0 4px 0;">The Mad Buddy Team</div>
                      <div style="font-size:13px;line-height:1.5;color:#7a7072;margin:0 0 14px 0;">Community &amp; Support</div>

                      <div class="mb-contact" style="font-size:14px;line-height:1.8;color:#332d2f;">
                        <a class="mb-nowrap" href="mailto:hello@mad-buddy.com" style="color:#332d2f;text-decoration:none;white-space:nowrap;">hello@mad-buddy.com</a><br />
                        <a class="mb-nowrap" href="mailto:support@mad-buddy.com" style="color:#332d2f;text-decoration:none;white-space:nowrap;">support@mad-buddy.com</a><br />
                        <a class="mb-nowrap" href="https://mad-buddy.com" style="color:#332d2f;text-decoration:none;white-space:nowrap;">mad-buddy.com</a>
                      </div>

                      <div style="height:1px;background:#f1d4ca;margin:15px 0 12px 0;"></div>

                      <div style="font-size:13px;line-height:1.55;font-weight:700;color:#ff5343;">When your friends are close, they glow.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
