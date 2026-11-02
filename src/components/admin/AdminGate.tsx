"use client";

import { KeyRound, Lock, LogOut, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MetricsResponse } from "@/lib/admin-types";
import { useApi } from "@/lib/api-context";
import { Alert, Button, Card, Field, Input, type Tone } from "../ui";

interface Problem {
  tone: Tone;
  title: string;
  message: string;
}

/** Shows the token form until a token has been verified; afterwards renders the page with a session bar. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { adminToken, setAdminToken } = useApi();

  if (!adminToken) return <TokenForm />;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm text-emerald-900">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">Admin session active.</span>{" "}
            <span className="text-emerald-800/80">Token is held in memory only and is lost on reload.</span>
          </span>
        </p>
        <Button variant="secondary" onClick={() => setAdminToken(null)} icon={<LogOut className="size-4" aria-hidden />}>
          Clear token
        </Button>
      </div>
      {children}
    </>
  );
}

function TokenForm() {
  const { request, setAdminToken, adminAuthNotice } = useApi();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function unlock() {
    const candidate = token.trim();
    if (candidate === "") return;
    setBusy(true);
    setProblem(null);
    // Verify against a real admin endpoint before accepting the token.
    const res = await request<MetricsResponse>("GET", "/admin/metrics", undefined, {
      authorization: `Bearer ${candidate}`,
    });
    const status = res.entry.status;
    if (res.data) {
      setAdminToken(candidate);
      setToken("");
    } else if (status === 401) {
      setProblem({ tone: "bad", title: "Invalid token", message: "The server rejected that token (HTTP 401). Check it and try again." });
    } else if (status === 404) {
      setProblem({
        tone: "warn",
        title: "Admin API is disabled on this server",
        message: "The server answered 404: ADMIN_TOKEN is not set there, so /admin/* does not exist. Set it in the server environment and restart or redeploy.",
      });
    } else if (status === null) {
      setProblem({ tone: "bad", title: "Could not reach the API", message: res.entry.networkError ?? "Network error." });
    } else {
      setProblem({ tone: "bad", title: `Unexpected response (HTTP ${status})`, message: res.error?.message ?? "Try again." });
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-8 max-w-md">
      <Card>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Lock className="size-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Admin access</h2>
            <p className="text-xs text-zinc-500">Enter the server&apos;s ADMIN_TOKEN to unlock metrics and audit.</p>
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          {adminAuthNotice && !problem && <Alert tone="warn" title="Signed out">{adminAuthNotice}</Alert>}
          {problem && <Alert tone={problem.tone} title={problem.title}>{problem.message}</Alert>}

          <Field label="Admin token" hint="Sent as “Authorization: Bearer …”. Kept in memory only: never stored, lost on reload.">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token"
              className="font-mono"
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={token.trim() === ""} icon={<KeyRound className="size-4" aria-hidden />} className="w-full">
            Unlock admin
          </Button>
        </form>
      </Card>
    </div>
  );
}
