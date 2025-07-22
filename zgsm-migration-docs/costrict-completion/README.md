# ZGSM AI 代码补全模块 (costrict/completion)

## 模块概述

ZGSM AI 代码补全模块是一个智能代码补全系统，基于大语言模型提供实时、上下文感知的代码建议。该模块集成了缓存机制、性能优化、用户反馈追踪等功能，为开发者提供流畅的编程体验。

## 主要功能

- 🤖 **AI 驱动补全** - 基于大语言模型的智能代码补全
- ⚡ **实时响应** - 低延迟的代码建议生成
- 🎯 **上下文感知** - 基于当前代码上下文提供精准建议
- 💾 **智能缓存** - 缓存机制提高响应速度
- 📊 **性能追踪** - 详细的性能指标和用户行为分析
- 🔧 **多模式支持** - 支持不同的补全模式和策略
- 📈 **评分系统** - 智能评估和排序补全建议
- 🌐 **多语言支持** - 支持多种编程语言
- 🔐 **认证集成** - 与 ZGSM 认证系统无缝集成

## 文件结构

```
src/core/costrict/completion/
├── index.ts                     # 模块入口和导出
├── CompletionProvider.ts        # AI 补全提供者实现
├── CompletionClient.ts          # 补全 API 客户端
├── types.ts                     # TypeScript 基础类型定义
├── completionDataInterface.ts   # 数据接口定义
├── completionPoint.ts           # 补全点管理
├── completionCache.ts           # 缓存机制
├── completionScore.ts           # 补全评分系统
├── completionStatusBar.ts       # 状态栏集成
├── completionTrace.ts           # 性能追踪
├── completionCommands.ts        # 补全相关命令
└── extractingImports.ts         # 导入依赖提取
```

## 核心类和接口

### AICompletionProvider 类

主要的补全提供者，实现了 VS Code 的 [`InlineCompletionItemProvider`](src/core/costrict/completion/CompletionProvider.ts:42) 接口。

```typescript
export class AICompletionProvider implements InlineCompletionItemProvider, Disposable {
	// 提供内联代码补全
	provideInlineCompletionItems(
		document: TextDocument,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken,
	): ProviderResult<InlineCompletionList>
}
```

### CompletionClient 类

处理与大语言模型 API 的通信，提供 [`callApi`](src/core/costrict/completion/CompletionClient.ts:72) 方法。

```typescript
export class CompletionClient {
	// 调用 API 获取补全结果
	static async callApi(
		cp: CompletionPoint,
		scores: CompletionScores,
		latestCompletion: CompletionPoint | undefined,
	): Promise<string>
}
```

### 主要接口

#### ICompletionProvider 接口

```typescript
export interface ICompletionProvider {
	provideInlineCompletionItems(
		document: TextDocument,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken,
	): ProviderResult<InlineCompletionList>
}
```

#### CompletionPrompt 接口

```typescript
export interface CompletionPrompt {
	prefix: string // 光标前的所有代码
	suffix: string // 光标后的所有代码
	cursor_line_prefix: string // 光标所在行的前缀
	cursor_line_suffix: string // 光标所在行的后缀
}
```

#### CompletionResponse 接口

```typescript
export interface CompletionResponse {
	text: string // 补全文本
	confidence: number // 置信度
	metadata: CompletionMetadata // 元数据
}
```

## 使用方法和示例

### 注册补全提供者

```typescript
import * as vscode from "vscode"
import { AICompletionProvider } from "./src/core/costrict/completion"

export function activate(context: vscode.ExtensionContext) {
	// 创建补全提供者实例
	const completionProvider = new AICompletionProvider(context)

	// 注册内联补全提供者
	const disposable = vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" }, // 支持所有文件类型
		completionProvider,
	)

	context.subscriptions.push(disposable)
	context.subscriptions.push(completionProvider)
}
```

### 配置补全设置

```typescript
import { workspace } from "vscode"

// 获取补全相关配置
const config = workspace.getConfiguration("zgsm.completion")

const completionSettings = {
	enabled: config.get<boolean>("enabled", true),
	maxSuggestions: config.get<number>("maxSuggestions", 3),
	debounceMs: config.get<number>("debounceMs", 300),
	cacheEnabled: config.get<boolean>("cacheEnabled", true),
}
```

## 工作流程说明

### 1. 补全触发流程

用户输入代码时，系统会自动触发补全流程：

1. **检查触发条件** - 验证是否满足补全触发条件
2. **创建补全点** - 基于当前位置创建 [`CompletionPoint`](src/core/costrict/completion/completionPoint.ts:32) 实例
3. **缓存检查** - 查找是否有缓存的补全结果
4. **API 调用** - 向大语言模型发送请求
5. **结果处理** - 处理响应并创建补全项
6. **用户反馈** - 追踪用户接受或拒绝补全的行为

### 2. 用户反馈处理

系统会追踪用户对补全建议的反馈：

- **接受** ([`CompletionAcception.Accepted`](src/core/costrict/completion/completionDataInterface.ts:42)) - 用户按 Tab 键接受建议
- **拒绝** ([`CompletionAcception.Rejected`](src/core/costrict/completion/completionDataInterface.ts:43)) - 用户输入不同内容
- **取消** ([`CompletionAcception.Canceled`](src/core/costrict/completion/completionDataInterface.ts:41)) - 用户切换位置或编辑前面内容

## 配置选项

### VS Code 设置

| 设置项                           | 类型    | 描述           | 默认值 |
| -------------------------------- | ------- | -------------- | ------ |
| `zgsm.completion.enabled`        | boolean | 启用AI代码补全 | true   |
| `zgsm.completion.maxSuggestions` | number  | 最大建议数量   | 3      |
| `zgsm.completion.debounceMs`     | number  | 防抖延迟(毫秒) | 300    |
| `zgsm.completion.cacheEnabled`   | boolean | 启用缓存       | true   |

### 认证配置

模块通过 [`getApiConfig`](src/core/costrict/completion/CompletionClient.ts:48) 方法获取API配置，集成了ZGSM认证系统：

```typescript
const apiConfig = {
	baseUrl: ZgsmAuthConfig.getInstance().getDefaultApiBaseUrl(),
	completionUrl: "/code-completion/api/v1",
	apiKey: tokens?.access_token || NOT_PROVIDERED,
}
```

## 支持的编程语言

该模块支持多种编程语言，通过 [`getLanguageByFilePath`](src/core/costrict/completion/CompletionProvider.ts:35) 自动识别：

| 语言       | 支持程度 | 特殊功能         |
| ---------- | -------- | ---------------- |
| JavaScript | 完全支持 | ES6+语法、JSX    |
| TypeScript | 完全支持 | 类型推导、泛型   |
| Python     | 完全支持 | 类型提示、装饰器 |
| Java       | 完全支持 | 注解、泛型       |
| C#         | 完全支持 | LINQ、异步       |
| Go         | 完全支持 | 接口、协程       |

## API 参考

### AICompletionProvider 方法

| 方法                             | 参数                                 | 返回值                          | 描述       |
| -------------------------------- | ------------------------------------ | ------------------------------- | ---------- |
| `provideInlineCompletionItems()` | `document, position, context, token` | `Promise<InlineCompletionList>` | 提供补全项 |
| `dispose()`                      | 无                                   | `void`                          | 清理资源   |

### CompletionClient 方法

| 方法            | 参数                                        | 返回值            | 描述        |
| --------------- | ------------------------------------------- | ----------------- | ----------- |
| `callApi()`     | `completionPoint, scores, latestCompletion` | `Promise<string>` | 调用补全API |
| `setProvider()` | `provider: ClineProvider`                   | `Promise<void>`   | 设置提供者  |
| `getProvider()` | 无                                          | `ClineProvider`   | 获取提供者  |

## 性能优化

### 1. 缓存机制

通过 [`CompletionCache`](src/core/costrict/completion/completionCache.ts) 类提供智能缓存，减少重复API调用。

### 2. 并发控制

使用 [`Mutex`](src/core/costrict/completion/CompletionProvider.ts:46) 防止并发请求导致的问题。

### 3. 评分系统

通过 [`CompletionScores`](src/core/costrict/completion/completionScore.ts) 对补全建议进行评分排序。

## 错误处理

### 常见问题

| 问题       | 原因     | 解决方法                                                                               |
| ---------- | -------- | -------------------------------------------------------------------------------------- |
| 补全不显示 | 认证失败 | 检查 [`ZgsmAuthService`](src/core/costrict/completion/CompletionClient.ts:79) 登录状态 |
| 响应缓慢   | 网络延迟 | 启用缓存机制                                                                           |
| 内存占用高 | 缓存过大 | 调整缓存大小限制                                                                       |

### 调试支持

使用 [`Logger`](src/core/costrict/completion/CompletionClient.ts:10) 记录详细的运行信息，便于问题诊断。

## 最佳实践

1. **合理配置缓存** - 根据使用场景调整缓存大小
2. **监控性能指标** - 使用 [`CompletionTrace`](src/core/costrict/completion/completionTrace.ts) 追踪性能
3. **处理用户反馈** - 分析 [`CompletionFeedback`](src/core/costrict/completion/completionDataInterface.ts:28) 优化体验
4. **资源管理** - 正确使用 [`Disposable`](src/core/costrict/completion/CompletionProvider.ts:42) 模式

这个模块为VS Code扩展提供了强大的AI代码补全功能，通过智能算法和用户反馈不断改进补全质量，显著提升开发效率。
