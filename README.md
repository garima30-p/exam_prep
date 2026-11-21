# in-nocent

Mobile-first exam preparation with a functional analysis endpoint. The example button still opens a separate sample DBMS plan.

## Run locally

Use Node.js 24 and npm. In PowerShell, use `npm.cmd` if script execution blocks `npm`.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Vite prints the local URL. Development and production preview both mount the same backend under `/api`.

## Try the live flow

Enter a study budget such as “My OS exam is tomorrow. I have 90 minutes and I’m starting from scratch.” Attach a syllabus, past papers or notes. You can also paste explicit question lines in the same composer. Review the suggested document tags before submitting. Each citation shows the extracted excerpt and links back to the original PDF page when the attachment is still selected.

PDF.js tries selectable text on every attached page. English OCR processes scan pages sequentially in the browser, with live progress, cancellation, and page-level retry. Inspect the **Document processing** summary to compare questionable text against the original and save corrections. An incomplete upload needs explicit confirmation before the app generates a plan from the usable pages. Incomplete past papers are omitted from historical frequency counts. All raw PDFs remain in the browser. The upload limits are eight PDFs and 20 MB per file. The analysis request accepts up to 4 MB of extracted JSON and shows an error if the set exceeds that limit.

See [DOCUMENT-PROCESSING.md](DOCUMENT-PROCESSING.md) for the three TCS502 comparisons, verification method, and OCR limitations.

## Backend

- `GET /api/health` reports service availability.
- `POST /api/analyze` accepts classified materials with per-page text, available minutes, paper rules and familiarity. It returns evidence-bearing candidates, topic weights, estimates and a preparation plan.
- The first ten recommendations appear immediately. **Show next 10** reveals additional selected questions. When the first ten lack coverage of a requirement represented in the full plan, the app flags that gap.
- Expand a question’s checkpoints and record an attempt as incomplete, completed, or needing revision. Completed work and out-of-plan checkpoints remain accessible under **Revisit checkpoint progress**. On checkpoint or familiarity changes, the planner samples elapsed session time and subtracts whole minutes from the last stated budget. Giving a new time in chat starts a fresh budget. “I’m mostly revising” changes effort estimates and preserves checkpoint progress. A new analysis or reload starts a new checkpoint session.
- `functions/api/[[path]].js` is a Cloudflare Pages Functions adapter. `dist/` contains the static bundle. Deploy the project source with the Functions directory alongside the configured `dist` output. A static-only upload omits the analysis endpoint.

The API is stateless and does not save files, extracted text or account history. This release does not provision a Cloudflare project, Workers AI, D1, identity, distributed quotas or billing. The local browser tests used a synthetic two-page PDF with one text page and one scanned page.

## NEO v2 design

The previous engine put extraction, exact-repeat normalization, historical counts, ranking and flat 15/20/30-minute estimates in `server/engine.mjs`. The browser’s `fitQuestions` function scanned the ranked list once, taking anything that fit the remaining minutes. Chat updated the stored time; the same greedy scan ran again. NEO v2 reuses extraction, page/source maps, notes matching and the same browser replan path. The old scan is retained as the benchmark baseline.

- **Evidence score.** Distinct-paper recurrence, explicit marks normalized against the extracted set, syllabus matches, breadth, initial time estimate and inferred filename-year recency use bounded components. The weighted point allocation is 40/20/20/10/5/5, plus a 10-point floor. Unavailable components are returned as null and add no points. Duplicate occurrences in a paper count once. Papers with identical extracted pages are deduplicated. Topic weights start at 1 and add up to 1 based on the strongest matched recurrence fraction. These weights are heuristics. Token matching is conservative; unmatched candidates get a normalized question-topic proxy.
- **Exact additive knapsack.** Integer-minute, descending-capacity 0/1 dynamic programming with backtracking. For `n` candidates and effective preparation budget `B`, runtime and reconstruction storage are O(nB). Capacity is capped at total eligible costs, with up to 100 candidates of up to 240 minutes each.
- **Coverage heuristic.** Select by compulsory coverage, then marginal distinct topic weight per minute, followed by up to two improving one-for-one swaps with refill. Final comparison between the two plans prioritizes validated requirement coverage, progress toward unmet requirements, weighted topic coverage, additive value, then shorter time. With `M` the cost of evaluating one trial set, the bounded greedy and swap passes take O(n²M) time and O(n + topic count + rule count) working space, excluding candidate metadata and knapsack storage. Only the additive optimizer is exact.
- **Paper rules.** Explicit single-group commands such as “Answer any 2 in Section B” and named mandatory units or sections guide selection. Explicit marks floors use marks evidenced within that group and respect its stated choice count. A named group with no count gets a coverage check with a warning to verify the answer count. Unsupported or unmet rules are shown. The planner does not infer a full paper structure across years.
- **Learning effort.** Question type, explicit marks, syllabus prerequisites, related material and stated familiarity affect the understanding, practice and per-question recall estimates. The plan also holds approximately 10% for end-of-session revision. Missing familiarity uses conservative estimates. The remaining effort caps what fits and applies a small priority adjustment, while compulsory coverage stays ahead of that adjustment. Checkpoints use an exact question phrase, linked syllabus concept or cited notes when feasible. Type guides are labeled separately. Completion is self-reported; a needs-revision checkpoint restores part of its effort. Completed questions are credited once in coverage and remain available to review.

See [BENCHMARK.md](BENCHMARK.md) for measurements and the familiarity example. No genuine university PYQ corpus was present for held-out validation. Effort and ranking are heuristic study guidance.

## NEO v3

After the existing analysis endpoint extracts and scores candidates, the browser runs the bundled q8 MiniLM model in a Web Worker. It groups only supported equivalents, retains every source reference and reruns the existing optimizer against the grouped records. The model uses static assets served by the application. Embedding requests stay on the device. Replanning reuses the stored question families and leaves the worker idle. If the worker fails or passes its 45-second deadline, the app uses the backend's exact-normalization plan and shows a warning.

Run the synthetic chronological backtest from the project directory:

```sh
npm run evaluate -- server/fixtures/synthetic-history.json NEO-V3-EVALUATION.json
```

The command uses the bundled model by default. Use `--exact` to exercise fallback, or `--cache=PATH` to use a separate Transformers.js disk cache with the pinned upstream model. See [NEO-V3.md](NEO-V3.md) for the evaluation protocol, fixture results, and instructions for adding real papers.

