# DSH Tool Discovery

**Keep frequent tool inputs complete. Load complex parameter details only when needed.**

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its TypeScript Programmatic Tool Calling (PTC) runtime. PTC lets an agent call several tools from one program. This plugin keeps useful signatures in the model's tool SDK and places detailed documentation in conversation history on demand.

[中文](README.zh.md) · [Design](docs/design.md) · [Evaluation](docs/evaluation.md) · [Reproduce](docs/reproduce.md)

## How it works

1. Small schemas and tools listed in `alwaysInline` keep complete parameters in the SDK.
2. Other large schemas retain the tool name, description, top-level argument names, types, required fields, and return type. Nested details are deferred.
3. The model calls `tool_help` with exact tool names or a configured group. Complete schemas return as tool results, without expanding the static SDK.
4. Execution still uses native tool registration, scope checks and full parameter validation. Documentation lookup grants no permissions.

```yaml
presentation: selective
deferSchemaBytes: 1024
alwaysInline:
  - mcp__excel__format_range
  - mcp__excel__set_sheet_layout
```

```ts
// The model reads the returned definition in its next step.
console.log(await tools.tool_help({ names: ['mcp__excel__create_chart'] }))
```

A fixed SDK avoids changing its prefix during documentation discovery. It does not guarantee provider cache hits. The host chooses frequent tools before execution; there is no query-keyword router.

## Recorded engineering result

On **80 selected successful executions** across four spreadsheet tasks, selective documentation with two frequent tools kept inline used **6.5% less estimated model cost** and **3.1% fewer model requests**, with essentially unchanged mean elapsed time.

| Metric | Full PTC | Selective PTC with frequent tools inline | Change |
| --- | ---: | ---: | ---: |
| Selected successful executions | 40 | 40 | — |
| Usage-based estimated cost | ¥6.7084 | ¥6.2718 | **−6.5%** |
| Model requests | 416 | 403 | **−3.1%** |
| Mean elapsed time | 63.92s | 63.83s | −0.1% |
| Non-cached input tokens | 1,385,262 | 1,217,760 | **−12.1%** |

Both configurations use `deepseek-flash`, high reasoning, a 65,536-token output limit, and 78 real MCP tools. Nine complex tool inputs use deferred details in the candidate. Offline SDK size is 92,682 → 72,587 UTF-8 bytes (−21.7%); this is not a token measurement. Two tasks are adapted from public Toolathlon tasks; two are derived tasks using its public spreadsheet data.

The table takes the **first successful execution for each task, strategy and repeat**. It measures resources for successful execution, not one-shot success probability or all-attempt spending. All 87 numeric attempt records are retained. These four development tasks do not establish general superiority or an official Toolathlon score. Costs are calculated from usage at frozen rates, not an invoice. See [selection method and complete accounting](docs/evaluation.md).

## Try it

This source release is not published to npm. Use a built DSH checkout at `d743267388641bc76f17c45ce8b4c231aed1d32c`:

```bash
node scripts/bootstrap.mjs /path/to/deepseek-harness
npm test
npm run typecheck
npm run build
```

Mount `lib/tool-docs.mjs` as a Cordis plugin using TypeScript PTC. See [configuration](examples/README.md) and [setup](docs/reproduce.md).

Recompute the recorded numbers without a model, credentials or data downloads:

```bash
python3 -m unittest discover -s bench -p 'test_*.py'
python3 bench/report.py --check
```

## Repository contents

| Location | Purpose |
| --- | --- |
| `src/` | Scoped documentation lookup, pagination, minimum signatures and SDK rendering |
| `tests/` | Lifecycle, scope, signature, schema and frequent-tool checks |
| `bench/` | Public task retrieval, real tool servers, deterministic graders and fixed-schedule runner |
| `results/` | 87 numerical attempt records, 887 request usages and the reproducible first-success selection |
| `patches/` | Shared MCP output metadata and spreadsheet inspection support |

Upstream workbooks and original evaluators are downloaded at pinned revisions. Credentials, private tool collections, full conversations and generated workbooks are not distributed.

## License

Project code is MIT. Upstream code and datasets retain their terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
