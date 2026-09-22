import "server-only";

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode: string };

export async function sendMadBuddyEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAD_BUDDY_EMAIL_FROM;

  if (!apiKey || !from) {
    return { ok: false, errorCode: "email_provider_not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {})
      })
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        errorCode: payload.name ?? `resend_http_${response.status}`
      };
    }

    if (!payload.id) {
      return { ok: false, errorCode: "resend_missing_message_id" };
    }

    return { ok: true, providerMessageId: payload.id };
  } catch {
    return { ok: false, errorCode: "resend_request_failed" };
  }
}
