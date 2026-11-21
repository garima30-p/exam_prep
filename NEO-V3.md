# NEO v3 validation

## Semantic matching

The app serves a pinned q8 `Xenova/all-MiniLM-L6-v2` artifact locally and runs Transformers.js in a dedicated browser worker. Mean-pooled, normalized embeddings are created in batches of eight for up to 100 ranked candidates. The worker retains up to 256 text-to-vector entries in memory. The planner does not invoke inference again when time or checkpoint progress changes. Model and ONNX assets load only when semantic matching is needed.

Two questions can merge when they have the same supported task type, the same ordered scope after a small list of explicit lexical substitutions, compatible units and syllabus evidence, and sufficient cosine similarity. This version auto-merges explanations, definitions and comparisons. Numerical, derivation, diagram and application questions stay in exact families. Numbers, operators, negation, argument order and contrasting concepts remain part of the scope gate. Every pair in a family must pass the gate. Recurrence is calculated from the union of distinct paper IDs, and grouped candidates retain every distinct original source. A merged family contributes each covered topic at most once.

Thresholds are engineering guardrails. The cutoff is 0.88 without a shared syllabus topic and 0.83 with one. Shared syllabus evidence lowers the threshold only after the separate type and scope checks pass. These thresholds were set to favor precision and were not fitted on the held-out exam. The audit includes proposed and rejected high-similarity pairs from 0.75 upward, with both original wordings, question types, source references, score, decision and final family ID. Inspect `reports[].review` in the JSON. Assign consistent concept labels to verified pairs and rerun to identify false positives and false negatives. The fixture has one positive pair, so its precision and recall are only an implementation smoke check.

Model references: [pinned MiniLM model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/6fa4bf687ce79106377b66d10009c0e513715e24/README.md) and [Transformers.js feature extraction](https://huggingface.co/docs/transformers.js/v3.8.1/en/api/pipelines).

## Synthetic held-out comparison

The fixture plans from the 2021 and 2022 papers and the available 2020 syllabus, then grades against the 2023 exam. The 2024 paper and syllabus are outside the training window. Every method gets 50 total minutes with 45 for preparation. The comparison grades syllabus coverage against the same training-only topic weights for every column.

| Metric | Exact ranking | Semantic ranking | Semantic + optimizer | Repetition-only |
|---|---:|---:|---:|---:|
| Exact held-out questions | 1 | 0 | 0 | 1 |
| Additional equivalent held-out questions | 0 | 1 | 1 | 0 |
| Weighted syllabus coverage | 2 / 3.5 | 1.5 / 3.5 | 1.5 / 3.5 | 2 / 3.5 |
| Held-out marks coverage | 5 / 15 | 10 / 15 | 10 / 15 | 5 / 15 |
| Compulsory sections covered | 0 / 1 | 1 / 1 | 1 / 1 | 0 / 1 |
| Estimated preparation minutes | 23 | 32 | 32 | 23 |
| Citation checks | 2 / 2 | 3 / 3 | 3 / 3 | 2 / 2 |

The real model grouped the labeled paraphrase at cosine approximately 0.94. The comparison yielded one true positive, zero false positives, zero false negatives and nine true negatives among candidate pairs with unambiguous labels. Semantic matching improved held-out marks and compulsory coverage in this fixture, while the exact methods covered more of the weighted training syllabus. Semantic optimization and semantic ranking selected the same question. The full report includes uncovered items and audit details.

## Performance

- Model assets are **23.69 MB** uncompressed, including the 22.97 MB q8 weights. The production build separately emits a **21.60 MB** ONNX WASM runtime and an approximately **0.88 MB** worker bundle. Transfer compression depends on the host and browser cache.
- Bundled-model desktop Node measurements, including initial model load and inference for the fixture, are in `NEO-V3-EVALUATION.json`. A successful empty-cache upstream download and first batch took 22.9 seconds on this machine. The shipped browser build uses bundled static weights, which removes that upstream dependency.
- Desktop browser production preview took approximately **1.8 seconds** from clicking Build my plan to a ready result for three candidates. It grouped the two virtual-memory phrasings, displayed both citations, and replanned on a new time budget.
- Node peak process RSS includes the JavaScript process and native inference runtime. It is not a browser memory measurement. Physical mobile devices were unavailable for testing. Large candidate sets, low-memory phones, and browsers without suitable WASM support can hit the deterministic fallback.

## Add real university papers

1. Create one dataset per subject and compatible exam format. Use papers with known exam dates. Pick one or more held-out exams before inspecting outcomes.
2. Extract selectable PDF text using `node server/extract-pdf.mjs paper.pdf material.json`. Inspect each page against the original. For scanned pages, supply verified OCR or a transcription. Keep line breaks, question numbers, marks and section headers.
3. Copy `server/fixtures/synthetic-history.json` as a schema example and set `synthetic` to false. Each paper needs a unique `id`, an ISO `date`, and a `material` with a unique `name` and `pages` entries containing `number` and `text`. In `holdouts`, list the paper IDs to grade. An optional `planningDate` sets an earlier cutoff. Only papers dated strictly before that cutoff enter training.
4. Independently label training items by page, question number, and precise concept or answer scope. Label held-out items with `page`, `number`, `question`, `concept`, `section`, and explicitly printed `marks`. Mark individually compulsory items with `required: true`. Each held-out section can declare `{ "id": "A", "answer": 2, "compulsory": true }`. The `answer` count includes required items. Missing marks or unknown choice rules make full marks coverage unavailable. For each known section, the grader counts required items first and caps optional marks by the remaining answer slots.
5. Add dated `syllabi` records with `availableOn`, optional `effectiveOn`, and `material`. Add rules known to the student before the exam under `planningRules` with `availableOn` and `pattern`. Exam-paper rules used only for grading belong under the held-out paper's `sections`. Set identical `minutes` and `familiarity` for the methods being compared.
6. Run `npm run evaluate -- real-history.json real-report.json`. Review citations, mismatches, grouping decisions, and uncovered areas. Keep a separate set of later exams for final validation if you use earlier outcomes to tune thresholds.

## Limits

Conceptual coverage depends on independent labels. The current grader assumes choices are independent within each declared section. Cross-section alternatives, partial credit, unseen prompts without labels, and calibration on genuine university exams require further validation. The matcher favors conservative grouping and can miss paraphrases with substantially different wording. Historical marks coverage indicates whether planned material relates to exam questions. It does not predict student scores or passing.

