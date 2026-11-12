import { Link } from "@astryxdesign/core/Link";
import type { Project } from "../../domain/types";
import { projectChanges } from "../../domain/evidence.js";
import { Disclosure } from "../../ui";
import { summarizeProposal } from "../../domain/proposals";
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export { guard, validateProposal } from "./review-logic";
export function Changes({
  before,
  after,
}: {
  before: Project;
  after: Project;
}) {
  const changes = projectChanges(before, after) as string[];
  return (
    <>
      <div className="proposal-summary" aria-label="Proposed change summary">
        <strong>Before → proposed</strong>
        <p>
          Summary of proposed changes. Expand the complete diff below for every
          setting before applying.
        </p>
        <ul>
          {summarizeProposal(before, after).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <Disclosure
        title={`Complete before/after diff (${changes.length} details)`}
      >
        <ul>
          {(changes.length
            ? changes
            : ["No architecture, scenario or monthly assumption changes."]
          ).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure title="Optional complete proposal JSON">
        <pre>{JSON.stringify(after, null, 2)}</pre>
      </Disclosure>
    </>
  );
}
export function SourceLink({ source }: { source: unknown }) {
  if (typeof source !== "string") return null;
  try {
    const url = new URL(source);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return (
      <Link href={url.href} isExternalLink>
        Published source
      </Link>
    );
  } catch {
    return null;
  }
}
