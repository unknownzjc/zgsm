import * as vscode from "vscode"
import type { ClineProvider } from "./../../webview/ClineProvider"
import * as fs from "fs"
import * as path from "path"
import { CodebaseIndexClient } from "./client"
import { PlatformDetector } from "./platform"
import {
	ICodebaseIndexManager,
	VersionInfo,
	CodebaseIndexClientConfig,
	WorkspaceEventRequest,
	IndexBuildRequest,
	IgnoreFilesRequest,
	IndexStatusResponse,
	IndexSwitchRequest,
	ApiResponse,
} from "./types"
import { TelemetryErrorType } from "../telemetry"
import { TelemetryService } from "@roo-code/telemetry"
import { ZgsmAuthApi, ZgsmAuthService, ZgsmAuthConfig } from "../auth"
import { getClientId } from "../../../utils/getClientId"
import { ILogger } from "../../../utils/logger"
import { getWorkspacePath } from "../../../utils/path"

/**
 * CodebaseIndex 管理器实现类（单例模式）
 * 负责管理 codebase-index 客户端的初始化、版本检查、升级和重启等操作
 */
export class ZgsmCodebaseIndexManager implements ICodebaseIndexManager {
	public static instance: ZgsmCodebaseIndexManager
	public client: CodebaseIndexClient | null = null
	private logger: ILogger | null = null
	private clineProvider: ClineProvider | null = null
	private platformDetector: PlatformDetector
	private isInitialized: boolean = false
	// private serverEndpoint = ""
	private preBuildInfo = {
		type: "",
		time: 0,
	}

	// 定时检测相关属性
	private healthCheckTimer: NodeJS.Timeout | null = null
	private healthCheckFailureCount: number = 0
	private isHealthCheckRunning: boolean = false

	// // 定时索引构建相关属性
	// private indexBuildPollTimer: NodeJS.Timeout | null = null
	// private isIndexBuildPollRunning: boolean = false

	// 防重复调用的缓存
	private pendingIndexStatusRequests = new Map<string, Promise<ApiResponse<IndexStatusResponse>>>()
	// 最近完成的请求缓存（防止短时间内重复调用）
	private recentCompletedRequests = new Map<string, { result: ApiResponse<IndexStatusResponse>; timestamp: number }>()

	// 常量定义
	private readonly HEALTH_CHECK_INTERVAL: number = 60000 // 1分钟
	private readonly MAX_FAILURE_COUNT: number = 2 // 最大失败次数
	// private readonly INDEX_BUILD_POLL_INTERVAL: number = 600_000 // 10分钟
	/**
	 * 私有构造函数，确保单例模式
	 */
	private constructor() {
		this.platformDetector = new PlatformDetector()
	}

	/**
	 * 获取单例实例
	 * @returns ZgsmCodebaseIndexManager 实例
	 */
	public static getInstance(): ZgsmCodebaseIndexManager {
		if (!ZgsmCodebaseIndexManager.instance) {
			ZgsmCodebaseIndexManager.instance = new ZgsmCodebaseIndexManager()
		}
		return ZgsmCodebaseIndexManager.instance
	}

	/**
	 * 设置日志提供者
	 * @param logger 日志提供者
	 */
	public setLogger(logger: ILogger): void {
		this.logger = logger
	}
	public setProvider(clineProvider: ClineProvider): void {
		this.clineProvider = clineProvider
	}

	/**
	 * 内部日志方法
	 * @param message 日志消息
	 * @param type 日志类型
	 * @param id 日志ID
	 */
	private log(message: string, type: "info" | "error" = "info", id: string = ""): void {
		// 如果没有提供日志提供者，使用 console.log
		if (this.logger?.[type]) {
			this.logger[type](`[${id}] ${message}`)
		} else {
			const logMessage = `[${new Date().toLocaleString()}] [${type}]${id ? ` [${id}] ` : ""} ${message}`
			console.log(logMessage)
		}
	}

	/**
	 * 初始化客户端
	 */
	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			this.log("CodebaseKeeper 客户端已经初始化，跳过", "info", "ZgsmCodebaseIndexManager")
			return
		}

		// 检查本地是否已安装客户端
		const localVersionInfo = await this.getLocalVersion()
		try {
			this.log("初始化 CodebaseKeeper 客户端", "info", "ZgsmCodebaseIndexManager")

			// 创建客户端配置
			const config: CodebaseIndexClientConfig = {
				downloadTimeout: 30_000,
				versionInfo: localVersionInfo,
			}

			// 创建客户端实例
			this.client = new CodebaseIndexClient(config)
			// 检查并升级客户端
			const state = await this.checkAndUpgradeClient()
			if (state === "failed") {
				throw new Error("客户端升级检测失败")
			}
			if (state === "needZgsm") {
				this.log("仅 Costrict 提供商支持此服务", "info", "ZgsmCodebaseIndexManager")
				return
			}

			// 停止所有定时任务
			this.stopHealthCheck()
			// this.stopIndexBuildPoll()

			const versionInfo = await this.getLocalVersion()
			await this.client!.startClient(versionInfo!, state !== "noUpdate")
			this.isInitialized = true
			this.log("CodebaseKeeper 客户端初始化成功", "info", "ZgsmCodebaseIndexManager")

			// 启动定时检测
			this.startHealthCheck()
			// this.triggerIndexBuildPoll()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "初始化 CodebaseKeeper 客户端时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}
	public async stopExistingClient() {
		await this.ensureClientInited()
		return await this.client!.stopExistingClient()
	}

	/**
	 * 重启客户端
	 */
	public async restartClient(): Promise<void> {
		try {
			this.log("开始重启 CodebaseKeeper 客户端", "info", "ZgsmCodebaseIndexManager")
			await this.ensureClientInited()

			// 重新初始化客户端
			this.isInitialized = false
			await this.initialize()

			this.log("CodebaseKeeper 客户端重启成功", "info", "ZgsmCodebaseIndexManager")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "重启 CodebaseKeeper 客户端时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 检查并升级客户端
	 */
	public async checkAndUpgradeClient(): Promise<"firstInstall" | "failed" | "upgraded" | "noUpdate" | "needZgsm"> {
		try {
			// 检查本地是否已安装客户端
			const localVersionInfo = await this.getLocalVersion()
			if (localVersionInfo?.status === "downloading") {
				this.log(
					`[sid: ${vscode.env.sessionId}] 客户端正在下载中，请稍后再试`,
					"info",
					"ZgsmCodebaseIndexManager",
				)
				return "noUpdate"
			}
			this.log("开始检查并升级 CodebaseKeeper 客户端", "info", "ZgsmCodebaseIndexManager")
			await this.ensureClientInited()
			// 获取最新版本信息
			const latestVersionInfo = await this.client!.getLatestVersion()
			this.log(
				`最新版本: ${latestVersionInfo?.versionId?.major}.${latestVersionInfo?.versionId?.minor}.${latestVersionInfo?.versionId?.micro}`,
				"info",
				"ZgsmCodebaseIndexManager",
			)

			if (!localVersionInfo || !fs.existsSync(this.client!.getTargetPath().targetPath)) {
				// 本地没有安装，直接安装最新版本
				await this.client!.stopExistingClient()
				this.log("本地未安装客户端，开始下载最新版本", "info", "ZgsmCodebaseIndexManager")
				await this.downloadAndInstallClient(latestVersionInfo)
				this.log("CodebaseKeeper 客户端检查和升级完成", "info", "ZgsmCodebaseIndexManager")
				return "firstInstall"
			} else {
				// 本地已安装，检查是否需要升级
				this.log(
					`本地版本: ${localVersionInfo?.versionId?.major}.${localVersionInfo?.versionId?.minor}.${localVersionInfo?.versionId?.micro}`,
					"info",
					"ZgsmCodebaseIndexManager",
				)

				const hasUpdate = await this.client!.shouldUpdate(localVersionInfo)

				if (hasUpdate) {
					await this.client!.stopExistingClient()
					this.log("检测到新版本，开始升级", "info", "ZgsmCodebaseIndexManager")
					await this.downloadAndInstallClient(latestVersionInfo)
					this.log("CodebaseKeeper 客户端检查和升级完成", "info", "ZgsmCodebaseIndexManager")
					return "upgraded"
				} else {
					this.log("当前版本已是最新，无需升级", "info", "ZgsmCodebaseIndexManager")
					return "noUpdate"
				}
			}
		} catch (error) {
			if (error.__NEED_ZGSM__) {
				return "needZgsm"
			}
			const errorMessage =
				error instanceof Error ? error.message : "检查并升级 CodebaseKeeper 客户端时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			return "failed"
		}
	}

	private async ensureClientInited() {
		if (!this.client) {
			throw new Error("客户端未初始化")
		}

		if (!this.clineProvider) {
			throw new Error("clineProvider 未初始化")
		}

		const { apiConfiguration } = await this.clineProvider.getState()

		if (apiConfiguration.apiProvider !== "zgsm") {
			const err = new Error("仅 Costrict 提供商支持此服务")
			Object.assign(err, { __NEED_ZGSM__: true })
			throw err
		}
	}

	/**
	 * 获取本地版本信息
	 * @returns 本地版本信息，如果不存在则返回 null
	 */
	private async getLocalVersion(): Promise<VersionInfo | undefined> {
		try {
			const platform = this.platformDetector.platform
			const homeDir = platform === "windows" ? process.env.USERPROFILE : process.env.HOME

			if (!homeDir) {
				throw new Error("无法确定用户主目录路径")
			}

			const versionDir = path.join(homeDir, ".costrict", "share")
			const versionFilePath = path.join(versionDir, "version.json")

			// 检查版本文件是否存在
			if (!fs.existsSync(versionFilePath)) {
				this.log("本地版本文件不存在", "info", "ZgsmCodebaseIndexManager")
				return
			}

			// 读取版本文件
			const versionContent = fs.readFileSync(versionFilePath, "utf8")
			const versionData = JSON.parse(versionContent)

			// 验证版本数据的基本结构
			if (!versionData || typeof versionData !== "object") {
				throw new Error("版本文件格式无效")
			}

			// 移除 updatedAt 字段，只返回 VersionInfo 数据
			const { updatedAt, ...versionInfo } = versionData

			this.log(`本地版本信息已读取: ${versionFilePath}`, "info", "ZgsmCodebaseIndexManager")

			return versionInfo as VersionInfo
		} catch (error) {
			if (error instanceof SyntaxError) {
				this.log(`本地版本文件解析失败: JSON 格式错误`, "error", "ZgsmCodebaseIndexManager")
			} else {
				this.log(
					`读取本地版本信息失败: ${error instanceof Error ? error.message : "未知错误"}`,
					"error",
					"ZgsmCodebaseIndexManager",
				)
			}
			return
		}
	}

	/**
	 * 下载并安装客户端
	 * @param versionInfo 版本信息
	 */
	private async downloadAndInstallClient(versionInfo: VersionInfo): Promise<void> {
		try {
			await this.saveLocalVersion({
				...versionInfo,
				status: "downloading",
			})
			const versionString = `${versionInfo?.versionId?.major}.${versionInfo?.versionId?.minor}.${versionInfo?.versionId?.micro}`
			this.log(`开始下载客户端版本: ${versionString}`, "info", "ZgsmCodebaseIndexManager")

			const result = await this.client!.downloadAndInstallClient(versionInfo, (progress) => {
				this.log(
					`下载进度: ${progress.progress}%, ${progress.downloaded}/${progress.total}`,
					"info",
					"ZgsmCodebaseIndexManager",
				)
			})

			if (result.success && result.filePath) {
				this.log(`客户端下载并安装成功: ${result.filePath}`, "info", "ZgsmCodebaseIndexManager")

				// 保存本地版本信息
				await this.saveLocalVersion({
					...versionInfo,
					status: "downloaded",
				})
			} else {
				// 保存本地版本信息
				await this.saveLocalVersion({
					...versionInfo,
					status: "failed",
				})
				throw new Error(result.error || "下载并安装客户端失败")
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "下载并安装客户端时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			// 保存本地版本信息
			await this.saveLocalVersion({
				...versionInfo,
				status: "failed",
			})
			throw new Error(errorMessage)
		}
	}

	/**
	 * 保存本地版本信息 1
	 * @param versionId 版本ID
	 */
	private async saveLocalVersion(versionInfo: VersionInfo): Promise<void> {
		try {
			const platform = this.platformDetector.platform
			const homeDir = platform === "windows" ? process.env.USERPROFILE : process.env.HOME

			if (!homeDir) {
				throw new Error("无法确定用户主目录路径")
			}

			const versionDir = path.join(homeDir, ".costrict", "share")
			const versionFilePath = path.join(versionDir, "version.json")

			// 确保目录存在
			if (!fs.existsSync(versionDir)) {
				fs.mkdirSync(versionDir, { recursive: true })
			}

			// 写入版本文件
			const versionData = {
				...versionInfo,
				updatedAt: new Date().toISOString(),
			}

			fs.writeFileSync(versionFilePath, JSON.stringify(versionData, null, 2), "utf8")

			this.log(`本地版本信息已保存: ${versionFilePath}`, "info", "ZgsmCodebaseIndexManager")
		} catch (error) {
			this.log(
				`保存本地版本信息失败: ${error instanceof Error ? error.message : "未知错误"}`,
				"error",
				"ZgsmCodebaseIndexManager",
			)
		}
	}
	recordError(type: TelemetryErrorType) {
		TelemetryService.instance.captureError(`CodeBaseError_${type}`)
	}

	/**
	 * 设置服务器端点
	 * @param endpoint 服务器端点地址
	 */
	public async setServerEndpoint(endpoint: string): Promise<void> {
		try {
			await this.ensureClientInited()
			this.log(`服务器端点已设置为: ${endpoint}`, "info", "ZgsmCodebaseIndexManager")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "设置服务器端点时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 发布工作区事件
	 * @param request 工作区事件请求
	 */
	public async publishWorkspaceEvents(request: WorkspaceEventRequest): Promise<ApiResponse<number>> {
		try {
			await this.ensureClientInited()
			// this.log(`发布工作区事件: ${request.workspace}`, "info", "ZgsmCodebaseIndexManager")
			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.publishWorkspaceEvents(request, token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "发布工作区事件时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 手动触发索引构建
	 * @param request 索引构建请求
	 */
	public async triggerIndexBuild(request: IndexBuildRequest): Promise<ApiResponse<number>> {
		if (this.preBuildInfo.type === request.type && Date.now() - this.preBuildInfo.time < 300)
			throw new Error("跳过重复触发索引构建：" + request.type)
		this.preBuildInfo.type = request.type
		this.preBuildInfo.time = Date.now()
		try {
			await this.ensureClientInited()
			this.log(`触发索引构建: ${request.workspace} - ${request.type}`, "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.triggerIndexBuild(request, token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "触发索引构建时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	// /**
	//  * 定时索引构建: 每十分钟触发一次
	//  */
	// triggerIndexBuildPoll(): void {
	// 	if (this.isIndexBuildPollRunning) {
	// 		this.log("定时索引构建已运行", "info", "ZgsmCodebaseIndexManager")
	// 		return
	// 	}

	// 	this.log("启动定时索引构建", "info", "ZgsmCodebaseIndexManager")
	// 	this.isIndexBuildPollRunning = true
	// 	this.indexBuildPollTimer = setInterval(async () => {
	// 		await this.performIndexBuildPoll()
	// 	}, this.INDEX_BUILD_POLL_INTERVAL)
	// }

	// /**
	//  * 停止定时索引构建
	//  */
	// public stopIndexBuildPoll(): void {
	// 	if (!this.isIndexBuildPollRunning) {
	// 		return
	// 	}

	// 	this.log("停止定时索引构建", "info", "ZgsmCodebaseIndexManager")

	// 	if (this.indexBuildPollTimer) {
	// 		clearInterval(this.indexBuildPollTimer)
	// 		this.indexBuildPollTimer = null
	// 	}

	// 	this.isIndexBuildPollRunning = false
	// }

	private async performIndexBuildPoll(): Promise<void> {
		try {
			const workspacePath = getWorkspacePath() || ""
			if (workspacePath) {
				await this.triggerIndexBuild({
					workspace: workspacePath,
					path: workspacePath,
					type: "all",
				})
				this.log("定时索引构建成功", "info", "ZgsmCodebaseIndexManager")
			} else {
				this.log("工作区路径为空，跳过定时索引构建", "info", "ZgsmCodebaseIndexManager")
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "定时索引构建发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
		}
	}

	/**
	 * 探活检查 1
	 */
	public async healthCheck(): Promise<{
		message: string
		status: string | boolean
		[key: string]: any
	}> {
		try {
			await this.ensureClientInited()
			this.log("执行探活检查", "info", "CostrictHealthCheck")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.healthCheck(
				`http://localhost:${this.client!.getCostrictServerPort(9527)}/healthz`,
				token,
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "探活检查时发生未知错误"
			this.log(errorMessage, "error", "CostrictHealthCheck")
			throw new Error(errorMessage)
		}
	}

	// token传递接口
	public async syncToken(): Promise<ApiResponse<number>> {
		try {
			await this.ensureClientInited()
			this.log("token更新", "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.syncToken(token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "token更新时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 检测忽略文件
	 * @param request 忽略文件请求 1
	 */
	public async checkIgnoreFiles(request: IgnoreFilesRequest): Promise<ApiResponse<boolean>> {
		try {
			await this.ensureClientInited()
			this.log(`检测忽略文件: ${request.workspacePath}`, "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.checkIgnoreFiles(request, token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "检测忽略文件时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 查询索引状态
	 * @param workspace 工作区路径 1
	 */
	public async getIndexStatus(workspace: string): Promise<ApiResponse<IndexStatusResponse>> {
		// 检查是否已有相同的请求在进行中
		const requestKey = `getIndexStatus:${workspace}`
		const now = Date.now()

		// 检查最近完成的请求（1秒内）
		const recentRequest = this.recentCompletedRequests.get(requestKey)
		if (recentRequest && now - recentRequest.timestamp < 1000) {
			this.log(
				`复用最近完成的查询索引状态请求结果: ${workspace} (${now - recentRequest.timestamp}ms前)`,
				"info",
				"ZgsmCodebaseIndexManager",
			)
			return recentRequest.result
		}

		if (this.pendingIndexStatusRequests.has(requestKey)) {
			// 如果已有相同请求在进行中，等待其完成并复用结果
			this.log(`复用正在进行的查询索引状态请求: ${workspace}`, "info", "ZgsmCodebaseIndexManager")
			return await this.pendingIndexStatusRequests.get(requestKey)!
		}
		const requestPromise = this._getIndexStatusInternal(workspace)
		this.pendingIndexStatusRequests.set(requestKey, requestPromise)

		try {
			const result = await requestPromise
			// 缓存结果1秒，防止短时间内重复调用
			this.recentCompletedRequests.set(requestKey, { result, timestamp: now })

			// 清理过期的缓存（保留最近5分钟的）
			for (const [key, cache] of this.recentCompletedRequests.entries()) {
				if (now - cache.timestamp > 300000) {
					// 5分钟
					this.recentCompletedRequests.delete(key)
				}
			}

			return result
		} finally {
			// 请求完成后清除缓存
			this.pendingIndexStatusRequests.delete(requestKey)
		}
	}

	/**
	 * 内部查询索引状态方法
	 * @param workspace 工作区路径
	 */
	private async _getIndexStatusInternal(workspace: string): Promise<ApiResponse<IndexStatusResponse>> {
		try {
			await this.ensureClientInited()

			// 添加调用栈信息来追踪调用来源
			this.log(`查询索引状态: ${workspace}`, "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.getIndexStatus(workspace, token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "查询索引状态时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 索引功能开关
	 * @param request 开关请求 1
	 */
	public async toggleIndexSwitch(request: IndexSwitchRequest): Promise<ApiResponse<boolean>> {
		try {
			await this.ensureClientInited()
			this.log(`切换索引功能: ${request.workspace} - ${request.switch}`, "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.toggleIndexSwitch(request, token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "切换索引功能时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	/**
	 * 读取访问令牌
	 * @returns 访问令牌 1
	 */
	async readAccessToken() {
		const zgsmAuthService = ZgsmAuthService.getInstance()
		const tokens = await zgsmAuthService.getTokens()
		if (!tokens) {
			throw new Error("readAccessToken 无法获取访问令牌")
		}
		return tokens.access_token
	}

	/**
	 * 启动定时检测
	 */
	private startHealthCheck(): void {
		if (this.isHealthCheckRunning) {
			this.log("健康检查已开启", "info", "CostrictHealthCheck")
			return
		}

		this.log("启动健康检查", "info", "CostrictHealthCheck")
		this.isHealthCheckRunning = true
		this.healthCheckTimer = setInterval(async () => {
			await this.performHealthCheck()
		}, this.HEALTH_CHECK_INTERVAL)
	}

	/**
	 * 停止定时检测
	 */
	public stopHealthCheck(): void {
		if (!this.isHealthCheckRunning) {
			return
		}

		this.log("停止定时检测", "info", "CostrictHealthCheck")

		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer)
			this.healthCheckTimer = null
		}

		this.isHealthCheckRunning = false
		this.healthCheckFailureCount = 0
	}

	/**
	 * 执行单次健康检查
	 */
	private async performHealthCheck(): Promise<void> {
		try {
			const data = await this.healthCheck()

			const [active, pids] = await this.client!.isRunning()
			if (active && (data.status === "success" || data.status === true)) {
				this.healthCheckFailureCount = 0 // 重置失败计数器

				this.log(
					`[pids: ${pids.join("|")} ] ${this.client?.processName} running`,
					"info",
					"CostrictHealthCheck",
				)
			} else {
				this.log(`健康检查异常`, "error", "CostrictHealthCheck")

				await this.handleHealthCheckFailure()
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "健康检查时发生未知错误"
			this.log(errorMessage, "error", "CostrictHealthCheck")
			await this.handleHealthCheckFailure()
		}
	}

	/**
	 * 处理健康检查失败
	 */
	private async handleHealthCheckFailure(): Promise<void> {
		this.healthCheckFailureCount++

		if (this.healthCheckFailureCount > this.MAX_FAILURE_COUNT) {
			this.log(
				`连续失败 ${this.healthCheckFailureCount} 次，超过阈值，准备重启客户端`,
				"error",
				"CostrictHealthCheck",
			)

			try {
				await this.restartClient()
				this.log("客户端重启成功，重置失败计数器", "info", "CostrictHealthCheck")
				this.healthCheckFailureCount = 0
			} catch (restartError) {
				const restartErrorMessage =
					restartError instanceof Error ? restartError.message : "重启客户端时发生未知错误"
				this.log(restartErrorMessage, "error", "CostrictHealthCheck")
			}
		} else {
			this.log(
				`健康检查失败次数: ${this.healthCheckFailureCount}/${this.MAX_FAILURE_COUNT}`,
				"info",
				"CostrictHealthCheck",
			)
		}
	}
}

// 导出单例实例
export const zgsmCodebaseIndexManager = ZgsmCodebaseIndexManager.getInstance()

// 导出接口和类型
export type {
	DownloadProgress,
	DownloadResult,
	CodebaseIndexClientConfig,
	VersionId,
	VersionInfo,
	PlatformResponse,
	PackageInfoResponse,
	WorkspaceEventRequest,
	IndexBuildRequest,
	IgnoreFilesRequest,
	IndexStatusResponse,
	IndexSwitchRequest,
	ApiResponse,
	RequestHeaders,
	WorkspaceEventType,
	WorkspaceEventData,
	IndexStatusInfo,
} from "./types"

// 默认导出管理器类
export default ZgsmCodebaseIndexManager
