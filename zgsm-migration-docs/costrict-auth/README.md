# ZGSM 认证管理模块 (costrict/auth)

## 模块概述

ZGSM 认证管理模块是一个完整的用户认证解决方案，负责处理用户登录、登出、Token 管理和认证状态维护。该模块采用单例模式设计，提供了安全可靠的认证服务。

## 主要功能

- 🔐 **用户登录认证** - 支持浏览器跳转登录流程
- 🔄 **Token 自动刷新** - 智能管理访问令牌的生命周期
- 💾 **认证状态持久化** - 本地安全存储用户认证信息
- 📡 **登录状态轮询** - 实时监控用户登录状态变化
- 🚪 **安全登出** - 完整的登出流程和状态清理
- 👤 **用户信息管理** - 获取和管理用户基本信息

## 文件结构

```
src/core/costrict/auth/
├── index.ts                 # 模块入口文件，导出所有公共接口
├── authService.ts          # 核心认证服务类
├── authApi.ts              # API 接口封装类
├── authStorage.ts          # 认证数据存储管理
├── authConfig.ts           # 认证配置管理
├── authCommands.ts         # VS Code 命令处理器
├── types.ts                # TypeScript 类型定义
└── ipc/                    # 进程间通信模块
    ├── client.ts           # IPC 客户端
    ├── server.ts           # IPC 服务端
    └── utils.ts            # IPC 工具函数
```

## 核心类和接口

### ZgsmAuthService

认证服务的核心类，采用单例模式实现。

```typescript
class ZgsmAuthService {
	// 初始化服务
	static initialize(clineProvider: ClineProvider): void

	// 获取实例
	static getInstance(): ZgsmAuthService

	// 启动登录流程
	async startLogin(): Promise<ZgsmLoginState>

	// 刷新Token
	async refreshToken(refreshToken: string, machineId: string, state: string): Promise<ZgsmAuthTokens>

	// 获取当前访问令牌
	async getCurrentAccessToken(): Promise<string | null>

	// 登出
	async logout(auto?: boolean): Promise<void>

	// 检查登录状态
	async checkLoginStatusOnStartup(): Promise<boolean>

	// 获取用户信息
	getUserInfo(): ZgsmUserInfo
}
```

### ZgsmAuthApi

API 接口封装类，处理与认证服务器的通信。

```typescript
class ZgsmAuthApi {
	// 获取用户登录状态
	async getUserLoginState(state: string, access_token: string): Promise<ZgsmLoginResponse>

	// 刷新用户Token
	async getRefreshUserToken(refreshToken: string, machineId: string, state: string): Promise<LoginTokenResponse>

	// 用户登出
	async logoutUser(state?: string, access_token?: string): Promise<void>
}
```

### ZgsmAuthStorage

认证数据存储管理类，负责Token和用户状态的持久化。

```typescript
class ZgsmAuthStorage {
	// 保存Token
	async saveTokens(tokens: ZgsmAuthTokens): Promise<void>

	// 获取Token
	async getTokens(): Promise<ZgsmAuthTokens | null>

	// 保存登录状态
	async saveLoginState(loginState: ZgsmLoginState): Promise<void>

	// 获取登录状态
	async getLoginState(): Promise<ZgsmLoginState | null>

	// 清除所有登录状态
	async clearAllLoginState(): Promise<void>
}
```

## 类型定义

### ZgsmLoginState

```typescript
interface ZgsmLoginState {
	state: string // 登录状态标识符
	status?: ZgsmAuthStatus // 认证状态
	machineId?: string // 机器标识符
}
```

### ZgsmAuthTokens

```typescript
interface ZgsmAuthTokens {
	access_token: string // 访问令牌
	refresh_token: string // 刷新令牌
	state: string // 本地状态标记
}
```

### ZgsmAuthStatus

```typescript
enum ZgsmAuthStatus {
	NOT_LOGGED_IN = "not_logged_in", // 未登录
	LOGGING_IN = "logging_in", // 登录中
	LOGGED_IN = "logged_in", // 已登录
	LOGIN_FAILED = "login_failed", // 登录失败
	TOKEN_EXPIRED = "token_expired", // Token过期
}
```

### ZgsmUserInfo

```typescript
interface ZgsmUserInfo extends CloudUserInfo {
	id?: string // 用户ID
	phone?: string | number // 电话号码
}
```

## 使用方法和示例

### 初始化认证服务

```typescript
import { ZgsmAuthService } from "./src/core/costrict/auth"

// 在插件激活时初始化
export async function activate(context: vscode.ExtensionContext) {
	const clineProvider = new ClineProvider(context)

	// 初始化认证服务
	ZgsmAuthService.initialize(clineProvider)

	// 检查启动时的登录状态
	const authService = ZgsmAuthService.getInstance()
	const isLoggedIn = await authService.checkLoginStatusOnStartup()

	if (isLoggedIn) {
		console.log("用户已登录")
	}
}
```

### 用户登录

```typescript
async function handleUserLogin() {
	try {
		const authService = ZgsmAuthService.getInstance()
		const loginState = await authService.startLogin()

		console.log("登录流程已启动，状态:", loginState.state)
		// 浏览器会自动打开登录页面
		// 服务会自动轮询登录状态直到完成
	} catch (error) {
		console.error("登录失败:", error)
		vscode.window.showErrorMessage(`登录失败: ${error.message}`)
	}
}
```

### 获取访问令牌

```typescript
async function makeAuthenticatedRequest() {
	const authService = ZgsmAuthService.getInstance()
	const accessToken = await authService.getCurrentAccessToken()

	if (!accessToken) {
		// 提示用户登录
		await ZgsmAuthService.openStatusBarLoginTip({
			errorTitle: "需要登录才能使用此功能",
			btnText: "立即登录",
		})
		return
	}

	// 使用访问令牌发起请求
	const response = await fetch(apiUrl, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	})
}
```

### 用户登出

```typescript
async function handleUserLogout() {
	try {
		const authService = ZgsmAuthService.getInstance()
		await authService.logout()

		console.log("用户已成功登出")
		vscode.window.showInformationMessage("已退出登录")
	} catch (error) {
		console.error("登出失败:", error)
	}
}
```

### 获取用户信息

```typescript
async function displayUserInfo() {
	const authService = ZgsmAuthService.getInstance()
	const userInfo = authService.getUserInfo()

	if (userInfo.name) {
		vscode.window.showInformationMessage(`当前用户: ${userInfo.name} (${userInfo.email})`)
	}
}
```

## 架构设计说明

### 单例模式

认证服务采用单例模式确保全局只有一个认证实例，避免状态不一致的问题。

### 自动Token刷新

服务会在Token即将过期前自动刷新，确保用户会话的连续性。刷新间隔基于Token的过期时间动态计算。

### 状态轮询机制

登录过程中使用轮询机制检查用户是否完成了浏览器端的认证，最大轮询60次，每次间隔5秒。

### 错误处理和重试

所有API调用都包含错误处理和重试机制，提高系统的稳定性和用户体验。

### 数据持久化

用户认证信息安全存储在VS Code的全局状态中，插件重启后能够恢复登录状态。

## API 参考

### 认证服务 API

| 方法                          | 参数                                                     | 返回值                    | 描述               |
| ----------------------------- | -------------------------------------------------------- | ------------------------- | ------------------ |
| `initialize()`                | `clineProvider: ClineProvider`                           | `void`                    | 初始化认证服务     |
| `getInstance()`               | -                                                        | `ZgsmAuthService`         | 获取服务实例       |
| `startLogin()`                | -                                                        | `Promise<ZgsmLoginState>` | 启动登录流程       |
| `logout()`                    | `auto?: boolean`                                         | `Promise<void>`           | 用户登出           |
| `getCurrentAccessToken()`     | -                                                        | `Promise<string \| null>` | 获取当前访问令牌   |
| `checkLoginStatusOnStartup()` | -                                                        | `Promise<boolean>`        | 检查启动时登录状态 |
| `refreshToken()`              | `refreshToken: string, machineId: string, state: string` | `Promise<ZgsmAuthTokens>` | 刷新Token          |
| `getUserInfo()`               | -                                                        | `ZgsmUserInfo`            | 获取用户信息       |

### 存储服务 API

| 方法                   | 参数                         | 返回值                            | 描述             |
| ---------------------- | ---------------------------- | --------------------------------- | ---------------- |
| `saveTokens()`         | `tokens: ZgsmAuthTokens`     | `Promise<void>`                   | 保存认证Token    |
| `getTokens()`          | -                            | `Promise<ZgsmAuthTokens \| null>` | 获取认证Token    |
| `saveLoginState()`     | `loginState: ZgsmLoginState` | `Promise<void>`                   | 保存登录状态     |
| `getLoginState()`      | -                            | `Promise<ZgsmLoginState \| null>` | 获取登录状态     |
| `clearAllLoginState()` | -                            | `Promise<void>`                   | 清除所有登录状态 |

### API 接口

| 方法                    | 参数                                                     | 返回值                        | 描述             |
| ----------------------- | -------------------------------------------------------- | ----------------------------- | ---------------- |
| `getUserLoginState()`   | `state: string, access_token: string`                    | `Promise<ZgsmLoginResponse>`  | 获取用户登录状态 |
| `getRefreshUserToken()` | `refreshToken: string, machineId: string, state: string` | `Promise<LoginTokenResponse>` | 刷新用户Token    |
| `logoutUser()`          | `state?: string, access_token?: string`                  | `Promise<void>`               | 用户登出API调用  |

## 配置选项

认证模块支持以下配置选项（通过 `ZgsmAuthConfig` 管理）：

- `defaultLoginBaseUrl` - 默认登录基础URL
- `defaultApiBaseUrl` - 默认API基础URL
- `waitLoginPollingInterval` - 登录轮询间隔（默认5秒）
- `tokenRefreshInterval` - Token刷新间隔（基于Token过期时间计算）

## 注意事项

1. **安全性**: 所有Token和敏感信息都经过安全存储，不会暴露在日志中
2. **网络异常**: 模块包含完整的网络异常处理和重试机制
3. **生命周期管理**: 记得在插件停用时调用 `dispose()` 方法清理资源
4. **并发控制**: 避免同时调用多个登录操作，服务内部会管理状态冲突

## 依赖关系

- `@roo-code/types` - 类型定义
- `vscode` - VS Code API
- 内部依赖: `zgsmUtils`, `joinUrl`, `getClientId` 等工具函数
