# ZGSM 代码透镜模块 (zgsm-codelens)

## 模块概述

ZGSM 代码透镜模块是一个 VS Code 代码透镜(CodeLens)功能的实现，为函数定义提供内联快捷操作按钮。该模块在代码编辑器中的函数定义上方显示可点击的按钮，让开发者能够快速执行各种代码相关的操作，如代码解释、优化、测试生成等。

## 主要功能

- 🔍 **智能代码透镜** - 在函数定义上方显示快捷操作按钮
- 📋 **多语言支持** - 支持多种编程语言的符号解析
- ⚙️ **可配置按钮** - 允许用户自定义显示哪些快捷操作
- 🎯 **上下文感知** - 根据代码上下文智能显示相关操作
- 🚀 **快速操作** - 一键执行代码分析、优化等操作
- 🔧 **节流控制** - 防止频繁操作导致的性能问题
- 📊 **诊断集成** - 集成 VS Code 诊断信息提供更好的上下文

## 文件结构

```
src/core/zgsm-codelens/
├── index.ts                  # 模块入口和导出
├── CodeLensProvider.ts       # 代码透镜提供者实现
├── CodeLensCallbacks.ts      # 代码透镜回调函数
└── types.ts                  # TypeScript 类型定义
```

## 核心类和接口

### MyCodeLensProvider 类

主要的代码透镜提供者，实现了 VS Code 的 [`CodeLensProvider`](src/core/zgsm-codelens/CodeLensProvider.ts:18) 接口。

```typescript
export class MyCodeLensProvider implements vscode.CodeLensProvider {
	// 提供代码透镜
	async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]>
}
```

### 主要接口

#### ICodeLensProvider 接口

```typescript
export interface ICodeLensProvider {
	provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>
}
```

#### CodeLensCommand 接口

```typescript
export interface CodeLensCommand {
	title: string // 按钮显示文本
	command: string // 执行的命令
	arguments?: any[] // 命令参数
}
```

#### CodeLensCallback 接口

```typescript
export interface CodeLensCallback {
	(args: any[]): void | Promise<void>
}
```

## 使用方法和示例

### 注册代码透镜提供者

```typescript
import * as vscode from "vscode"
import { MyCodeLensProvider } from "./src/core/zgsm-codelens"

export function activate(context: vscode.ExtensionContext) {
	// 注册代码透镜提供者
	const codelensProvider = new MyCodeLensProvider()

	// 为多种语言注册
	const languages = ["javascript", "typescript", "python", "java", "csharp"]

	languages.forEach((language) => {
		const disposable = vscode.languages.registerCodeLensProvider({ language }, codelensProvider)
		context.subscriptions.push(disposable)
	})
}
```

### 配置快捷操作按钮

在 VS Code 设置中配置要显示的按钮：

```json
{
	"FunctionQuickCommands.quickCommandButtons": {
		"explainCode": true,
		"optimizeCode": true,
		"generateTests": true,
		"addComments": false,
		"refactor": true
	}
}
```

### 自定义代码透镜操作

```typescript
import { CODELENS_FUNC } from "../zgsm-base/common/constant"

// 添加自定义操作
CODELENS_FUNC.customAction = {
	actionName: "自定义操作",
	tooltip: "执行自定义代码操作",
	command: "extension.customAction",
	key: "customAction",
}
```

### 处理代码透镜回调

```typescript
import { ClineProvider } from "../webview/ClineProvider"

// 注册命令处理器
vscode.commands.registerCommand("extension.customAction", async (documentSymbol, codelensItem) => {
	const editor = vscode.window.activeTextEditor
	if (!editor) return

	// 获取代码范围和内容
	const startLine = documentSymbol.range.start.line
	const endLine = documentSymbol.range.end.line
	const selectedText = editor.document.getText(documentSymbol.range)

	// 准备数据
	const data = {
		filePath: editor.document.uri.fsPath,
		selectedText,
		startLine: startLine.toString(),
		endLine: endLine.toString(),
	}

	// 调用处理函数
	await ClineProvider.handleCodeAction("customAction", "analyze", data)
})
```

## 工作流程说明

### 1. 代码透镜生成流程

```typescript
// 1. 检查是否启用代码透镜
if (!LangSetting.codelensEnabled) {
	return []
}

// 2. 检查语言支持
const language = getLanguageByFilePath(editor.document.uri.fsPath)
const langClass = getLanguageClass(language)
if (!langClass.checkCodelensEnabled()) {
	return []
}

// 3. 获取文档符号
const docSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", editor.document.uri)

// 4. 过滤可显示的符号
const showableSymbols = langClass.getShowableSymbols(docSymbols)

// 5. 为每个符号创建代码透镜
for (const symbol of showableSymbols) {
	// 创建 CodeLens 实例
	const codeLens = new vscode.CodeLens(range, command)
	results.push(codeLens)
}
```

### 2. 操作执行流程

```typescript
// 1. 用户点击代码透镜按钮
// 2. 触发 commonCodeLensFunc 函数
async function commonCodeLensFunc(editor: any, ...args: any) {
	// 3. 提取符号信息
	const documentSymbol = args[1]
	const codelensItem = args[2]

	// 4. 获取诊断信息
	const diagnostics = vscode.languages.getDiagnostics(docUri)

	// 5. 准备执行参数
	const data = {
		filePath,
		selectedText,
		startLine,
		endLine,
		diagnostics,
	}

	// 6. 执行操作
	await ClineProvider.handleCodeAction(command, actionType, data)
}
```

## 配置选项

### VS Code 设置

| 设置项                                                    | 类型    | 描述               | 默认值 |
| --------------------------------------------------------- | ------- | ------------------ | ------ |
| `FunctionQuickCommands.quickCommandButtons.explainCode`   | boolean | 显示"解释代码"按钮 | true   |
| `FunctionQuickCommands.quickCommandButtons.optimizeCode`  | boolean | 显示"优化代码"按钮 | true   |
| `FunctionQuickCommands.quickCommandButtons.generateTests` | boolean | 显示"生成测试"按钮 | false  |
| `FunctionQuickCommands.quickCommandButtons.addComments`   | boolean | 显示"添加注释"按钮 | false  |

### 语言设置

通过 [`LangSetting`](src/core/zgsm-codelens/CodeLensProvider.ts:24) 控制各语言的代码透镜行为：

```typescript
// 全局启用/禁用
LangSetting.codelensEnabled = true

// 按语言控制
LangSetting.setCodelensDisable("javascript", LangSwitch.Enabled)
LangSetting.setCodelensDisable("python", LangSwitch.Disabled)
```

## 支持的编程语言

| 语言       | 符号类型支持         | 特殊处理     |
| ---------- | -------------------- | ------------ |
| JavaScript | 函数、类、方法       | 支持箭头函数 |
| TypeScript | 函数、类、接口、方法 | 支持泛型     |
| Python     | 函数、类、方法       | 支持装饰器   |
| Java       | 类、方法、构造函数   | 支持注解     |
| C#         | 类、方法、属性       | 支持特性     |
| Go         | 函数、结构体、方法   | 支持接口     |

## API 参考

### MyCodeLensProvider 方法

| 方法                  | 参数                                               | 返回值                | 描述             |
| --------------------- | -------------------------------------------------- | --------------------- | ---------------- |
| `provideCodeLenses()` | `document: TextDocument, token: CancellationToken` | `Promise<CodeLens[]>` | 提供代码透镜列表 |

### 回调函数

| 函数                   | 参数                                   | 描述                 |
| ---------------------- | -------------------------------------- | -------------------- |
| `commonCodeLensFunc()` | `editor, documentSymbol, codelensItem` | 处理通用代码透镜操作 |
| `moreCodeLensFunc()`   | `editor, documentSymbol, codeLens`     | 处理"更多"按钮操作   |

### 节流函数

| 函数                           | 参数              | 描述                   |
| ------------------------------ | ----------------- | ---------------------- |
| `throttleCommonCodeLensFunc()` | `editor, ...args` | 节流版本的通用操作函数 |

## 性能优化

### 1. 节流控制

```typescript
// 使用节流函数防止频繁操作
const throttleCommonCodeLensFunc = throttle(commonCodeLensFunc, 2000)
```

### 2. 条件检查

```typescript
// 早期返回减少不必要的计算
if (!LangSetting.codelensEnabled) {
	return []
}

if (!langClass.checkCodelensEnabled()) {
	return []
}
```

### 3. 缓存机制

```typescript
// 缓存文档符号解析结果
const docSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", editor.document.uri)
```

## 错误处理

### 常见问题

| 问题           | 原因               | 解决方法       |
| -------------- | ------------------ | -------------- |
| 代码透镜不显示 | 语言不支持或被禁用 | 检查语言设置   |
| 按钮点击无响应 | 回调函数未注册     | 确保命令已注册 |
| 性能问题       | 频繁触发操作       | 使用节流函数   |

### 调试方法

```typescript
import { Logger } from "../zgsm-base/common/log-util"

// 启用调试日志
Logger.log("No quick commands are configured")
Logger.log("No DocumentSymbol was parsed, no codelens")
```

## 最佳实践

### 1. 按需显示

```typescript
// 根据上下文决定显示哪些按钮
if (!langClass.checkItemShowable(codelensItem, documentSymbol)) {
	continue
}
```

### 2. 用户体验

```typescript
// 提供清晰的按钮标题和提示
new vscode.CodeLens(range, {
	title: codelensItem.actionName,
	tooltip: codelensItem.tooltip,
	command: codelensItem.command,
	arguments: [documentSymbol, codelensItem],
})
```

### 3. 资源管理

```typescript
// 在扩展停用时清理资源
export function deactivate() {
	// 清理代码透镜相关资源
}
```

## 扩展开发

### 添加新的快捷操作

1. 在 [`CODELENS_FUNC`](src/core/zgsm-codelens/CodeLensCallbacks.ts:11) 中添加配置
2. 实现对应的命令处理函数
3. 在语言类中添加显示条件检查
4. 更新配置选项

### 支持新的编程语言

1. 创建对应的语言处理类
2. 实现符号解析逻辑
3. 添加语言特定的显示规则
4. 注册语言支持

这个模块为 VS Code 扩展提供了强大的代码透镜功能，让开发者能够直接在代码编辑器中快速访问各种代码操作工具。
