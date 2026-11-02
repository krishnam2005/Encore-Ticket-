import type { ActivityEntry } from "@/lib/api-client";
import { isApiErrorBody, type WebhookAck } from "@/lib/api-types";
import { describeOutcome } from "@/lib/outcomes";
import { JsonBlock } from "./JsonBlock";
import { Alert, Badge, statusTone } from "./ui";

function isWebhookAck(v: unknown): v is WebhookAck {
  return typeof v === "object" && v !== null && "outcome" in v && "status" in v && "received" in v;
}

/** Shows exactly what the backend answered for one call: status, interpreted outcome or error, raw JSON. */
export function CallResult({ entry }: { entry: Omit<ActivityEntry, "id"> }) {
  const { status, responseBody, networkError } = entry;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Badge tone={statusTone(status)}>{status === null ? "No response" : `HTTP ${status}`}</Badge>
        <span className="font-mono">
          {entry.method} {entry.path}
        </span>
        <span>· {entry.durationMs} ms</span>
      </div>

      {networkError && (
        <Alert tone="bad" title="Network error: the request did not reach the API">
          {networkError}. Check that the API is running and that NEXT_PUBLIC_API_BASE_URL is correct (a different origin also needs CORS).
        </Alert>
      )}

      {isApiErrorBody(responseBody) && (
        <Alert tone={status !== null && status >= 500 ? "bad" : "warn"} title={`${responseBody.error.code}: ${responseBody.error.message}`}>
          {responseBody.error.details && (
            <pre className="mt-1 overflow-auto font-mono text-xs">{JSON.stringify(responseBody.error.details, null, 2)}</pre>
          )}
        </Alert>
      )}

      {isWebhookAck(responseBody) && <OutcomeAlert ack={responseBody} />}

      <JsonBlock label="Response" value={responseBody} defaultOpen />
      <JsonBlock label="Request" value={entry.requestBody} />
    </div>
  );
}

function OutcomeAlert({ ack }: { ack: WebhookAck }) {
  const info = describeOutcome(ack.outcome);
  const tone = info.tone === "good" ? "good" : info.tone === "warn" ? "warn" : info.tone === "bad" ? "bad" : "info";
  return (
    <Alert tone={tone} title={info.title}>
      <p>{info.detail}</p>
      <p className="mt-1 font-mono text-xs opacity-80">
        status={ack.status} · outcome={ack.outcome}
      </p>
    </Alert>
  );
}
