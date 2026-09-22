import { NextResponse } from "next/server";

export async function POST() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAD_BUDDY_EMAIL_FROM;
  const to = process.env.TEST_EMAIL_TO;

  if (!apiKey || !from || !to) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing email environment variables",
      },
      { status: 500 }
    );
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Mad Buddy email test",
        text: "Mad Buddy email sending is working successfully.",
      }),
    });

    const result = (await response.json()) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.message ?? "Email provider request failed",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.id,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Email provider request failed",
      },
      { status: 500 }
    );
  }
}
