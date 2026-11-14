"use client";

import { useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RocketIcon, ArrowRightIcon, LockIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface ProjectItem {
  id: string;
  href: string | null;
  title: string;
  status: string;
  statusColor: string;
  businessDescription: string;
  businessHighlight: string;
  technicalDescription: string;
  technicalHighlight: string;
  stack: string[];
}

const projects: ProjectItem[] = [
  {
    id: "iam-hr-sandbox",
    href: "/iam-hr-sandbox",
    title: "IAM-HR Offboarding Sandbox",
    status: "Live (P0)",
    statusColor: "border-green-500 text-green-500",
    businessDescription:
      "Automated identity offboarding sandbox replacing error-prone 48h manual ticket chains with deterministic revocation and real-time public auditability.",
    businessHighlight:
      "Mitigates stale-credential exposure and inactive SaaS/IAM license sprawl across 7 synthetic identities with verified ledger trails.",
    technicalDescription:
      "Event-driven Next.js 16 proxy + n8n orchestrator backed by a PostgreSQL 16 singleton lock (iam_runtime), FastAPI ERP simulator, and 7 scoped GCP IAM service accounts.",
    technicalHighlight:
      "Enforces mathematical idempotency f(f(x)) = f(x), granular connector states (pending/running/succeeded/failed/unknown), and selective /resume recovery.",
    stack: ["PostgreSQL 16", "n8n", "GCP IAM", "Next.js 16", "FastAPI"],
  },
  {
    id: "finops-agent",
    href: null,
    title: "FinOps Predictive Cost Agent (Atlas)",
    status: "Roadmap (P1)",
    statusColor: "border-amber-500 text-amber-400",
    businessDescription:
      "Planned governance module to correlate multi-cloud billing telemetry with operational workload rules before monthly invoice surprises.",
    businessHighlight:
      "Currently in architectural scoping; kept read-only without simulated billing claims until live billing export connectors are validated.",
    technicalDescription:
      "Designed to ingest sanitized GCP/AWS billing exports into deterministic threshold detectors and structured LLM audit summaries.",
    technicalHighlight:
      "Scoped under constraint-driven FinOps guardrails: deterministic SQL rules first, bounded LLM context windows, and zero autonomous spend mutations.",
    stack: ["Python", "GCP Billing", "SQL", "FinOps"],
  },
];

export default function LabsPage() {
  const [isTechnicalView, setIsTechnicalView] = useState(false);

  return (
    <main className="dark flex min-h-screen w-full flex-col items-center bg-slate-950 text-slate-50 pb-12 px-6 md:px-12">
      {/* Header */}
      <header
        className="w-full max-w-7xl flex flex-col md:flex-row items-center md:items-center justify-between text-center md:text-left pb-8 gap-0"
        style={{ margin: 0, padding: "0 0 2rem 0" }}
      >
        <div className="flex justify-center md:justify-start">
          <Image
            src="/logo-ph3-light.svg"
            alt="Edge Lab Platform Logo"
            width={180}
            height={40}
          />
        </div>

        <div className="flex flex-col items-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Edge Lab Platform
          </h1>
          <p className="text-lg md:text-xl text-slate-400 mt-1">
            Enterprise Architecture &amp; IAM Portfolio
          </p>
        </div>

        <div className="hidden md:block w-[180px]" />
      </header>

      {/* View Mode Toggle */}
      <div className="flex items-center space-x-3 mb-8">
        <Label
          htmlFor="mode-switch"
          className={
            !isTechnicalView ? "font-bold text-slate-100" : "text-slate-400"
          }
        >
          Business View (What)
        </Label>
        <Switch
          id="mode-switch"
          checked={isTechnicalView}
          onCheckedChange={setIsTechnicalView}
          aria-label="Toggle between Business View and Technical View"
        />
        <Label
          htmlFor="mode-switch"
          className={
            isTechnicalView ? "font-bold text-slate-100" : "text-slate-400"
          }
        >
          Technical View (How)
        </Label>
      </div>

      {/* Project Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-stretch w-full max-w-7xl">
        {projects.map((project) => {
          const description = isTechnicalView
            ? project.technicalDescription
            : project.businessDescription;
          const highlight = isTechnicalView
            ? project.technicalHighlight
            : project.businessHighlight;

          const card = (
            <Card
              className={`bg-slate-900 border-slate-700/50 text-slate-50 flex flex-col h-full w-full transition-all duration-300 ease-in-out ${
                project.href
                  ? "hover:scale-[1.03] hover:shadow-xl hover:shadow-primary/20 hover:border-primary/50"
                  : "opacity-85 cursor-default border-dashed border-slate-800"
              }`}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{project.title}</span>
                  <Badge variant="outline" className={project.statusColor}>
                    {project.status === "Live (P0)" && (
                      <RocketIcon className="mr-1 h-3 w-3" />
                    )}
                    {project.status}
                  </Badge>
                </CardTitle>

                <CardDescription className="text-slate-400 pt-2">
                  {description}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-grow">
                <p className="text-sm text-slate-300 italic border-l-2 border-primary/50 pl-3">
                  {highlight}
                </p>
              </CardContent>

              <CardFooter className="flex justify-between items-center gap-3">
                <div className="flex flex-wrap gap-2">
                  {project.stack.map((tech) => (
                    <Badge
                      key={tech}
                      variant="secondary"
                      className="bg-slate-700 text-slate-300"
                    >
                      {tech}
                    </Badge>
                  ))}
                </div>

                {project.href ? (
                  <div className="text-primary text-sm flex items-center whitespace-nowrap">
                    Explore
                    <ArrowRightIcon className="ml-1 h-4 w-4" />
                  </div>
                ) : (
                  <div className="text-slate-500 text-xs flex items-center whitespace-nowrap">
                    <LockIcon className="mr-1 h-3.5 w-3.5" />
                    Roadmap • Read-only
                  </div>
                )}
              </CardFooter>
            </Card>
          );

          return project.href ? (
            <Link href={project.href} key={project.id} className="block h-full">
              {card}
            </Link>
          ) : (
            <div key={project.id} aria-disabled="true" className="block h-full">
              {card}
            </div>
          );
        })}
      </div>

      {/* Analytics */}
      <Analytics />
      <SpeedInsights />
    </main>
  );
}
