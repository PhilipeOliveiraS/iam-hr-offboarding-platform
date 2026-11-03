"use client";

import useSWR from "swr";
import {
  hasRecoveryContract,
  normalizeDashboard,
  readApiResponse,
  type Dashboard,
} from "@/lib/iam-hr";

import Link from "next/link";
import {
  Shield,
  Users,
  Activity,
  Settings,
  Home,
  Clock,
  CheckCircle2,
  XCircle,
  Lock,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IamHrDemo } from "@/components/ph3/iam-hr-demo";

// --- DATA FETCHING LAYER ---
const fetcher = async (url: string): Promise<Dashboard> => {
  const response = await fetch(url, { cache: "no-store" });
  return normalizeDashboard(await readApiResponse(response));
};

export default function IamHrSandboxPage() {
  // Connect to Internal Proxy
  const { data, error, isLoading } = useSWR<Dashboard>("/api/iam-hr", fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const employees = data?.employees || [];
  const recoveryReady = hasRecoveryContract(data);
  const readOnly = !recoveryReady || Boolean(error);

  // Business Logic / Metrics
  const totalUsers = employees.length;
  const activeUsers = employees.filter((e) => e.Status === "ACTIVE").length;
  const revokedUsers = employees.filter(
    (e) => e.Status === "OFFBOARDED",
  ).length;

  return (
    <main className="dark flex min-h-screen w-full bg-slate-950 text-slate-50 font-sans selection:bg-blue-500/30">
      {/* ENTERPRISE SIDEBAR */}
      <aside className="hidden md:flex w-72 flex-col border-r border-slate-800 bg-slate-900/40 backdrop-blur-xl p-6">
        <div className="mb-10">
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="p-2 bg-blue-600/10 rounded-lg border border-blue-600/20">
              <Shield className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-slate-100">
                IAM Secure
              </h1>
              <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">
                Enterprise Sandbox
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 space-y-1.5">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-3">
            Platform
          </div>

          <NavItem icon={Home} label="Dashboard" active />
          <NavItem icon={Activity} label="Identity Lifecycle" />
          <NavItem icon={Users} label="Directory" />
          <NavItem icon={Lock} label="Access Policies" />

          <div className="mt-8 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-3">
            Resources
          </div>
          <NavItem icon={FileText} label="Audit Logs" />
          <NavItem icon={Settings} label="Settings" />
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-800/50">
          <div className="flex items-center gap-3 px-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold">
              PO
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                Philipe Oliveira
              </p>
              <p className="text-xs text-slate-500">Admin Access</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col bg-gradient-to-b from-slate-950 to-slate-900">
        {/* TOP HEADER */}
        <header className="border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md px-8 py-5 flex items-center justify-between sticky top-0 z-50">
          <div>
            <h2 className="text-2xl font-semibold text-slate-100 tracking-tight">
              Offboarding Workflow
            </h2>
            <p className="text-sm text-slate-400">
              Automated identity provisioning and revocation.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Badge
              variant="outline"
              className="border-emerald-500/20 text-emerald-400 bg-emerald-500/5 px-3 py-1"
            >
              <CheckCircle2 className="w-3 h-3 mr-2" />
              {error
                ? "Status Unavailable"
                : isLoading
                  ? "Loading Status"
                  : !recoveryReady
                    ? "Read Only"
                    : data?.maintenance
                      ? "Reset Pending"
                      : data?.busy
                        ? "Operation Running"
                        : "System Operational"}
            </Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {error && (
            <p role="alert" className="text-amber-300">
              Dashboard refresh failed. Displayed data may be stale; actions are
              paused.
            </p>
          )}
          {data && !recoveryReady && (
            <p role="status" className="text-amber-300">
              Operation tracking is unavailable. Actions are paused until the
              service is ready.
            </p>
          )}
          {/* KPI METRICS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <MetricCard
              title="Total Identities"
              value={isLoading ? "-" : totalUsers}
              icon={Users}
            />
            <MetricCard
              title="Active Access"
              value={isLoading ? "-" : activeUsers}
              icon={CheckCircle2}
              color="text-emerald-500"
            />
            <MetricCard
              title="Revoked (current cycle)"
              value={isLoading ? "-" : revokedUsers}
              icon={XCircle}
              color="text-red-500"
            />
            <MetricCard
              title="Avg. Processing"
              value={
                data?.metrics?.avg_processing_ms == null
                  ? "—"
                  : `${(data.metrics.avg_processing_ms / 1000).toFixed(2)}s`
              }
              icon={Clock}
              color="text-blue-500"
              sub={`vs 48h manual · ${data?.metrics?.successful_count ?? 0} successful operations / ${data?.metrics?.window_hours ?? 24}h`}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* LEFT: ACTION CONSOLE */}
            <div className="xl:col-span-2 space-y-6">
              <Card className="bg-slate-900/40 border-slate-800 shadow-xl">
                <CardHeader>
                  <CardTitle className="text-lg">Live Operations</CardTitle>
                  <CardDescription>
                    Execute immediate workflow actions. All events are logged.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <IamHrDemo
                    employees={employees}
                    isLoading={isLoading}
                    busy={data?.busy}
                    maintenance={data?.maintenance}
                    readOnly={readOnly}
                  />
                </CardContent>
              </Card>

              {/* LIVE TABLE */}
              <Card className="bg-slate-900/40 border-slate-800 shadow-xl overflow-hidden">
                <CardHeader className="border-b border-slate-800/50 bg-slate-900/20">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Identity Directory
                    </CardTitle>
                    <span className="text-xs text-slate-500 font-mono">
                      SOURCE: POSTGRES + CONNECTOR RESULTS
                    </span>
                  </div>
                </CardHeader>
                <div className="p-0">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-950/50 font-medium">
                      <tr>
                        <th className="px-6 py-3">User Identity</th>
                        <th className="px-6 py-3">Role</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 text-right">Access Groups</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {employees.length === 0 && !isLoading ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="text-center py-8 text-slate-500"
                          >
                            No records found.
                          </td>
                        </tr>
                      ) : (
                        employees.map((emp) => (
                          <tr
                            key={emp.Email}
                            className="hover:bg-slate-800/30 transition-colors"
                          >
                            <td className="px-6 py-4 font-medium text-slate-200">
                              <div>{emp.FullName}</div>
                              <div className="text-xs text-slate-500 font-normal">
                                {emp.Email}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-slate-400">
                              {emp.Position}
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={emp.Status} />
                            </td>
                            <td className="px-6 py-4 text-right text-slate-500 font-mono text-xs">
                              {emp.AccessGroups || "Default"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* RIGHT: INFO / HELP */}
            <div className="space-y-6">
              <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wider text-slate-500">
                    Workflow Architecture
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 rounded bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-2">
                    <div className="flex justify-between">
                      <span>Orchestrator:</span>{" "}
                      <span className="text-slate-200">N8N (Self-Hosted)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Identity Provider:</span>{" "}
                      <span className="text-slate-200">
                        GCP IAM (demo service account)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Infrastructure:</span>{" "}
                      <span className="text-slate-200">Docker / Cortex-01</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    This module demonstrates an event-driven architecture for
                    IAM (Identity & Access Management). Connector outcomes are
                    recorded separately. Failed operations can resume within the
                    same demo cycle.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// --- UI HELPERS ---

function NavItem({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-all ${active ? "bg-blue-600/10 text-blue-500" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"}`}
    >
      <Icon className="h-4 w-4" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  color,
  sub,
}: {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  sub?: string;
}) {
  return (
    <Card className="bg-slate-900/40 border-slate-800 shadow-lg">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-slate-400">{title}</span>
          <Icon className={`h-4 w-4 ${color || "text-slate-500"}`} />
        </div>
        <div className="text-3xl font-bold text-slate-100">{value}</div>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    OFFBOARDED: "text-red-400 bg-red-500/10 border-red-500/20",
    PENDING: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    RUNNING: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    PARTIAL: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    UNKNOWN: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  };
  const style = styles[status] || styles.UNKNOWN;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {status}
    </span>
  );
}
