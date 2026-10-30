# Recorded evaluation

## Current result

The selected successful executions used **6.5% less estimated cost**, **3.1% fewer model requests** and **12.1% fewer non-cached input tokens**, with essentially unchanged mean elapsed time. The selection rule is defined below; this is an engineering comparison conditional on task completion.

| Metric | Full PTC | Selective PTC with frequent tools inline | Change |
| --- | ---: | ---: | ---: |
| Selected successful executions | 40 | 40 | Conditional sample |
| Estimated cost | ¥6.70841040 | ¥6.27175200 | −6.5% |
| Model requests | 416 | 403 | −3.1% |
| Mean elapsed time | 63.92s | 63.83s | −0.1% |
| Non-cached input tokens | 1,385,262 | 1,217,760 | −12.1% |
| Cache-read tokens | 13,794,560 | 11,846,400 | −14.1% |
| Output tokens, including reasoning | 423,263 | 420,297 | −0.7% |

Output totals are close; the result is not presented as an output-compression gain.

## Configuration

| Setting | Both strategies |
| --- | --- |
| Model | `deepseek-flash`, thinking enabled, reasoning effort `high` |
| DSH revision | `d743267388641bc76f17c45ce8b4c231aed1d32c` |
| Toolathlon revision | `9be8d8fe07a497b18ee61e3f2ae694e9797f39eb` |
| Tool inventory | 14 filesystem, 46 Excel, 9 PDF, 9 memory: 78 tools plus `tool_help` |
| Execution | Native TypeScript PTC; fresh process, Session and isolated workspace per attempt |
| Maximum output | 65,536 tokens per model request |
| Other limits | 80 model requests, 400 tool calls and 30 minutes per attempt |
| Spill | Native tool-result spill threshold of 12,500 tokens |
| Shared compatibility | Documented MCP output metadata and Excel inspection patch |
| Presentation | `full` versus `selective`; schema threshold 1,024 UTF-8 bytes |
| Complete frequent-tool inputs | `mcp__excel__format_range`, `mcp__excel__set_sheet_layout` |

The candidate keeps complete inputs for 69 tools and defers nested details for nine tools. Full PTC exposes all schemas. Tool access, implementations, task prompts and graders are shared. No grader feedback is added to the model prompt.

## Tasks and deterministic acceptance

| Task | Origin | Required output | Acceptance |
| --- | --- | --- | --- |
| `excel-market-research` | Public Toolathlon adaptation | Segment growth-rate workbook | Upstream checker plus required-column and row-count validation |
| `excel-data-transformation` | Public Toolathlon adaptation | Structured spreadsheet matching the supplied source and template | Upstream checker and original ground truth |
| `market-chart-report` | Derived from public market data | Three-series chart with prescribed values and layout | Numeric values, chart references, labels, formatting, frozen cells and source hash |
| `market-validation-report` | Derived from public market data | Growth audit table with validation and conditional formatting | Growth values, table and validation rules, formatting and source hash |

Task prompts and criteria are in [`bench/tasks.json`](../bench/tasks.json). Public source files and graders are fetched at a fixed revision and verified using [`bench/dataset-manifest.json`](../bench/dataset-manifest.json). All four tasks were used during development. They are not held-out tasks, and these results are not an official Toolathlon leaderboard score. Workbook structure checks do not prove rendered visual quality.

## Sample definition

The task matrix has four tasks, two strategies and ten repeat positions. For each position, select the first recorded attempt that both **finishes normally** and **passes its artifact grader**. The selected set therefore contains 80 successful executions, drawn from 87 recorded attempts. A successful artifact from an interrupted execution does not qualify. Selection is by execution order, never by lowest cost.

This rule conditions on the outcome. Forty selected successes per strategy are not an estimate of one-shot reliability. The 87 attempt records and all 887 request usages remain available; the numerical analyzer reports three populations separately:

- `successfulExecutions`: the 80 selected executions used in the headline engineering table.
- `initialAttempts`: the original 80-position fixed schedule.
- `allAttempts`: all 87 attempts and their full measured resource use.

## Complete accounting

| Population | Full PTC | Selective PTC |
| --- | ---: | ---: |
| Initial schedule: normally completed and grader-passing | 38/40 | 36/40 |
| All recorded attempts | 42 | 45 |
| All-attempt estimated cost | ¥7.02431344 | ¥7.09134800 |
| All-attempt model requests | 435 | 452 |
| All-attempt elapsed time | 2,672.66s | 2,900.70s |

The complete cost is approximately equal, with the candidate 1.0% higher. It must not be replaced by the successful-execution cost when discussing total spending. One original position had an experiment-budget terminal despite passing the artifact grader; it remains recorded as incomplete. The published runner reserves a full per-attempt allowance before admission rather than reducing the last attempt's allowance to the batch remainder.

A separate preliminary infrastructure attempt is recorded in provenance with ¥0.15548280 of known usage and one request with unknown usage. It is outside the 87-attempt matrix and is not treated as free.

## Measurement and reproducibility

DSH's normalized `inputTokens` is non-cached input. The frozen price assumptions, in CNY per million tokens, are:

```text
estimated cost = (2 × non-cached input
                + 0.04 × cache-read input
                + 2 × cache-write input
                + 8 × output) / 1,000,000
```

These are analysis rates, not a current-price promise or a reconciled invoice. Output includes reasoning. Elapsed time includes process and tool-server startup, not just inference.

Each public attempt has an immutable source-record hash and per-request usage. The release includes numerical evidence only, without conversations, Session logs or produced workbooks. It reproduces accounting and sample selection, but cannot independently regrade historical artifacts. A new run creates its own artifacts and grader evidence.

The live observations used a frozen experimental build. This release packages the mechanism with portable paths and setup. Release tests and a zero-model real-tool preflight check that packaging; no additional paid batch is implied. Model aliases, server caches and host conditions can change later runs. Four development tasks and an outcome-conditioned sample do not establish general cost superiority or quality non-inferiority.

```bash
python3 bench/report.py --check
python3 bench/report.py --output /tmp/dsh-tool-report.json
```

These commands recompute all three populations and check every attempt's usage against its requests. They make no API calls.
