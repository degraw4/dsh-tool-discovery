# Build, verify and run

The numerical report needs only Python 3.11 or later. Building the plugin requires Node 22.19 or later in the Node 22 line, or Node 24+, and a built DSH checkout at the revision below. The complete reference benchmark requires Linux, Bubblewrap with usable user namespaces, `uv`, `git`, `patch`, and network access during dependency installation. Tool subprocesses have no network during evaluation.

## 1. Check the recorded result

From this repository:

```bash
python3 -m unittest discover -s bench -p 'test_*.py'
python3 bench/report.py --check
```

This recalculates the published accounting. It does not call a model or regrade historical workbooks, which are not distributed.

## 2. Prepare DSH and build the plugin

Use a separate checkout, or reuse an existing built checkout at exactly this commit:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git -C ../deepseek-harness checkout d743267388641bc76f17c45ce8b4c231aed1d32c
```

In that DSH directory, install pnpm 11.28.5 using your normal package-manager setup, then run:

```bash
pnpm install --frozen-lockfile
pnpm run build
```

Return to this repository:

```bash
node scripts/bootstrap.mjs ../deepseek-harness
npm test
npm run typecheck
npm run build
```

Bootstrap reuses the pinned checkout's development dependencies through local symlinks. It writes ignored runtime paths and TypeScript configurations; it does not edit DSH. `DSH_NODE_BIN` can select another compatible Node executable. The build generates `lib/tool-docs.mjs` and a documented MCP adapter in `lib/mcp-client-documented.mjs`.

## 3. Prepare public task material and tool servers

Ensure `uv` and `bwrap` are on `PATH`:

```bash
python3 bench/setup.py
```

This fetches the two needed task directories from the pinned Toolathlon revision, verifies their hashes, creates separate Python environments, installs pinned Node MCP servers, and applies the Excel inspection patch to a local copy. It creates an isolated Harness Home under `.local`. If you already have the pinned Toolathlon checkout, use `--toolathlon /path/to/Toolathlon`.

The recorded runs and local preflight used Node 22.19.0. The pinned filesystem server declares Node 24+ and npm emits an engine warning under Node 22; the exercised paths passed preflight. Node 24 satisfies that dependency's declaration, but constitutes a runtime change when comparing against the recorded batch.

Task inputs, ground truth and evaluators remain under `.local` or the supplied upstream checkout. They are not relicensed by this project. See [third-party notices](../THIRD_PARTY_NOTICES.md) before downloading or using them.

Run the real tools without making a model request:

```bash
.local/python-eval/bin/python bench/preflight.py
```

This checks both strategies, the 78-tool inventory, deferred-tool count, SDK stability after lookup, shared workspace behavior, actual spreadsheet generation and a blocked read outside the task workspace. It also runs the chart grader. Evidence goes to `.local/preflight.json`. The preflight installs an `llm/stream` handler that rejects model calls and removes model credentials from the child environment.

## 4. Run a paid experiment explicitly

Provide credentials through the launching environment, using your own secret manager or a protected local file. Never add them to tracked configuration. Set `DEEPSEEK_API_KEY`, or separate `DEEPSEEK_API_KEY_FULL` and `DEEPSEEK_API_KEY_SELECTIVE` values for per-strategy billing visibility.

Print a plan first:

```bash
.local/python-eval/bin/python bench/run.py --repeats 10
```

Start both strategies with a declared estimated-cost budget:

```bash
.local/python-eval/bin/python bench/run.py --execute --repeats 10 --max-cost-cny 20
```

Ten repeats mean 80 attempts. The example's 20 CNY is a limit for this new run, not a promise about its actual invoice. Both strategies use high reasoning, a 65,536-token output limit and the frequent-tool configuration in `bench/docs-config.json`. The controller reserves 2 CNY for in-flight work and requires a complete 1.5 CNY per-attempt allowance before starting another task. It never shrinks an attempt allowance to the batch remainder. Provider pricing changes, unreported usage and in-flight work mean this is not a provider-enforced spending cap.

Each attempt gets a fresh workspace and Session. The runner writes configuration, task command, source hashes, stdout events, policy trace, artifact hashes, grader results and numeric usage under `.local/runs`. Credentials are passed in the environment, not the saved command or configuration. Do not publish those runtime directories without a separate review of their content.

The controller stops on provider failures, incomplete usage or unexpected grader errors. Business failures remain in the result. It does not silently rerun failed attempts.

For a batch cleanly stopped between attempts, resume with the same arguments:

```bash
.local/python-eval/bin/python bench/run.py --execute --repeats 10 --max-cost-cny 20 \
  --resume .local/runs/REPLACE_WITH_BATCH_DIRECTORY
```

Resume checks source hashes, schedule, completed-result hashes and accounting. It refuses ambiguous `running` attempts or infrastructure failures; inspect these records before starting a separate batch. It resumes pending jobs, not a partially executed agent turn.

## 5. Analyze the new batch

```bash
python3 bench/report.py \
  --runs .local/runs/REPLACE_WITH_BATCH_DIRECTORY/runs.json \
  --repeats 10 --output /tmp/new-tool-report.json
```

The analyzer requires a complete task-position matrix with known usage. It reports the initial schedule, the first successful attempt available at each position, and all-attempt costs. Additional attempt-tagged records can be analyzed together; attempt ordinals must be contiguous. Unresolved positions are marked explicitly. The default runner executes a fixed schedule and retains every result; it does not manufacture a complete successful sample. The published first-success table is a conditional selection from the stored 87-attempt evidence, not a claim that a new fixed 80-attempt run will all pass.

Provider aliases, caching, hardware and dependency implementations can change execution behavior. The release records package and source revisions to aid reproduction, but exact model text, timing and cache counts are not deterministic.
