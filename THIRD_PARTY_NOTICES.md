# Third-party notices

This project's MIT license applies to its own code. It does not override upstream software licenses or dataset conditions.

| Component | Use | Source and terms |
| --- | --- | --- |
| DeepSeek Harness | Cordis plugin interfaces, native PTC and MCP adapter built from a local copy | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), MIT; notice retained in [`patches/LICENSE.deepseek`](patches/LICENSE.deepseek) |
| Excel MCP server | Real spreadsheet operations; a shared inspection patch | [haris-musa/excel-mcp-server](https://github.com/haris-musa/excel-mcp-server), MIT; notice retained in [`patches/LICENSE.excel-mcp-server`](patches/LICENSE.excel-mcp-server) |
| MCP filesystem and memory servers | Real file and graph-memory operations | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers), MIT; installed as dependencies, not vendored |
| PDF Tools MCP | Real PDF operations | `pdf-tools-mcp==0.1.4`, MIT package; installed as a dependency, not vendored |
| Toolathlon | Two public task inputs, task text and evaluators | [hkust-nlp/Toolathlon](https://github.com/hkust-nlp/Toolathlon), fixed revision in the dataset manifest; fetched from upstream, not bundled or relicensed |

The pinned Toolathlon checkout does not provide a repository-level LICENSE file. Its separate [published trajectory collection](https://huggingface.co/datasets/hkust-nlp/Toolathlon-Verified_Trajectories) is restricted to benchmark uses and forbids training and raw trajectory redistribution. This project does not download that collection; its conditions should not be mistaken for a license for the task repository. Consult the upstream terms and obtain any required access before use. This repository distributes paths and checksums for retrieval, plus its own derived task instructions; it does not claim a right to relicense the upstream workbooks or evaluators under MIT.

The benchmark uses public tool descriptions and schemas for its tool-inventory manifest. Both comparison strategies use the same servers, compatibility patches and task data. No private business tool schema or private dataset is included.

Dependency distributions carry their own notices. Build output and installed dependencies are generated locally and are not committed.
