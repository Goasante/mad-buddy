export async function POST() {
  return Response.json(
    {
      error: "This checkout has been retired. Visit the current bookshop.",
      url: "/",
    },
    { status: 410 }
  );
}
