# DSH 工具渐进文档

**高频工具保留完整参数，复杂工具按需读取详细定义。**

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的工具展示插件，使用原生 TypeScript Programmatic Tool Calling（PTC，模型通过程序调用多个工具）。它减少重复进入模型输入的工具说明，同时保留生成调用代码需要的基本信息。

[English](README.md) · [设计](docs/design.md) · [实验报告](docs/evaluation.md) · [复现步骤](docs/reproduce.md)

## 核心设计

- 小工具和`alwaysInline`指定的高频工具展示完整参数。
- 其他复杂工具保留名称、用途、顶层参数名、类型、必填关系和返回类型；嵌套参数细节按需查阅。
- 模型通过`tool_help`按名称或能力组读取完整定义，结果进入对话历史，工具SDK保持固定。
- 定义分页返回，翻页检查版本指纹。执行仍使用DSH原始工具、完整校验器和权限范围，查文档不会扩大权限。

```yaml
presentation: selective
deferSchemaBytes: 1024
alwaysInline:
  - mcp__excel__format_range
  - mcp__excel__set_sheet_layout
```

高频名单由宿主提前配置，不根据用户query做关键词路由。固定SDK减少了文档查询引起的前缀变化，但不保证服务端缓存必然命中。

## 当前结论

在4项表格任务的**80次成功执行样本**中，高频工具常驻的渐进方案，相对全量PTC：**费用估算低6.5%，模型请求少3.1%，平均耗时基本持平。**

| 指标 | 全量PTC | 高频常驻渐进PTC | 变化 |
| --- | ---: | ---: | ---: |
| 选入的成功执行 | 40次 | 40次 | — |
| usage折算费用 | 6.7084元 | 6.2718元 | **−6.5%** |
| 模型请求 | 416次 | 403次 | **−3.1%** |
| 平均耗时 | 63.92秒 | 63.83秒 | −0.1% |
| 非缓存输入Token | 1,385,262 | 1,217,760 | **−12.1%** |

两组均使用`deepseek-flash`、high思考、65,536 Token输出上限和78项真实MCP工具；候选有9个复杂工具采用渐进参数展示。离线SDK体积由92,682字节降为72,587字节，减少21.7%；字节变化不等于Token变化。任务包含两项公开Toolathlon任务适配和两项使用其公开表格数据的派生任务。

统计对每个“任务、策略、重复编号”取**第一次完整成功的执行**，只衡量成功执行的资源开销，不代表一次成功率或全部尝试的总花费。87份数值记录全部保留，选择规则和完整投入见[评测方法](docs/evaluation.md)。这4项任务用于开发回归，不作为官方榜单成绩或通用收益保证；费用为固定单价折算，未与账单核对。

## 使用与复现

本仓库提供源代码，尚未发布npm包。使用固定版本DSH后构建：

```bash
node scripts/bootstrap.mjs /path/to/deepseek-harness
npm test
npm run typecheck
npm run build
```

将`lib/tool-docs.mjs`挂载到Cordis并使用TypeScript PTC。参见[最小配置](examples/README.md)。

核对数值无需调用模型：

```bash
python3 -m unittest discover -s bench -p 'test_*.py'
python3 bench/report.py --check
```

实际运行需要Linux、Bubblewrap、Python环境和模型凭据，详见[复现步骤](docs/reproduce.md)。执行器默认只打印计划，显式指定`--execute`和预算才调用模型。

仓库包含插件、公开任务获取及评测脚本、87次尝试和887次请求的数值记录。公开工作簿按固定提交下载，不包含私有工具、业务素材、密钥、完整对话或生成产物。

代码采用MIT许可，外部数据和依赖保留原条款，见[第三方声明](THIRD_PARTY_NOTICES.md)。
