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
import { jwtDecode } from "jwt-decode"

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
	private serverEndpoint = ""
	private baseUrl = "https://zgsm.sangfor.com/costrict"
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
		if (this.logger?.info) {
			this.logger[type](`[${id}] ${message}`)
		} else {
			const prefix = [new Date().toLocaleString(), type, id]
				.filter((s) => s)
				.map((s) => `[${s}]`)
				.join(" ")
			console.log(`${prefix}${message}`)
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
			this.log("开始初始化 CodebaseKeeper 客户端", "info", "ZgsmCodebaseIndexManager")

			// 创建客户端配置
			const config: CodebaseIndexClientConfig = {
				baseUrl: this.baseUrl,
				downloadTimeout: 30_000,
				versionInfo: localVersionInfo,
			}

			// 创建客户端实例
			this.client = new CodebaseIndexClient(config)
			this.client.setServerEndpoint(this.serverEndpoint)
			// 检查并升级客户端
			const state = await this.checkAndUpgradeClient()
			if (state === "failed") {
				throw new Error("客户端升级检测失败")
			}
			await this.client!.stopExistingClient()
			if (state === "needZgsm") {
				this.log("仅 Costrict 提供商可用", "info", "ZgsmCodebaseIndexManager")

				return
			}
			const versionInfo = await this.getLocalVersion()
			await this.client!.startClient(versionInfo!)
			this.isInitialized = true
			this.log("CodebaseKeeper 客户端初始化成功", "info", "ZgsmCodebaseIndexManager")
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
	 * 写入访问令牌到文件
	 * @param accessToken 访问令牌
	 */
	public async writeAccessToken(accessToken: string) {
		try {
			this.log("开始写入访问令牌到文件", "info", "ZgsmCodebaseIndexManager")

			const platform = this.platformDetector.platform
			const homeDir = platform === "windows" ? process.env.USERPROFILE : process.env.HOME

			if (!homeDir) {
				throw new Error("无法确定用户主目录路径")
			}

			const tokenDir = path.join(homeDir, ".costrict", "share")
			const tokenFilePath = path.join(tokenDir, "auth.json")

			// 确保目录存在
			if (!fs.existsSync(tokenDir)) {
				fs.mkdirSync(tokenDir, { recursive: true })
			}
			// 写入令牌文件
			const jwt = jwtDecode(accessToken) as any
			const { zgsmBaseUrl } = await ZgsmAuthApi.getInstance().getApiConfiguration()
			const baseUrl = zgsmBaseUrl || ZgsmAuthConfig.getInstance().getDefaultApiBaseUrl()
			this.serverEndpoint = baseUrl
			this.baseUrl = `${baseUrl}/costrict`
			const config = {
				id: jwt.id,
				name: jwt.displayName,
				access_token: accessToken,
				machine_id: getClientId(),
				base_url: baseUrl,
			}
			fs.writeFileSync(tokenFilePath, JSON.stringify(config, null, 2), "utf8")
			this.sycnToken()
			this.log(`访问令牌已写入文件: ${tokenFilePath}`, "info", "ZgsmCodebaseIndexManager")
			return config
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "写入访问令牌时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
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
	public async checkAndUpgradeClient(): Promise<"fristInstall" | "failed" | "upgraded" | "noUpdate" | "needZgsm"> {
		try {
			this.log("开始检查并升级 CodebaseKeeper 客户端", "info", "ZgsmCodebaseIndexManager")
			await this.ensureClientInited()
			// 获取最新版本信息
			const latestVersionInfo = await this.client!.getLatestVersion()
			this.log(
				`最新版本: ${latestVersionInfo?.versionId?.major}.${latestVersionInfo?.versionId?.minor}.${latestVersionInfo?.versionId?.micro}`,
				"info",
				"ZgsmCodebaseIndexManager",
			)

			// 检查本地是否已安装客户端
			const localVersionInfo = await this.getLocalVersion()
			if (!localVersionInfo || !fs.existsSync(this.client!.getTargetPath(latestVersionInfo).targetPath)) {
				// 本地没有安装，直接安装最新版本
				await this.client!.stopExistingClient()
				this.log("本地未安装客户端，开始下载最新版本", "info", "ZgsmCodebaseIndexManager")
				await this.downloadAndInstallClient(latestVersionInfo)
				this.log("CodebaseKeeper 客户端检查和升级完成", "info", "ZgsmCodebaseIndexManager")
				return "fristInstall"
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
			const err = new Error("仅 Costrict 提供的 CodebaseKeeper 客户端支持此功能")
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
				await this.saveLocalVersion(versionInfo)
			} else {
				throw new Error(result.error || "下载并安装客户端失败")
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "下载并安装客户端时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
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
			this.client!.setServerEndpoint(endpoint)
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

	/**
	 * 探活检查 1
	 */
	public async healthCheck(): Promise<ApiResponse<number>> {
		try {
			await this.ensureClientInited()
			this.log("执行探活检查", "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.healthCheck(token)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "探活检查时发生未知错误"
			this.log(errorMessage, "error", "ZgsmCodebaseIndexManager")
			throw new Error(errorMessage)
		}
	}

	// token传递接口
	public async sycnToken(): Promise<ApiResponse<number>> {
		try {
			await this.ensureClientInited()
			this.log("token更新", "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.sycnToken(token)
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
			this.log(`检测忽略文件: ${request.workspace}`, "info", "ZgsmCodebaseIndexManager")

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
		try {
			await this.ensureClientInited()
			this.log(`查询索引状态: ${workspace}`, "info", "ZgsmCodebaseIndexManager")

			// 读取访问令牌
			const token = await this.readAccessToken()
			return await this.client!.getIndexStatus(this.clientId, workspace, token)
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

	private get clientId(): string {
		return this.client?.getClientId() || getClientId()
	}

	// todo: 实现其他方法
	async syncCodebase(filePaths: string[]): Promise<{
		success: boolean
		message?: string
		code?: string
	}> {
		this.log("todo: 开始同步代码库")
		return {
			success: true,
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
