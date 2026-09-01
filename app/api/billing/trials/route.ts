import { NextResponse } from "next/server";

const retired = () =>
  NextResponse.json(
    {
      error:
        "The old premium-trial product has been retired. Welcome Access is separate and starts automatically after the first Muddy."
    },
    { status: 410 }
  );

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}

export async function DELETE() {
  return retired();
}
