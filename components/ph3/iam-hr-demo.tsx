"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  Wrench,
  Loader2,
  CheckCircle,
  ShieldAlert,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  normalizeOffboarding,
  readApiResponse,
  type Dashboard,
  type Employee,
  type Operation,
} from "@/lib/iam-hr";

const API_BASE = "/api/iam-hr";

interface IamHrDemoProps {
  employees: Employee[];
  isLoading: boolean;
  busy?: boolean;
  maintenance?: boolean;
  readOnly?: boolean;
}

export function IamHrDemo({
  employees,
  isLoading,
  busy = false,
  maintenance = false,
  readOnly = false,
}: IamHrDemoProps) {
  const { mutate } = useSWRConfig();
  const [selectedEmail, setSelectedEmail] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const selectedEmployee = employees.find(
    (employee) => employee.Email === selectedEmail,
  );
  const operation = selectedEmployee?.Operation;
  const offboardingComplete =
    operation?.status === "succeeded" && !operation.stale;
  const blocked = isLoading || readOnly || busy || maintenance;
  const canExecute =
    selectedEmployee &&
    !blocked &&
    !isProcessing &&
    !offboardingComplete &&
    !operation?.stale &&
    operation?.status !== "running" &&
    (operation || selectedEmployee.Status === "ACTIVE");
  const targets = employees.filter(
    (employee) => employee.Status === "ACTIVE" || employee.Operation,
  );

  function chooseEmployee(email: string) {
    setSelectedEmail(email);
    setStatusMsg("");
  }

  async function handleOffboarding() {
    if (!canExecute || !selectedEmployee) return;
    setIsProcessing(true);
    setStatusMsg("");
    try {
      // Commit one confirmed snapshot to the same cache used by the table and metrics.
      // SWR discards older in-flight GET results when this mutation completes.
      await mutate<Dashboard>(
        API_BASE,
        async () => {
          const response = await fetch(`${API_BASE}/action?type=offboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target_email: selectedEmployee.Email,
              operation_id: operation?.id ?? null,
            }),
          });
          return normalizeOffboarding(
            await readApiResponse(response),
            selectedEmployee.Email,
          );
        },
        { populateCache: true, revalidate: false },
      );
    } catch (error) {
      setStatusMsg(
        error instanceof Error
          ? error.message
          : "Request could not be confirmed. Refresh status before retrying.",
      );
      // A timeout does not cancel a remote operation. Reconcile by reading its status.
      await mutate(API_BASE).catch(() => undefined);
    } finally {
      setIsProcessing(false);
    }
  }

  const feedback = statusMsg && (
    <div
      role="alert"
      className="flex items-center gap-2 text-xs p-3 rounded border bg-amber-500/10 text-amber-300 border-amber-500/20"
    >
      <ShieldAlert className="h-4 w-4 flex-shrink-0" />
      {statusMsg}
    </div>
  );

  if (offboardingComplete && operation) {
    return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="p-6 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-12 w-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-emerald-400" />
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-emerald-400">
              ✅ Access Revoked Successfully
            </h3>
            <p className="text-sm text-slate-400 mt-2">
              Employee <strong>{selectedEmployee?.FullName}</strong> has been
              offboarded.
              <br />
              <span className="text-xs">
                All connectors confirmed • Audit logs updated
              </span>
            </p>
          </div>
          <ConnectorResults operation={operation} />
          <p className="text-sm text-slate-400">
            Public handover delivery is disabled pending persistent abuse controls.
          </p>
          {feedback}
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white hover:bg-slate-800/50"
            onClick={() => chooseEmployee("")}
          >
            Start New Demo <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-5 bg-slate-950/50 border border-slate-800 rounded-xl shadow-sm">
        <div className="flex flex-col space-y-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/10 rounded-md border border-blue-500/20">
              <Wrench className="h-4 w-4 text-blue-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200 tracking-tight">
              🚀 Execute Offboarding Protocol
            </h3>
          </div>
          {(maintenance || busy) && (
            <p role="status" className="text-sm text-amber-300">
              {maintenance
                ? "Demo reset is pending. Operations are temporarily paused."
                : "Another operation is running. Waiting for its confirmed result."}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              aria-label="Employee to offboard or resume"
              autoComplete="off"
              value={selectedEmail}
              onChange={(event) => chooseEmployee(event.target.value)}
              disabled={isProcessing || isLoading}
              className="flex-1 min-w-0 rounded-md border bg-slate-900 border-slate-700 text-slate-200 focus:ring-blue-500 h-10 px-3 text-sm"
            >
              <option value="">
                {isLoading
                  ? "Loading employees..."
                  : "Select employee to offboard..."}
              </option>
              {targets.map((employee) => (
                <option key={employee.Email} value={employee.Email}>
                  {employee.FullName} ({employee.Email}) — {employee.Status}
                </option>
              ))}
            </select>
            <Button
              onClick={handleOffboarding}
              disabled={!canExecute}
              className={`h-10 px-6 font-medium transition-all duration-200 shadow-lg ${
                !canExecute
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20 hover:shadow-blue-900/40"
              }`}
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : operation ? (
                <RotateCcw className="mr-2 h-4 w-4" />
              ) : (
                <Wrench className="mr-2 h-4 w-4" />
              )}
              {isProcessing
                ? "Processing..."
                : operation?.status === "running"
                  ? "Processing..."
                  : operation?.status === "unknown"
                    ? "Check uncertain result"
                    : operation
                      ? "Resume pending connectors"
                      : "Execute"}
            </Button>
          </div>
          {targets.length === 0 && !isLoading && (
            <p className="text-sm text-slate-500 italic">
              No available employees found.
            </p>
          )}
          {operation && (
            <section
              aria-live="polite"
              className="p-5 rounded-xl border border-amber-500/30 bg-amber-950/20 space-y-3"
            >
              <h3 className="font-semibold text-amber-300">
                {operation.status === "running"
                  ? "Offboarding in progress"
                  : operation.status === "unknown"
                    ? "Result requires verification"
                    : "Offboarding partially completed"}
              </h3>
              <p className="text-sm text-slate-400">
                {selectedEmployee?.FullName}
              </p>
              <ConnectorResults operation={operation} />
              {operation.status === "unknown" && (
                <p className="text-xs text-amber-200">
                  A request outcome is uncertain. Checking reads the remote
                  state without repeating the write. Operator review may be
                  required.
                </p>
              )}
            </section>
          )}
          {feedback}
        </div>
      </div>
    </div>
  );
}

function ConnectorResults({ operation }: { operation: Operation }) {
  const names = {
    postgres: "Employee record",
    erp: "ERP mock",
    gcp: "GCP IAM (synthetic employee identity)",
  };
  return (
    <div className="text-left space-y-2">
      <p className="text-xs text-slate-400">
        Operation {operation.id} · Attempt {operation.attempts} ·{" "}
        {(operation.processing_ms / 1000).toFixed(2)}s processing
      </p>
      <ul className="space-y-2 text-sm">
        {operation.connectors.map((connector) => (
          <li
            key={connector.name}
            className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800/50 pb-2"
          >
            <span className="text-slate-300">{names[connector.name]}</span>
            <span
              className={
                connector.status === "succeeded"
                  ? "text-emerald-400"
                  : "text-amber-300"
              }
            >
              {connector.status} · {(connector.duration_ms / 1000).toFixed(2)}s
              · {connector.writes} write attempt(s)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
