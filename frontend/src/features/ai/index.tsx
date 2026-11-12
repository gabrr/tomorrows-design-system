import { useEffect, useRef, useState } from "react";
import { Mic, MessageSquare, X } from "lucide-react";
import type { Fence, Project } from "../../domain/types";
import { clone } from "../../domain/evidence.js";
import { write } from "../../services/api";
import { useWorkspace, workspace } from "../../workspace/store";
import {
  Action,
  Area,
  Badge,
  Card,
  Disclosure,
  IconAction,
  Message,
} from "../../ui";
import {
  Changes,
  errorText,
  guard,
  validateProposal,
} from "../utilities/review";
import { useDictation } from "./voice";
import { buildPrompt } from "./intent";
import { reviewStatus } from "../../domain/proposals";
import "./ai.css";
type Entry = {
  role: "user" | "assistant";
  text: string;
  warnings?: string[];
  review?: {
    proposal: Project;
    before: Project;
    fence: Fence;
    generation: number;
    applied?: boolean;
  };
};
export function AIWorkspace() {
  const state = useWorkspace();
  const [prompt, setPrompt] = useState(""),
    [thread, setThread] = useState<Entry[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLElement>(null);
  const followLatest = useRef(true);
  const scrollPosition = useRef(0);
  const wasOpen = useRef(false);
  const previousThread = useRef(thread);
  const [unseen, setUnseen] = useState(false);
  function closeConversation(composer = false) {
    setOpen(false);
    requestAnimationFrame(() => {
      if (workspace.get().modal) return;
      const target = composer
        ? root.current?.querySelector<HTMLTextAreaElement>("textarea")
        : document.getElementById("ai-conversation-toggle");
      target?.focus();
    });
  }
  function showLatest() {
    if (messages.current && latest.current) {
      messages.current.scrollTop +=
        latest.current.getBoundingClientRect().top -
        messages.current.getBoundingClientRect().top;
    }
    const el = messages.current;
    followLatest.current =
      !el || el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    setUnseen(false);
  }
  useEffect(() => {
    const reopening = open && !wasOpen.current;
    const changed = previousThread.current !== thread;
    wasOpen.current = open;
    previousThread.current = thread;
    if (!open) {
      if (changed && thread.length) setUnseen(true);
      return;
    }
    if (reopening && !followLatest.current && messages.current) {
      messages.current.scrollTop = scrollPosition.current;
      return;
    }
    if (followLatest.current && messages.current) {
      if (thread[thread.length - 1]?.review && latest.current) {
        messages.current.scrollTop +=
          latest.current.getBoundingClientRect().top -
          messages.current.getBoundingClientRect().top;
      } else messages.current.scrollTop = messages.current.scrollHeight;
      setUnseen(false);
    } else if (changed) setUnseen(true);
  }, [thread, open]);
  const generation = useRef(0),
    mounted = useRef(true),
    pending = useRef<Entry["review"]>(undefined),
    refinement = useRef<{ proposal: Project; fence: Fence } | undefined>(
      undefined,
    ),
    promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => {
    workspace.set({ aiReviewOpen: open });
  }, [open]);
  const voice = useDictation(state.identity, (text) =>
    setPrompt((value) =>
      [value.trim(), text].filter(Boolean).join(" ").slice(0, 9999),
    ),
  );
  useEffect(() => {
    if (state.panel === "inspector" && open) {
      setOpen(false);
      requestAnimationFrame(() =>
        document.getElementById("inspector-heading")?.focus(),
      );
    }
  }, [state.panel, open]);
  useEffect(() => {
    generation.current++;
    pending.current = undefined;
    refinement.current = undefined;
    followLatest.current = true;
    scrollPosition.current = 0;
    setUnseen(false);
    setThread([]);
    setPrompt("");
    setBusy(false);
    setError("");
    setOpen(false);
  }, [state.identity]);
  useEffect(() => {
    mounted.current = true;
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !workspace.get().modal &&
        !workspace.get().gestureActive &&
        root.current?.contains(e.target as Node)
      ) {
        closeConversation();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      mounted.current = false;
      generation.current++;
      window.removeEventListener("keydown", escape);
    };
  }, []);
  // Conversation updates must be urgent. Astryx clickAction wraps work in a
  // transition, which can defer local state behind synchronous workspace edits.
  async function submit(value: string) {
    if (busy) return;
    if (workspace.get().modal || workspace.get().gestureActive) {
      setError(
        "Finish the active dialog or canvas gesture before requesting a proposal.",
      );
      return;
    }
    voice.stop();
    const intent = value.trim();
    if (!intent || intent.length >= 10000) {
      setError("Enter a request shorter than 10,000 characters.");
      return;
    }
    const fence = workspace.fence(),
      before = clone(workspace.get().project) as Project,
      prior = pending.current;
    const input =
      prior &&
      prior.generation === generation.current &&
      workspace.isCurrent(prior.fence)
        ? clone(prior.proposal)
        : refinement.current && workspace.isCurrent(refinement.current.fence)
          ? clone(refinement.current.proposal)
          : before;
    // Retain the complete draft base if a follow-up fails or is cancelled.
    // It never grants an Apply token and expires on a workspace revision.
    refinement.current = { proposal: clone(input), fence };
    const request = ++generation.current,
      current = () => mounted.current && generation.current === request;
    pending.current = undefined;
    setBusy(true);
    workspace.set({ panel: null });
    setOpen(true);
    setError("");
    setThread((t) => [...t, { role: "user", text: intent }]);
    try {
      const boundedPrompt = buildPrompt(intent, thread);
      // Only architecture and bounded conversation are sent, without run telemetry.
      guard(fence, current);
      const data = await write("/api/ai/generate", {
        prompt: boundedPrompt,
        project: input,
        provider: "codex",
      });
      guard(fence, current);
      await validateProposal(data.proposal, fence, current);
      guard(fence, current);
      const review = {
        proposal: clone(data.proposal),
        before,
        fence,
        generation: request,
      };
      pending.current = review;
      refinement.current = review;
      setThread((t) => [
        ...t,
        {
          role: "assistant",
          text:
            typeof data.explanation === "string"
              ? data.explanation
              : "Draft ready for review.",
          warnings: Array.isArray(data.warnings)
            ? data.warnings.map(String)
            : [],
          review,
        },
      ]);
      if (promptRef.current === value) setPrompt("");
    } catch (e) {
      if (current()) {
        const text = errorText(e);
        setError(text);
        setThread((t) => [
          ...t,
          { role: "assistant", text: `Could not prepare this draft: ${text}` },
        ]);
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function apply(
    review: NonNullable<Entry["review"]>,
    simulate: boolean,
  ) {
    try {
      if (workspace.get().modal)
        throw new Error(
          "Close the active dialog before applying this proposal.",
        );
      guard(
        review.fence,
        () =>
          mounted.current &&
          generation.current === review.generation &&
          pending.current === review,
      );
      workspace.apply(review.proposal, review.fence, "Apply AI design");
      setThread((entries) =>
        entries.map((entry) =>
          entry.review === review
            ? { ...entry, review: { ...review, applied: true } }
            : entry,
        ),
      );
      pending.current = undefined;
      refinement.current = undefined;
      generation.current++;
      closeConversation(true);
      setError("");
      if (simulate) await workspace.run();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="ai-workspace" ref={root}>
      {open && (
        <Card
          padding={3}
          className="ai-thread"
          role="region"
          aria-label="Design conversation"
        >
          <div className="ai-thread-heading">
            <strong>Architecture conversation</strong>
            {thread.some((entry) => entry.review) && (
              <Action
                label={
                  unseen ? "New response · latest proposal" : "Latest proposal"
                }
                size="sm"
                variant="ghost"
                onClick={() => {
                  showLatest();
                  latest.current?.focus({ preventScroll: true });
                }}
              />
            )}
            <IconAction
              id="ai-conversation-close"
              label="Close conversation"
              icon={<X size={18} />}
              onClick={() => closeConversation()}
            />
          </div>
          <span role="status" className="ai-response-status">
            {busy
              ? "Preparing a proposal…"
              : unseen
                ? "New response available."
                : ""}
          </span>
          <div
            className="ai-messages"
            ref={messages}
            onScroll={() => {
              const el = messages.current;
              if (el) {
                scrollPosition.current = el.scrollTop;
                followLatest.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 64;
              }
              if (followLatest.current) setUnseen(false);
            }}
          >
            {thread.length === 0 && (
              <Message text="Describe an architecture or ask for a change. Proposals stay separate until you apply them." />
            )}
            {thread.map((entry, i) => {
              const review = entry.review;
              const status = review
                ? reviewStatus({
                    applied: !!review.applied,
                    generation: review.generation,
                    currentGeneration: generation.current,
                    isPending: pending.current === review,
                    isCurrent: workspace.isCurrent(review.fence),
                  })
                : undefined;
              const isLatest =
                !!review && !thread.slice(i + 1).some((item) => item.review);
              return (
                <article
                  key={i}
                  className="ai-entry"
                  tabIndex={-1}
                  ref={isLatest ? latest : undefined}
                >
                  <strong>{entry.role === "user" ? "You" : "Codex"}</strong>
                  {!review && <p>{entry.text}</p>}
                  {entry.review && (
                    <>
                      <Badge
                        label={
                          status === "pending"
                            ? "Ready to review"
                            : status === "applied"
                              ? "Applied earlier"
                              : "Outdated proposal"
                        }
                      />
                      <p className="ai-review-status">
                        {status === "pending"
                          ? "Canvas unchanged. Apply this proposal, or send a follow-up to refine it."
                          : status === "applied"
                            ? "Applied to the canvas at that time. Later edits may differ."
                            : "Not applied. The canvas changed or a newer request replaced this proposal."}
                      </p>
                      {status === "pending" && (
                        <div className="ai-actions ai-review-actions">
                          <Action
                            label="Apply to canvas"
                            disabled={
                              busy || state.gestureActive || !!state.modal
                            }
                            onClick={() => void apply(entry.review!, false)}
                          />
                          <Action
                            label="Apply & simulate"
                            variant="primary"
                            disabled={
                              busy || state.gestureActive || !!state.modal
                            }
                            onClick={() => void apply(entry.review!, true)}
                          />
                        </div>
                      )}
                      <Changes
                        before={entry.review.before}
                        after={entry.review.proposal}
                      />
                      <Disclosure
                        title={`Notes & assumptions${entry.warnings?.length ? ` (${entry.warnings.length})` : ""}`}
                      >
                        <p className="ai-advisory-note">
                          AI-generated advice. The review status above describes
                          what has been applied.
                        </p>
                        <p>{entry.text}</p>
                        {!!entry.warnings?.length && (
                          <ul>
                            {entry.warnings.map((warning, j) => (
                              <li key={j}>{warning}</li>
                            ))}
                          </ul>
                        )}
                      </Disclosure>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </Card>
      )}
      <Card padding={3} className="ai-composer">
        <div className="ai-suggestions">
          {["Build a web service", "Add a cache", "Explore a failure"].map(
            (text) => (
              <Action
                key={text}
                label={text}
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setPrompt(text)}
              />
            ),
          )}
        </div>
        <Area
          label="Describe your architecture or a follow-up change"
          value={prompt}
          onChange={setPrompt}
          rows={1}
          isLabelHidden
          placeholder="Describe a system, or ask what if…"
          isDisabled={busy}
          status={
            prompt.length >= 10000
              ? {
                  type: "error",
                  message: "Keep the request under 10,000 characters.",
                }
              : undefined
          }
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void submit(prompt);
            }
          }}
        />
        <div className="ai-actions">
          <div className="ai-actions">
            <IconAction
              label={voice.listening ? "Stop voice input" : "Start voice input"}
              icon={<Mic size={18} />}
              selected={voice.listening}
              disabled={busy}
              onClick={voice.toggle}
            />
            <IconAction
              id="ai-conversation-toggle"
              label={open ? "Close conversation" : "Inspect conversation"}
              icon={<MessageSquare size={18} />}
              selected={open}
              onClick={() => {
                if (open) closeConversation();
                else {
                  workspace.set({ panel: null });
                  setOpen(true);
                  requestAnimationFrame(() => {
                    if (!workspace.get().modal)
                      document.getElementById("ai-conversation-close")?.focus();
                  });
                }
              }}
            />
          </div>
          {busy ? (
            <Action
              label="Stop waiting"
              onClick={() => {
                generation.current++;
                pending.current = undefined;
                setBusy(false);
                setThread((t) => [
                  ...t,
                  {
                    role: "assistant",
                    text: "Stopped waiting. The local AI task may still finish in the background, but its reply cannot change this design.",
                  },
                ]);
              }}
            />
          ) : (
            <Action
              label="Send design request"
              variant="primary"
              disabled={!prompt.trim() || prompt.length >= 10000}
              onClick={() => void submit(prompt)}
            />
          )}
        </div>
        {error && <Message error text={error} />}

        {voice.status && <Message text={voice.status} />}
      </Card>
    </div>
  );
}
