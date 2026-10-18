import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The legacy proxy must not bypass the disabled public handover endpoint.
// No upstream call is permitted until persistent delivery controls exist.
export async function POST() {
  return NextResponse.json(
    { success: false, code: "HANDOVER_DISABLED", error: "Public handover delivery is disabled." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
