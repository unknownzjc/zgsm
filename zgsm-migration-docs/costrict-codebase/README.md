# ZGSM 代码库同步模块 (costrict/codebase)

## 模块概述

ZGSM 代码库同步模块是一个基于 gRPC 的分布式代码库同步系统，负责在本地工作空间和远程服务器之间同步代码库状态。该模块提供了完整的代码库管理功能，包括文件同步、版本控制、进程管理和安全验证。

## 主要功能

- 🔄 **代码库同步** - 实时同步本地工作空间与远程服务器的代码库状态
- 🌐 **gRPC 通信** - 基于 Protocol Buffers 的高效通信协议
- 📦 **版本管理** - 自动检测和下载最新版本的同步客户端
- 🔐 **安全验证** - 文件校验和数字签名验证确保下载安全
- ⚡ **进程管理** - 智能管理同步守护进程的生命周期
- 🔍 **文件过滤** - 支持 .gitignore 风格的文件忽略规则
- 🔁 **自动重试** - 网络异常时的自动重试机制
- 📊 **状态监控** - 实时监控同步状态和进程健康度

## 文件结构

```
src/core/costrict/codebase/
├── index.ts                        # 模块入口和初始化函数
├── client.ts                       # 核心同步服务客户端类
├── fileDownloader.ts               # 安全文件下载器
├── codebase_syncer.proto           # gRPC 协议定义文件
└── types/                          # TypeScript 类型定义
    ├── index.ts                    # 类型模块入口
    ├── codebase_syncer.ts          # gRPC 服务类型定义
    └── google/protobuf/empty.ts    # Google Protobuf 空类型
```

## 核心类和接口

### ZgsmCodeBaseSyncService 类

主要的代码库同步服务类，采用单例模式设计。

```typescript
export class ZgsmCodeBaseSyncService {
	// 获取单例实例
	static getInstance(): ZgsmCodeBaseSyncService

	// 设置服务提供者
	static setProvider(provider: ClineProvider): void

	// 停止同步服务
	static async stopSync(): Promise<void>

	// 设置访问令牌
	setToken(token: string): void

	// 设置服务器端点
	setServerEndpoint(serverEndpoint: string): void

	// 启动同步服务
	async start(): Promise<string>
}
```

### gRPC 通信接口

#### 注册同步

```typescript
async registerSync(): Promise<RegisterSyncResponse>
```

#### 取消注册同步

```typescript
async unregisterSync(): Promise<void>
```

#### 分享访问令牌

```typescript
async shareAccessToken(): Promise<ShareAccessTokenResponse>
```

#### 同步代码库

```typescript
async syncCodebase(): Promise<SyncCodebaseResponse>
```

#### 检查忽略文件

```typescript
async checkIgnoreFile(filePaths: string[]): Promise<SyncCodebaseResponse>
```

### FileDownloader 类

安全的文件下载器，支持校验和验证和数字签名验证。

```typescript
export class FileDownloader {
	constructor(options: {
		downloadUrl: string
		targetPath: string
		checksum: string
		signature: string
		publicKey: string
		platform: string
		logger: (...args: any[]) => any
	})

	// 下载并验证文件
	async download(): Promise<void>
}
```

## 使用方法和示例

### 初始化代码库同步

```typescript
import { initZgsmCodeBase } from "./src/core/costrict/codebase"

// 初始化代码库同步服务
async function setupCodebaseSync() {
	const zgsmBaseUrl = "https://api.zgsm.ai"
	const zgsmApiKey = "your-api-key-here"

	try {
		await initZgsmCodeBase(zgsmBaseUrl, zgsmApiKey)
		console.log("代码库同步服务已成功初始化")
	} catch (error) {
		console.error("初始化失败:", error.message)
	}
}
```

### 手动控制同步服务

```typescript
import { ZgsmCodeBaseSyncService } from "./src/core/costrict/codebase/client"
import { ClineProvider } from "./src/core/webview/ClineProvider"

async function manualSyncControl() {
	// 设置提供者
	const provider = new ClineProvider(context)
	ZgsmCodeBaseSyncService.setProvider(provider)

	// 获取服务实例
	const syncService = ZgsmCodeBaseSyncService.getInstance()

	// 配置服务
	syncService.setServerEndpoint("https://api.zgsm.ai")
	syncService.setToken("your-access-token")

	// 启动同步
	const version = await syncService.start()
	console.log(`同步服务已启动，版本: ${version}`)

	// 手动同步代码库
	const syncResult = await syncService.syncCodebase()
	console.log("同步结果:", syncResult)
}
```

## 支持的平台

| 平台    | 架构        | 可执行文件   | 进程管理命令           |
| ------- | ----------- | ------------ | ---------------------- |
| Windows | amd64/arm64 | `shenma.exe` | `tasklist`, `taskkill` |
| macOS   | amd64/arm64 | `shenma`     | `pgrep`, `pkill`       |
| Linux   | amd64/arm64 | `shenma`     | `pgrep`, `pkill`       |

## API 参考

### 初始化函数

| 函数                 | 参数                                      | 返回值          | 描述             |
| -------------------- | ----------------------------------------- | --------------- | ---------------- |
| `initZgsmCodeBase()` | `zgsmBaseUrl: string, zgsmApiKey: string` | `Promise<void>` | 初始化代码库同步 |

### ZgsmCodeBaseSyncService 方法

| 方法                  | 参数               | 返回值                                         | 描述           |
| --------------------- | ------------------ | ---------------------------------------------- | -------------- |
| `getInstance()`       | -                  | `ZgsmCodeBaseSyncService`                      | 获取单例实例   |
| `setToken()`          | `token: string`    | `void`                                         | 设置访问令牌   |
| `setServerEndpoint()` | `endpoint: string` | `void`                                         | 设置服务器端点 |
| `start()`             | -                  | `Promise<string>`                              | 启动同步服务   |
| `registerSync()`      | -                  | `Promise<RegisterSyncResponse>`                | 注册同步       |
| `syncCodebase()`      | -                  | `Promise<SyncCodebaseResponse>`                | 同步代码库     |
| `updateCheck()`       | -                  | `Promise<{updated: boolean, version: string}>` | 检查更新       |
| `download()`          | `version: string`  | `Promise<void>`                                | 下载指定版本   |

### FileDownloader 方法

| 方法         | 参数 | 返回值          | 描述           |
| ------------ | ---- | --------------- | -------------- |
| `download()` | -    | `Promise<void>` | 下载并验证文件 |
