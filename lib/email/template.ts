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
  <body style="margin:0;padding:0;background:#f7f4f2;font-family:${fontStack};color:#231f20;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f4f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #eee4df;">
            <tr>
              <td style="padding:30px 30px 24px 30px;font-family:${fontStack};font-size:16px;line-height:1.7;color:#2a2527;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:0 20px 20px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fffaf7;border:1px solid #f2ddd5;border-radius:18px;overflow:hidden;">
                  <tr>
                    <td style="width:122px;padding:20px 18px;background:#ff5343;text-align:center;vertical-align:middle;">
                      <img src="${logoUrl}" width="88" height="88" alt="Mad Buddy" style="display:block;width:88px;height:88px;border:0;border-radius:20px;margin:0 auto 12px auto;" />
                      <div style="font-family:${fontStack};font-size:18px;line-height:1.2;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Mad Buddy</div>
                    </td>
                    <td style="padding:22px 24px;vertical-align:middle;font-family:${fontStack};">
                      <div style="font-size:21px;line-height:1.25;font-weight:800;color:#241e20;margin:0 0 4px 0;">The Mad Buddy Team</div>
                      <div style="font-size:13px;line-height:1.5;color:#7a7072;margin:0 0 14px 0;">Community &amp; Support</div>

                      <div style="font-size:14px;line-height:1.7;color:#332d2f;">
                        <a href="mailto:hello@mad-buddy.com" style="color:#332d2f;text-decoration:none;">hello@mad-buddy.com</a><br />
                        <a href="mailto:support@mad-buddy.com" style="color:#332d2f;text-decoration:none;">support@mad-buddy.com</a><br />
                        <a href="https://mad-buddy.com" style="color:#332d2f;text-decoration:none;">mad-buddy.com</a>
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
