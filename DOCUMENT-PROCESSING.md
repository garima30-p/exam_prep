# Document processing repair

## Root causes

The old browser used one six-page OCR counter for the whole upload, then silently skipped later scans. The PDF.js integration also omitted `wasmUrl`. With the affected PDFs, PDF.js could not initialize its JBIG2 image decoder. It rendered blank pages in the 2024 and 2025 papers and missing image layers in the 2023 paper. OCR was therefore working on images missing most or all of the printed text. The old path capped rendering at 2× or 1,600 pixels on the long side, used one segmentation setting, and accepted any output of at least 30 characters. PDF.js already applied its rotation metadata, but the old app had no fallback for sideways scans saved without useful metadata. Tesseract's confidence is its recognition score and is not a measured transcription-accuracy percentage.

## Before and after

All three original TCS502 files were available and were tested locally. For the baseline, the papers were read together in chronological order with the previous settings and the shared six-page allowance. The repaired measurements use the bundled decoder, adaptive render scale, layout and quality checks. The figures are per PDF page, not per printed page inside a spread.

| Paper | PDF pages | Old OCR attempts | Pages passing old length-only check | Repaired OCR attempts | Pages passing the new quality gate |
|---|---:|---:|---:|---:|---:|
| December 2023 | 5 | 5 | 4 | 5 | 5 |
| December 2024 | 4 | 1 | 0 | 4 | 3 |
| November 2025 | 2 | 0 | 0 | 2 | 2 |
| Total | 11 | 6 | 4 | 11 | 10 |

| Paper | Old OCR confidence per attempted page | Repaired OCR confidence per page |
|---|---|---|
| December 2023 | 69, 42, 25, 24, 25 | 89, 84, 84, 90, 86 |
| December 2024 | 0 | 83, 81, 81, 68 |
| November 2025 | No OCR attempted | 87, 82 |

The four old 2023 pages above crossed the length threshold, but visible output on several pages was OCR noise. The 2024 page 4 raster contained real text, and the repair recovered some of it. Its score of 68 and the remaining artifacts kept the page in review. Retrying it in the browser still left it in review. The app retains the draft and the citation to the original page for correction. The entire 2024 paper is excluded from frequency counts while incomplete. Its other usable pages remain available as sources.

A request to the rebuilt analysis endpoint using the actual OCR results returned 51 candidate records. The frequency denominator was two papers, 11 references came from usable 2024 pages, page 4 contributed zero references, and no candidate received OCR-only marks. The 51 candidates are an extraction count and were not all individually verified.

I compared representative text against rendered source pages. December 2023 PDF page 2 contains the batch-versus-real-time processing and inter-process communication questions. November 2025 PDF page 2 contains the question about thrashing in virtual memory. OCR recovered those topics and preserved their PDF page references. Examples from December 2024 also showed misread characters in quantitative prompts. These are spot checks. The page counts above are quality-gate outcomes and do not imply complete transcription of every question, table, diagram or symbol.

The desktop Node measurement took approximately 51 seconds to OCR the 11 actual pages, excluding review and plan generation. Browser speed varies with the scan and the device.

## Processing and evidence rules

- The browser serves PDF.js decoder assets locally and tries selectable text first. It processes scan pages one at a time with a reused worker. It reports the current file, page and pass, and releases each page canvas before processing the next one. A cancelled run retains completed pages and can resume.
- Rendering targets 240 DPI with a pixel budget for constrained devices. PDF rotation is respected. If the text fails the quality gate, the app can try contrast enhancement, a different page layout or an extra quarter-turn. Manual retry can also try a binary image and a half-turn. On landscape spreads with a detectable gutter, the two regions are read separately and retained within the same PDF page. A retry replaces an earlier reading only if quality checks favor it.
- Page status uses readable structure and question cues as well as OCR confidence. Confidence below 78 is held for review. OCR-only marks do not affect ranking or section-mark estimates. Questions with numerical inputs or detected dependencies on tables, diagrams, code or calculations are held back until the page is verified. The raw draft remains viewable alongside the physical page for correction.
- The student can inspect page text, retry unresolved pages, or intentionally continue with incomplete evidence. NEO receives only usable or manually verified pages. An incomplete paper contributes no denominator or appearance to historical frequency. The planner preserves original attachment and PDF page references. A manually verified correction retains the same page reference and is identified as such.

## Verification scope

The browser was exercised with all three real papers, and with a synthetic mixed PDF containing selectable text plus a rotated, low-resolution scan. Both synthetic pages were usable, but the low-resolution page misread a printed 5-mark label as 3. That finding led to withholding all OCR-only marks until manual verification. Browser cancellation and resumption retained processed pages. Automated checks cover one-at-a-time OCR, more than six scan pages across documents, cached pages, low confidence, failed retries, cancellation and resource cleanup, and the exclusion of unverified content from frequency counts. Physical mobile throughput was not measured.
