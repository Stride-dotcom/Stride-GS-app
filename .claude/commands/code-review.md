---
description: Spawn the locked-in Opus 4.7 code reviewer against the current feature branch (vs `source`). Use after `npm run build` passes, before opening the PR. No args = review the whole branch diff. With args = review just those files / focus on a specific concern.
---

Spawn the `code-reviewer` subagent (Opus 4.7, read-only) to review the current branch's diff against `source`.

If the user passed arguments, weave them into the agent's prompt as a focus area:

$ARGUMENTS

Otherwise, hand the reviewer the standard prompt:

> You're reviewing the current feature branch against `source`. Run `cd /c/dev/Stride-GS-app && git log --oneline source..HEAD` to see commits, then `git diff source..HEAD` for the full diff. Apply your Stride-landmine checklist and general-correctness checks. Report in the standard Critical / Important / Nits / Looks-good format.

Always use `subagent_type: 'code-reviewer'`. Do not substitute `general-purpose` — the locked-in agent has the model + system prompt baked in.

After the review returns, summarize the findings to the user in 3–5 lines, then ask whether to apply the suggested fixes before opening the PR. Do NOT auto-apply fixes; the user reviews the review.
