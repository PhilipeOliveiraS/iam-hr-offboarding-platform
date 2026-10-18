import { normalizeDashboard } from "@/lib/iam-hr";
import { json, upstream, fail } from "@/lib/iam-hr-upstream";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const url = process.env.N8N_GET_DATA_URL;
  if (!url)
    return json({ error: "Dashboard endpoint is not configured." }, 500);
  try {
    const result = await upstream(url, { method: "GET" });
    if (result.status >= 400) return json(result.data, result.status);
    return json(normalizeDashboard(result.data));
  } catch (error) {
    return fail(error);
  }
}
