import { isSyntheticEmail } from "@/lib/synthetic-targets";
import { ApiContractError, isRecord, normalizeOffboarding } from "@/lib/iam-hr";
import { json, upstream, fail } from "@/lib/iam-hr-upstream";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const type = new URL(request.url).searchParams.get("type");
  if (type !== "offboard" && type !== "report")
    return json({ error: "Invalid action." }, 400);

  if (type === "report")
    return handover(request);

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

const reportMessages: Record<string, string> = {
  HANDOVER_PREPARING: "Your handover report is being prepared. Do not submit again.",
  HANDOVER_IN_PROGRESS: "Sending is in progress. Do not submit again.",
  HANDOVER_ACCEPTED: "Your report was accepted for delivery.",
  HANDOVER_UNKNOWN: "Sending could not be confirmed. Do not submit again; the request requires review.",
  HANDOVER_FAILED_BEFORE_SEND: "The report could not be prepared. No email was sent. The request requires review.",
  HANDOVER_NOT_ELIGIBLE: "A completed offboarding operation from the current cycle is required.",
  HANDOVER_LIMIT_REACHED: "The demonstration has reached its report request limit. Please try later.",
  HANDOVER_WRITE_BLOCKED: "The request cannot be sent again.",
  INVALID_REQUEST: "Provide a completed operation, a permitted target and one valid email address.",
};

async function handover(request: Request) {
  const url = process.env.N8N_REPORT_URL;
  // Unlike offboarding compatibility, handover must never omit server authentication.
  if (!url || !process.env.N8N_WEBHOOK_KEY)
    return json({ success: false, code: "HANDOVER_UNAVAILABLE", message: "Report requests are temporarily unavailable." }, 503);
  let body: unknown;
  try { body = await request.json(); } catch {
    return json({ success: false, code: "INVALID_REQUEST", message: reportMessages.INVALID_REQUEST }, 400);
  }
  if (!isRecord(body) || typeof body.operation_id !== "string" || !/^[1-9][0-9]{0,17}$/.test(body.operation_id)
    || typeof body.target_email !== "string" || !isSyntheticEmail(body.target_email.trim().toLowerCase())
    || typeof body.visitor_email !== "string" || /[\r\n]/.test(body.visitor_email) || body.visitor_email.length > 254
    || !/^[^\s@,;<>:"\\]+@[^\s@,;<>:"\\]+\.[^\s@,;<>:"\\]+$/.test(body.visitor_email.trim()))
    return json({ success: false, code: "INVALID_REQUEST", message: reportMessages.INVALID_REQUEST }, 400);
  try {
    const result = await upstream(url, { method: "POST", body: JSON.stringify({
      operation_id: body.operation_id,
      target_email: body.target_email.trim().toLowerCase(),
      visitor_email: body.visitor_email.trim().toLowerCase(),
    }) });
    const data = result.data;
    if (!isRecord(data) || typeof data.code !== "string" || !Object.hasOwn(reportMessages, data.code))
      throw new ApiContractError();
    const code = data.code;
    const repeated = "repeated" in data && data.repeated === true;
    const status = code === "HANDOVER_ACCEPTED" ? 200
      : code === "HANDOVER_LIMIT_REACHED" ? 429
      : code === "INVALID_REQUEST" ? 400
      : ["HANDOVER_PREPARING", "HANDOVER_IN_PROGRESS", "HANDOVER_UNKNOWN"].includes(code) ? 202 : 409;
    return json({ success: code === "HANDOVER_ACCEPTED", code, repeated,
      message: code === "HANDOVER_ACCEPTED" && repeated
        ? "This report has already been accepted for delivery to this email address."
        : reportMessages[code] }, status);
  } catch {
    return json({ success: false, code: "HANDOVER_UNKNOWN", message: reportMessages.HANDOVER_UNKNOWN }, 504);
  }
}
