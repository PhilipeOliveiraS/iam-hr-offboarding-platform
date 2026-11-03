export type ConnectorStatus =
  "pending" | "running" | "succeeded" | "failed" | "unknown";

export interface ConnectorResult {
  name: "postgres" | "erp" | "gcp";
  status: ConnectorStatus;
  checks: number;
  writes: number;
  duration_ms: number;
}

export interface Operation {
  id: string;
  cycle: string;
  target_email: string;
  status: "pending" | "running" | "succeeded" | "partial" | "unknown";
  stale: boolean;
  attempts: number;
  processing_ms: number;
  connectors: ConnectorResult[];
}

export interface Employee {
  FullName: string;
  Email: string;
  Position: string;
  Status: string;
  AccessGroups: string;
  Operation: Operation | null;
}

export interface Dashboard {
  employees: Employee[];
  cycle?: string;
  busy?: boolean;
  maintenance?: boolean;
  metrics?: {
    avg_processing_ms: number | null;
    successful_count: number;
    partial_count: number;
    unknown_count: number;
    window_hours: number;
  };
}

export class ApiContractError extends Error {
  constructor(
    message = "Invalid automation response. Refresh status before retrying.",
  ) {
    super(message);
    this.name = "ApiContractError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new ApiContractError();
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function normalizeOperation(raw: unknown): Operation {
  requireContract(isRecord(raw));
  requireContract(isIdentifier(raw.id) && isIdentifier(raw.cycle));
  requireContract(
    typeof raw.target_email === "string" && typeof raw.stale === "boolean",
  );
  requireContract(
    ["pending", "running", "succeeded", "partial", "unknown"].includes(
      String(raw.status),
    ),
  );
  requireContract(isCount(raw.attempts) && isCount(raw.processing_ms));
  requireContract(Array.isArray(raw.connectors) && raw.connectors.length === 3);
  const connectors = raw.connectors.map((item) => {
    requireContract(isRecord(item));
    requireContract(["postgres", "erp", "gcp"].includes(String(item.name)));
    requireContract(
      ["pending", "running", "succeeded", "failed", "unknown"].includes(
        String(item.status),
      ),
    );
    requireContract(
      isCount(item.checks) && isCount(item.writes) && isCount(item.duration_ms),
    );
    return item as unknown as ConnectorResult;
  });
  requireContract(new Set(connectors.map((item) => item.name)).size === 3);
  requireContract(
    raw.status !== "succeeded" ||
      connectors.every((item) => item.status === "succeeded"),
  );
  return { ...raw, connectors } as unknown as Operation;
}

// Retain existing field aliases and n8n wrappers without silently dropping malformed rows.
function field(row: Record<string, unknown>, aliases: string[]): unknown {
  const canonical = (key: string) => key.toLowerCase().replace(/[\s_-]/g, "");
  for (const alias of aliases) {
    const key = Object.keys(row).find(
      (candidate) => canonical(candidate) === canonical(alias),
    );
    if (key !== undefined) return row[key];
  }
}

function textField(
  row: Record<string, unknown>,
  aliases: string[],
  fallback = "",
): string {
  const value = field(row, aliases);
  requireContract(value == null || typeof value === "string");
  return typeof value === "string" ? value.trim() : fallback;
}

export function hasRecoveryContract(dashboard: Dashboard | undefined): boolean {
  return (
    dashboard?.cycle !== undefined &&
    dashboard.metrics !== undefined &&
    typeof dashboard.busy === "boolean" &&
    typeof dashboard.maintenance === "boolean"
  );
}

export function normalizeDashboard(raw: unknown): Dashboard {
  const body = isRecord(raw) ? raw : {};
  requireContract(body.success !== false && !body.error);
  const rows = Array.isArray(raw) ? raw : (body.employees ?? body.data);
  requireContract(Array.isArray(rows));
  const recovery = ["cycle", "busy", "maintenance", "metrics"].some(
    (key) => key in body,
  );
  if (recovery) {
    requireContract(isIdentifier(body.cycle));
    requireContract(
      typeof body.busy === "boolean" && typeof body.maintenance === "boolean",
    );
    requireContract(isRecord(body.metrics));
    const metrics = body.metrics;
    requireContract(
      metrics.avg_processing_ms === null || isCount(metrics.avg_processing_ms),
    );
    requireContract(
      isCount(metrics.successful_count) &&
        isCount(metrics.partial_count) &&
        isCount(metrics.unknown_count) &&
        isCount(metrics.window_hours) &&
        metrics.window_hours > 0,
    );
    requireContract(
      metrics.successful_count === 0
        ? metrics.avg_processing_ms === null
        : metrics.avg_processing_ms !== null,
    );
  }

  const employees = rows.map((item): Employee => {
    requireContract(isRecord(item));
    const row = "json" in item ? item.json : item;
    requireContract(isRecord(row));
    const email = textField(row, ["Email", "e-mail"]).toLowerCase();
    requireContract(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const status = textField(row, ["Status", "state"], "UNKNOWN").toUpperCase();
    const rawOperation = field(row, ["Operation"]);
    requireContract(!recovery || rawOperation !== undefined);
    const operation =
      rawOperation == null ? null : normalizeOperation(rawOperation);
    if (operation) {
      requireContract(
        recovery && operation.cycle === body.cycle && !operation.stale,
      );
      requireContract(operation.target_email.toLowerCase() === email);
      const expectedStatus =
        operation.status === "succeeded"
          ? "OFFBOARDED"
          : operation.status.toUpperCase();
      requireContract(status === expectedStatus);
    }
    const groups = field(row, ["AccessGroups", "groups", "Grupos"]);
    requireContract(
      groups == null ||
        typeof groups === "string" ||
        (Array.isArray(groups) &&
          groups.every((group) => typeof group === "string")),
    );
    return {
      FullName: textField(row, ["FullName", "name", "Nome"], "Unknown"),
      Email: email,
      Position: textField(row, ["Position", "cargo"], "Employee"),
      Status: status,
      AccessGroups: Array.isArray(groups)
        ? groups.join(", ")
        : ((groups as string | undefined) ?? "Default"),
      Operation: operation,
    };
  });
  requireContract(
    new Set(employees.map((employee) => employee.Email)).size ===
      employees.length,
  );
  return recovery
    ? {
        employees,
        cycle: body.cycle as string,
        busy: body.busy as boolean,
        maintenance: body.maintenance as boolean,
        metrics: body.metrics as Dashboard["metrics"],
      }
    : { employees };
}

export function normalizeOffboarding(
  raw: unknown,
  targetEmail: string,
): Dashboard {
  requireContract(isRecord(raw));
  const operation = normalizeOperation(raw.operation);
  const dashboard = normalizeDashboard(raw.dashboard);
  requireContract(hasRecoveryContract(dashboard));
  requireContract(
    operation.target_email.toLowerCase() === targetEmail.toLowerCase(),
  );
  requireContract(
    raw.success === (operation.status === "succeeded" && !operation.stale),
  );
  const snapshot = dashboard.employees.find(
    (employee) => employee.Email === targetEmail.toLowerCase(),
  )?.Operation;
  requireContract(
    snapshot &&
      snapshot.id === operation.id &&
      snapshot.cycle === operation.cycle &&
      snapshot.status === operation.status &&
      snapshot.attempts === operation.attempts,
  );
  return dashboard;
}

export async function readApiResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new ApiContractError(
      `Service returned an invalid response (HTTP ${response.status}). Check status before retrying.`,
    );
  }
  requireContract(isRecord(data));
  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : typeof data.code === "string"
          ? data.code
          : `Request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return data;
}
