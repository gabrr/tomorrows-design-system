import { checkQuote } from "./quote-logic";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../../domain/types";
import { clone, priceReason, priceText } from "../../domain/evidence.js";
import { api, write } from "../../services/api";
import { workspace, useWorkspace } from "../../workspace/store";
import { Action, DataGrid, Disclosure, Input, Message, Select } from "../../ui";
import {
  Changes,
  SourceLink,
  errorText,
  guard,
  validateProposal,
} from "./review";
type RecordData = {
  id: string;
  provider: string;
  label?: string;
  source?: string;
  retrieved_at?: string;
  [key: string]: any;
};
type Cache = {
  records: RecordData[];
  snapshots: RecordData[];
  providers?: Array<{
    id: string;
    requires_key?: boolean;
    live?: boolean;
    source?: string;
  }>;
  warnings?: string[];
};
export function Pricing() {
  const state = useWorkspace();
  const [session] = useState(() => ({
    fence: workspace.fence(),
    before: clone(workspace.get().project) as Project,
  }));
  const [cache, setCache] = useState<Cache>({ records: [], snapshots: [] }),
    [target, setTarget] = useState(() =>
      state.selected?.kind === "node"
        ? state.selected.id
        : session.before.nodes[0]?.id || "",
    ),
    [provider, setProvider] = useState("all"),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0),
    [refreshProvider, setRefreshProvider] = useState("openrouter"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Loading cached records…"),
    [review, setReview] = useState<{
      proposal: Project;
      record: RecordData;
      version: number;
    } | null>(null);
  const version = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void load(false);
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  function invalidate() {
    version.current++;
    setReview(null);
  }
  async function load(refresh: boolean) {
    invalidate();
    setBusy(true);
    setError("");
    try {
      if (refresh)
        await write("/api/pricing/refresh", { provider: refreshProvider });
      const data = await api("/api/pricing");
      if (
        !Array.isArray(data.records) ||
        data.records.some(
          (r: RecordData) =>
            !r ||
            typeof r !== "object" ||
            Array.isArray(r) ||
            typeof r.id !== "string" ||
            typeof r.provider !== "string",
        ) ||
        (data.snapshots != null &&
          (!Array.isArray(data.snapshots) ||
            data.snapshots.some(
              (s: RecordData) => !s || typeof s.provider !== "string",
            ))) ||
        (data.providers != null &&
          (!Array.isArray(data.providers) ||
            data.providers.some(
              (p: { id: string }) => !p || typeof p.id !== "string",
            )))
      )
        throw new Error("Pricing cache has invalid records or snapshots.");
      if (alive.current) {
        setCache({ ...data, snapshots: data.snapshots || [] });
        setStatus(
          "Cached published records loaded. Source correctness has not been independently verified.",
        );
      }
    } catch (e) {
      if (alive.current) {
        setError(
          (refresh
            ? "Refresh failed; cached records remain available. "
            : "Pricing unavailable. ") + errorText(e),
        );
        setStatus("Retained cached prices may still be reviewed.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function quote(record: RecordData) {
    const request = ++version.current,
      current = () => alive.current && request === version.current;
    setReview(null);
    setError("");
    setBusy(true);
    try {
      guard(session.fence, current);
      const reason = priceReason(record);
      if (reason) throw new Error(reason);
      if (!target) throw new Error("Choose a target component.");
      const data = await write("/api/pricing/apply", {
        project: session.before,
        node_id: target,
        provider: record.provider,
        record_id: record.id,
      });
      guard(session.fence, current);
      await validateProposal(data.project, session.fence, current);
      guard(session.fence, current);
      checkQuote(session.before, data.project, record, data.record, target);
      setReview({ proposal: clone(data.project), record, version: request });
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const matches = cache.records.filter(
    (r) =>
      (provider === "all" || r.provider === provider) &&
      JSON.stringify(r).toLowerCase().includes(term.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matches.length / 40)),
    currentPage = Math.min(page, pages - 1);
  const providers = [
    ...new Set([
      "openrouter",
      "aws",
      "gcp",
      "azure",
      "openai",
      "anthropic",
      "google",
      ...cache.records.map((r) => r.provider),
      ...(cache.providers || []).map((p) => p.id),
    ]),
  ];
  const stale = !workspace.isCurrent(session.fence);
  return (
    <div className="utility-stack">
      <Message text="Cached published rates are evidence, not a cost forecast. Public catalog prices do not represent private account quotas, discounts or negotiated rates." />
      {stale && (
        <Message
          error
          text="The workspace changed. Close and reopen pricing to review this revision."
        />
      )}
      <Select
        label="Apply to component"
        value={target}
        options={session.before.nodes.map((n) => ({
          value: n.id,
          label: `${n.label} (${n.id})`,
        }))}
        presentation="popover"
        onChange={(v) => {
          setTarget(v);
          invalidate();
        }}
      />
      <div className="utility-fields">
        <Input
          label="Search all cached records"
          type="search"
          value={term}
          onChange={(v) => {
            setTerm(v);
            setPage(0);
          }}
          hasClear
        />
        <Select
          label="Filter provider"
          value={provider}
          onChange={(v) => {
            setProvider(v);
            setPage(0);
          }}
          presentation="popover"
          options={[
            { value: "all", label: "All providers" },
            ...providers.map((value) => ({ value, label: value })),
          ]}
        />
      </div>
      <Message text={status} />
      {error && <Message error text={error} />}
      <Disclosure title="Provider cache and provenance">
        {cache.snapshots.map((s, i) => (
          <div key={i}>
            {s.provider} · retrieved {s.retrieved_at || "not recorded"}
            {s.partial ? " · partial catalog" : ""} ·{" "}
            <SourceLink source={s.source} />
            <pre>{JSON.stringify(s, null, 2)}</pre>
          </div>
        ))}
        {cache.providers?.map((p) => (
          <p key={p.id}>
            {p.id}:{" "}
            {p.requires_key
              ? "Server API key required (paid provider access may apply)"
              : p.live
                ? "Public refresh supported"
                : "Manual rates / refresh unavailable"}{" "}
            · <SourceLink source={p.source} />
          </p>
        ))}
        {cache.warnings?.map((w, i) => (
          <Message key={i} text={w} />
        ))}
      </Disclosure>
      <DataGrid
        label="Cached published rates and exact units"
        columns={[
          "Model / SKU / region",
          "Rate / currency / unit",
          "Source / retrieval",
          "Review",
        ]}
        rows={matches
          .slice(currentPage * 40, (currentPage + 1) * 40)
          .map((r) => {
            const snapshot = cache.snapshots.find(
                (s) => s.provider === r.provider,
              ),
              reason = priceReason(r);
            return [
              <div>
                {r.label || r.id}
                <p>
                  {r.provider} · {r.sku || r.id} ·{" "}
                  {r.region ||
                    (r.regions || []).join(", ") ||
                    "Region not supplied"}
                </p>
              </div>,
              <div className="utility-preserve">{priceText(r)}</div>,
              <div>
                {r.retrieved_at ||
                  snapshot?.retrieved_at ||
                  "Retrieval time not supplied"}
                <p>
                  <SourceLink source={r.source || snapshot?.source} />
                </p>
              </div>,
              <div>
                {reason && <Message text={reason} />}
                <Action
                  label={`Review ${r.label || r.id}`}
                  disabled={!!reason || !target || busy || stale}
                  onClick={() => {
                    void quote(r);
                  }}
                />
              </div>,
            ];
          })}
      />
      {!matches.length && (
        <Message
          text={
            cache.records.length
              ? "No matches. Clear filters to inspect all cached prices."
              : "No cached prices available. Refresh a supported provider or keep explicitly estimated manual rates."
          }
        />
      )}
      <p>
        {matches.length} matching / {cache.records.length} cached · page{" "}
        {currentPage + 1} of {pages}
      </p>
      <div className="utility-actions">
        <Action
          label="Previous page"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        />
        <Action
          label="Next page"
          disabled={currentPage >= pages - 1}
          onClick={() => setPage(currentPage + 1)}
        />
        <Action
          label="Clear filters"
          onClick={() => {
            setTerm("");
            setProvider("all");
            setPage(0);
          }}
        />
      </div>
      <Select
        label="Provider to refresh"
        value={refreshProvider}
        onChange={setRefreshProvider}
        options={providers}
        presentation="popover"
      />
      <div className="utility-actions">
        <Action
          label="Refresh cached prices"
          busy={busy}
          action={() => load(true)}
        />
        <Action
          label="Reload cached prices"
          disabled={busy}
          action={() => load(false)}
        />
      </div>
      {review && (
        <section className="utility-review">
          <strong>
            Review price for{" "}
            {session.before.nodes.find((n) => n.id === target)?.label}
          </strong>
          <p className="utility-preserve">{priceText(review.record)}</p>
          <Message
            text={`Monthly assumptions: ${session.before.monthly.hours} hours; traffic multiplier ${session.before.monthly.traffic_multiplier}. Unchanged rates remain estimates. Review every changed field below.`}
          />
          <Changes before={session.before} after={review.proposal} />
          <div className="utility-actions">
            <Action label="Cancel rate review" onClick={invalidate} />
            <Action
              label="Apply reviewed price"
              variant="primary"
              disabled={stale || busy}
              action={async () => {
                try {
                  guard(
                    session.fence,
                    () => alive.current && version.current === review.version,
                  );
                  workspace.apply(
                    review.proposal,
                    session.fence,
                    "Apply reviewed pricing",
                  );
                  invalidate();
                  workspace.set({ modal: null });
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
