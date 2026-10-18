import { NextResponse } from "next/server";
import { ApiContractError, isRecord } from "@/lib/iam-hr";

const TIMEOUT_MS = 55_000;
const UNCERTAIN_RESULT =
  "The request could not be confirmed. Refresh the operation status before retrying; processing may still be running.";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function upstream(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(process.env.N8N_WEBHOOK_KEY
          ? { "X-N8N-Webhook-Secret": process.env.N8N_WEBHOOK_KEY }
          : {}),
      },
    });
    // Keep the timeout active while reading the body, not just the headers.
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
      if (!isRecord(data) && !Array.isArray(data)) throw new ApiContractError();
    } catch {
      return {
        status: response.status >= 400 ? response.status : 502,
        data: {
          success: false,
          code: "UPSTREAM_INVALID_RESPONSE",
          error: `Automation service returned an invalid response (HTTP ${response.status}). ${UNCERTAIN_RESULT}`,
        },
      };
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export function fail(error: unknown) {
  const timeout = error instanceof Error && error.name === "AbortError";
  const invalid = error instanceof ApiContractError;
  return json(
    {
      success: false,
      code: timeout
        ? "OPERATION_TIMEOUT"
        : invalid
          ? "UPSTREAM_INVALID_RESPONSE"
          : "UPSTREAM_UNAVAILABLE",
      error: UNCERTAIN_RESULT,
    },
    timeout ? 504 : 502,
  );
}

