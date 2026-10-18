import { isSyntheticEmail } from "@/lib/synthetic-targets";
import { ApiContractError, isRecord, normalizeOffboarding } from "@/lib/iam-hr";
import { json, upstream, fail } from "@/lib/iam-hr-upstream";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const type = new URL(request.url).searchParams.get("type");
  if (type !== "offboard" && type !== "report")
    return json({ error: "Invalid action." }, 400);

  // No persistent delivery reservation/rate limit exists locally. Fail closed.
  if (type === "report")
    return json(
      { success: false, code: "HANDOVER_DISABLED", error: "Public handover delivery is disabled pending persistent abuse controls." },
      403,
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!isRecord(body)) return json({ error: "Invalid request." }, 400);

  const email = body.target_email;
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return json({ error: "Provide a valid email address." }, 400);
  }
  if (type === "offboard" && !isSyntheticEmail(email.trim().toLowerCase()))
    return json({ code: "TARGET_NOT_ALLOWED", error: "Target is not permitted." }, 400);
  const operationId =
    body.operation_id == null ? null : String(body.operation_id);
  if (
    type === "offboard" &&
    operationId !== null &&
    !/^[1-9][0-9]{0,17}$/.test(operationId)
  ) {
    return json({ error: "Invalid operation_id." }, 400);
  }
  const url = process.env.N8N_OFFBOARD_URL;
  if (!url) return json({ error: "Action endpoint is not configured." }, 500);
  const targetEmail = email.trim().toLowerCase();
  const payload = { target_email: targetEmail, operation_id: operationId };

  try {
    const result = await upstream(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result.status >= 400) return json(result.data, result.status);
    if (!isRecord(result.data)) throw new ApiContractError();
    const dashboard = normalizeOffboarding(result.data, targetEmail);
    return json({ ...result.data, dashboard }, result.status);
  } catch (error) {
    return fail(error);
  }
}
