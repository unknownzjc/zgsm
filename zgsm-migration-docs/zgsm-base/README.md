# ZGSM 基础核心模块 (zgsm-base)

## 模块概述

ZGSM 基础核心模块是整个 ZGSM 系统的基础架构层，提供了核心的基础设施和共享功能。该模块集成了代码补全、代码透镜、语言支持、国际化等功能，是其他模块的基础依赖。

## 主要功能

- 🚀 **插件激活管理** - 统一管理 ZGSM 插件的初始化和激活流程
- 🌐 **多语言支持** - 提供多种编程语言的特定功能和检测
- 🔧 **公共工具集** - 提供通用的工具函数和 VS Code 集成辅助函数
- ⚙️ **配置管理** - 统一管理插件配置和设置更新
- 📊 **状态管理** - 管理插件状态栏和用户界面状态
- 🔗 **模块集成** - 作为其他模块的集成中心和入口点

## 文件结构

```
src/core/zgsm-base/
├── index.ts                    # 模块入口，重新导出所有子模块
├── activate.ts                 # 插件激活和初始化逻辑
├── common/                     # 公共工具模块
│   ├── index.ts               # 公共模块入口
│   ├── constant.ts            # 常量定义
│   ├── lang-util.ts           # 语言相关工具函数
│   ├── log-util.ts            # 日志工具
│   ├── services.ts            # 核心服务
│   ├── util.ts                # 通用工具函数
│   └── vscode-util.ts         # VS Code 集成工具
├── data/                      # 数据文件
│   ├── index.ts               # 数据模块入口
│   └── language-extension-data.json  # 语言扩展数据
└── language/                  # 语言支持模块
    ├── index.ts               # 语言模块入口
    ├── base.ts                # 基础语言类
    ├── factory.ts             # 语言类工厂
    ├── LangClass.ts           # 语言类接口定义
    └── classes/               # 具体语言实现
        ├── index.ts           # 语言类集合入口
        ├── c.ts               # C 语言支持
        ├── cpp.ts             # C++ 语言支持
        ├── go.ts              # Go 语言支持
        ├── javascript.ts      # JavaScript 语言支持
        ├── python.ts          # Python 语言支持
        └── typescript.ts      # TypeScript 语言支持
```

## 核心类和接口

### 激活管理

#### activate(context, provider)

插件激活的主要入口函数，负责初始化所有 ZGSM 功能。

```typescript
async function activate(context: vscode.ExtensionContext, provider: ClineProvider): Promise<void>
```

**主要功能：**

- 初始化基础服务
- 注册代码补全提供者
- 设置配置监听器
- 创建状态栏组件
- 检查用户登录状态

#### initialize(provider)

初始化核心功能。

```typescript
async function initialize(provider: ClineProvider): Promise<void>
```

### 语言支持系统

#### LangClass 接口

定义语言特定功能的接口。

```typescript
interface LangClass {
	// 获取语言名称
	getName(): string

	// 获取文件扩展名
	getExtensions(): string[]

	// 语言特定的处理逻辑
	process(content: string): ProcessResult
}
```

#### BaseLangClass

所有语言类的基础实现。

```typescript
abstract class BaseLangClass implements LangClass {
	abstract getName(): string
	abstract getExtensions(): string[]

	// 通用处理方法
	protected parseCode(content: string): CodeAST
	protected analyzeStructure(ast: CodeAST): StructureInfo
}
```

#### getLanguageClass(languageId)

语言类工厂函数，根据语言 ID 返回对应的语言类实例。

```typescript
function getLanguageClass(languageId: string): LangClass | null
```

### 公共工具类

#### 配置管理

```typescript
// 配置常量
const configCompletion = "zgsm.completion"
const configCodeLens = "zgsm.codelens"

// 配置更新函数
function updateCompletionConfig(): void
function updateCodelensConfig(): void
```

#### VS Code 工具

```typescript
// VS Code 集成辅助函数
function getActiveEditor(): vscode.TextEditor | undefined
function getCurrentDocument(): vscode.TextDocument | undefined
function showProgress(title: string, task: () => Promise<void>): Promise<void>
```

## 使用方法和示例

### 插件激活

```typescript
import { activate as activateZgsm, deactivate as deactivateZgsm } from "./src/core/zgsm-base"
import { ClineProvider } from "./src/core/webview/ClineProvider"

export async function activate(context: vscode.ExtensionContext) {
	// 创建主要提供者
	const clineProvider = new ClineProvider(context)

	// 激活 ZGSM 核心功能
	await activateZgsm(context, clineProvider)

	console.log("ZGSM 插件已成功激活")
}

export function deactivate() {
	deactivateZgsm()
}
```

### 语言检测和处理

```typescript
import { getLanguageClass, LangName } from "./src/core/zgsm-base"

// 根据文件扩展名获取语言类
function processCodeFile(filePath: string, content: string) {
	const extension = path.extname(filePath).slice(1)
	const langClass = getLanguageClass(extension)

	if (langClass) {
		console.log(`检测到语言: ${langClass.getName()}`)

		// 使用语言特定的处理逻辑
		const result = langClass.process(content)
		return result
	}

	console.log("未支持的语言类型")
	return null
}
```

### 配置监听

```typescript
import * as vscode from "vscode"

// 监听配置变化
vscode.workspace.onDidChangeConfiguration((e) => {
	if (e.affectsConfiguration("zgsm.completion")) {
		console.log("代码补全配置已更新")
		updateCompletionConfig()
	}

	if (e.affectsConfiguration("zgsm.codelens")) {
		console.log("代码透镜配置已更新")
		updateCodelensConfig()
	}
})
```

## 支持的编程语言

| 语言       | 类名             | 文件扩展名            | 特殊功能           |
| ---------- | ---------------- | --------------------- | ------------------ |
| JavaScript | `JavaScriptLang` | `.js`, `.jsx`         | ES6+ 语法支持      |
| TypeScript | `TypeScriptLang` | `.ts`, `.tsx`         | 类型检查和智能提示 |
| Python     | `PythonLang`     | `.py`, `.pyw`         | 语法分析和导入检测 |
| Go         | `GoLang`         | `.go`                 | 包管理和接口分析   |
| C          | `CLang`          | `.c`, `.h`            | 预处理器和宏处理   |
| C++        | `CppLang`        | `.cpp`, `.hpp`, `.cc` | 面向对象特性支持   |

## API 参考

### 激活函数

| 函数           | 参数                                                 | 返回值          | 描述           |
| -------------- | ---------------------------------------------------- | --------------- | -------------- |
| `activate()`   | `context: ExtensionContext, provider: ClineProvider` | `Promise<void>` | 激活 ZGSM 功能 |
| `deactivate()` | -                                                    | `void`          | 停用 ZGSM 功能 |
| `initialize()` | `provider: ClineProvider`                            | `Promise<void>` | 初始化核心服务 |

### 语言支持 API

| 函数                            | 参数                 | 返回值              | 描述                 |
| ------------------------------- | -------------------- | ------------------- | -------------------- |
| `getLanguageClass()`            | `languageId: string` | `LangClass \| null` | 获取语言类实例       |
| `BaseLangClass.getName()`       | -                    | `string`            | 获取语言名称         |
| `BaseLangClass.getExtensions()` | -                    | `string[]`          | 获取支持的文件扩展名 |

### 配置管理 API

| 函数                       | 参数 | 返回值 | 描述             |
| -------------------------- | ---- | ------ | ---------------- |
| `updateCompletionConfig()` | -    | `void` | 更新代码补全配置 |
| `updateCodelensConfig()`   | -    | `void` | 更新代码透镜配置 |
