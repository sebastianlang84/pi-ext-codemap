export async function GET() {
  const macroSnapshot = await loadMacroSnapshot();
  return Response.json({ macroSnapshot, channel: "newsletter" });
}

type RouteHandler = (request: Request) => Promise<Response>;
export const getNewsletterMacroSnapshot: RouteHandler = async (_request) => GET();

async function loadMacroSnapshot() {
  return { risk: "steady" };
}
