# NEO v2 benchmark

Run with Node 24 using `node server/benchmark.mjs`. The results below use synthetic fixtures. Each algorithm receives the same candidates, evidence weights, and preparation budget. The old implementation uses the original rank-order scan. The second fixture checks representation of one named compulsory section without assuming its full exam structure.

The project contains no genuine university papers for a held-out backtest. The results measure optimizer behavior on fixtures.

### Additive counterexample (60 preparation minutes)
| Metric | Old | Knapsack | Coverage-aware |
|---|---:|---:|---:|
| Total priority value | 50 | 80 | 80 |
| Study time (minutes) | 40 | 60 | 60 |
| Distinct topics covered | 1 | 2 | 2 |
| Weighted topic coverage | 1 | 2 | 2 |
| Compulsory requirements satisfied | n/a | n/a | n/a |

Chosen by NEO v2: knapsack.

### Overlapping topics and compulsory section (54 preparation minutes)
| Metric | Old | Knapsack | Coverage-aware |
|---|---:|---:|---:|
| Total priority value | 99 | 99 | 70 |
| Study time (minutes) | 50 | 50 | 50 |
| Distinct topics covered | 1 | 1 | 2 |
| Weighted topic coverage | 3 | 3 | 5 |
| Compulsory requirements satisfied | 0/1 | 0/1 | 1/1 |

Chosen by NEO v2: coverage.

### Familiarity comparison (50 minutes total, 45 preparation minutes)
| Familiarity | Estimated candidate times | Selected | Preparation minutes | Compulsory section covered |
|---|---|---|---:|---|
| scratch | Q1: 47 min, Q2: 20 min | Q2 | 20 | no |
| revising | Q1: 25 min, Q2: 11 min | Q1, Q2 | 36 | yes |
