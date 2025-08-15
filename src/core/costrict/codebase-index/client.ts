import fs from "fs"
import { PlatformDetector } from "./platform"
import { VersionApi } from "./versionApi"
import { PackageInfoApi } from "./packageInfoApi"
import { FileDownloader, DownloadProgressCallback } from "./fileDownloader"
import {
	PlatformResponse,
	PackageInfoResponse,
	VersionInfo,
	VersionId,
	CodebaseIndexClientConfig,
	DownloadProgress,
	DownloadResult,
	WorkspaceEventRequest,
	IndexBuildRequest,
	IgnoreFilesRequest,
	IndexStatusResponse,
	IndexSwitchRequest,
	ApiResponse,
	RequestHeaders,
} from "./types"
import path from "path"
import { execPromise } from "./utils"
import getPort, { portNumbers } from "get-port"
import { v7 as uuidv7 } from "uuid"
import { createLogger, ILogger } from "../../../utils/logger"
import { Package } from "../../../shared/package"
import { exec } from "child_process"
import { getClientId } from "../../../utils/getClientId"

/**
 * codebase-index 客户端主类
 * 整合所有功能模块，提供完整的客户端下载和安装功能
 */
export class CodebaseIndexClient {
	private platformDetector: PlatformDetector
	private versionApi: VersionApi
	private packageInfoApi: PackageInfoApi
	private fileDownloader: FileDownloader
	private processName = "costrict"
	private logger: ILogger

	private config: Omit<Required<CodebaseIndexClientConfig>, "versionInfo"> & { versionInfo?: VersionInfo }
	private serverHost: string = ""
	private serverEndpoint: string = ""

	private serverName: string = "codebase-indexer"
	private clientId: string = getClientId()

	/**
	 * 构造函数
	 * @param config 客户端配置
	 */
	constructor(config: CodebaseIndexClientConfig = {}) {
		if (!config.baseUrl) {
			throw new Error("baseUrl is required")
		}
		this.logger = createLogger(Package.outputChannel)
		this.config = {
			baseUrl: config.baseUrl,
			downloadTimeout: config.downloadTimeout || 30_000,
			versionInfo: config.versionInfo,
			publicKey: config.publicKey || process.env.ZGSM_PUBLIC_KEY!,
		}

		if (!this.config.publicKey) {
			throw new Error("publicKey is required")
		}

		// 初始化所有功能模块
		this.platformDetector = new PlatformDetector()
		this.versionApi = new VersionApi(this.config.baseUrl)
		this.packageInfoApi = new PackageInfoApi(this.config.baseUrl)
		this.fileDownloader = new FileDownloader(
			this.config.baseUrl,
			this.config.publicKey,
			this.config.downloadTimeout,
		)
	}
	/**
	 * 设置服务器端点
	 * @param endpoint 服务器端点地址
	 */
	public setServerHost(host: string): void {
		this.serverHost = host
	}
	/**
	 * 设置服务器端点
	 * @param endpoint 服务器端点地址
	 */
	public setServerEndpoint(endpoint: string): void {
		this.serverEndpoint = endpoint
	}

	/**
	 * 设置客户端ID
	 * @param clientId 客户端ID
	 */
	public setClientId(clientId: string): void {
		this.clientId = clientId
	}

	/**
	 * 获取客户端ID
	 * @returns 客户端ID
	 */
	public getClientId(): string {
		return this.clientId
	}

	/**
	 * 获取请求头
	 * @param token 访问令牌
	 * @returns 请求头对象
	 */
	private getHeaders(token?: string): RequestHeaders {
		return {
			"X-Request-ID": uuidv7(),
			"Client-ID": this.clientId,
			Authorization: token ? `Bearer ${token}` : "",
			"Server-Endpoint": this.serverEndpoint,
		}
	}

	/**
	 * 发送HTTP请求
	 * @param url 请求URL
	 * @param options 请求选项
	 * @param token 访问令牌
	 * @returns 响应数据
	 */
	private async makeRequest<T>(url: string, options: RequestInit = {}, token?: string): Promise<ApiResponse<T>> {
		const headers = this.getHeaders(token)

		const defaultOptions: RequestInit = {
			headers: {
				...headers,
				"Content-Type": "application/json",
			},
		}

		const finalOptions: RequestInit = {
			...defaultOptions,
			...options,
			headers: {
				...defaultOptions.headers,
				...options.headers,
			},
		}

		try {
			const response = await fetch(url, finalOptions)

			if (!response.ok) {
				const errorData = await response.text()
				throw new Error(errorData)
			}

			const data: ApiResponse<T> = await response.json()
			return data
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${url} HTTP请求时发生错误: ${error.message}`)
			} else {
				throw new Error(`${url} HTTP请求时发生未知错误`)
			}
		}
	}

	/**
	 * 获取当前平台信息
	 * @returns 平台名称：'windows'、'darwin' 或 'linux'
	 */
	get platform(): string {
		return this.platformDetector.platform
	}

	/**
	 * 获取当前架构信息
	 * @returns 架构名称：'amd64' 或 'arm64'
	 */
	get arch(): string {
		return this.platformDetector.arch
	}

	/**
	 * 获取客户端版本列表
	 * @returns Promise<PlatformResponse> 返回平台版本信息
	 */
	async getVersionList(): Promise<PlatformResponse> {
		return this.versionApi.getVersionList()
	}

	/**
	 * 获取最新版本信息
	 * @returns Promise<VersionInfo> 返回最新版本信息
	 */
	async getLatestVersion(): Promise<VersionInfo> {
		return this.versionApi.getLatestVersion()
	}

	/**
	 * 检查是否有可用更新
	 * @param currentVersion 当前版本
	 * @returns Promise<boolean> 如果有可用更新返回 true，否则返回 false
	 */
	async shouldUpdate(currentVersion: VersionInfo): Promise<boolean> {
		return this.versionApi.shouldUpdate(currentVersion)
	}

	/**
	 * 获取指定版本的包信息
	 * @param version 版本字符串，格式为 "major.minor.micro"
	 * @returns Promise<PackageInfoResponse> 返回包信息响应
	 */
	async getPackageInfo(versionInfo: VersionInfo): Promise<PackageInfoResponse> {
		return this.packageInfoApi.getPackageInfo(versionInfo)
	}

	/**
	 * 下载并安装客户端（完整流程）
	 * @param version 版本字符串，格式为 "major.minor.micro"，如果未提供则使用最新版本
	 * @param targetPath 目标保存路径，如果未提供则使用默认路径
	 * @param onProgress 下载进度回调函数
	 * @returns Promise<DownloadResult> 返回下载结果
	 */
	async downloadAndInstallClient(
		versionInfo: VersionInfo,
		onProgress?: (progress: DownloadProgress) => void,
	): Promise<DownloadResult> {
		try {
			// 1. 获取版本信息

			const versionString = this.formatVersionId(versionInfo.versionId)

			// 2. 获取包信息
			const packageInfo = await this.getPackageInfo(versionInfo)

			// 3. 下载文件
			const downloadProgress = (downloaded: number, total: number, progress: number) => {
				if (onProgress) {
					onProgress({ downloaded, total, progress })
				}
			}
			const { targetPath } = this.getTargetPath(versionInfo)
			// 4. 保存文件
			const filePath = await this.fileDownloader.downloadClient(
				targetPath,
				versionInfo,
				packageInfo,
				downloadProgress,
			)

			return {
				success: true,
				filePath,
				versionInfo: versionInfo,
				packageInfo: packageInfo,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "下载和安装客户端时发生未知错误",
			}
		}
	}

	/**
	 * 取消当前下载操作
	 */
	cancelDownload(): void {
		this.fileDownloader.cancelDownload()
	}

	/**
	 * 停止已存在的客户端
	 */
	public async stopExistingClient(): Promise<void> {
		if (!(await this.isRunning())) {
			return
		}
		try {
			if (this.platformDetector.platform === "windows") {
				const exeName = this.processName.endsWith(".exe") ? this.processName : `${this.processName}.exe`
				await execPromise(`taskkill /F /IM "${exeName}" /T`)
			} else {
				await execPromise(`pkill -x "${this.processName}"`).catch(() => {})
			}
		} catch (error) {
			this.logger.warn(`Failed to stop existing ${this.processName} process: ${error}`)
		}
	}

	async isRunning(processName = this.processName): Promise<boolean> {
		try {
			let output: string
			switch (this.platform) {
				case "windows": {
					const exeName = processName.endsWith(".exe") ? processName : `${processName}.exe`
					output = await execPromise(`tasklist /fi "imagename eq ${exeName}"`)
					return output.toLowerCase().includes(exeName.toLowerCase())
				}
				case "darwin":
				case "linux":
					output = await execPromise(`pgrep -f ${processName}`)
					return output.trim().length > 0
				default:
					throw new Error("Unsupported platform")
			}
		} catch (e) {
			return false
		}
	}

	async startClient(versionInfo: VersionInfo, maxRetries = 3): Promise<void> {
		let attempts = 0
		const { targetPath } = this.getTargetPath(versionInfo)
		while (attempts < maxRetries) {
			attempts++
			try {
				const processOptions = {
					detached: true,
					stdio: "ignore" as const,
					encoding: "utf8" as const,
				}
				// 启动 costrict-keeper 管理端
				const port = await getPort({ port: portNumbers(8080, 65535) })
				const args = ["server", `--listen localhost:${port}`].join(" ")

				const command = this.platform === "windows" ? `"${targetPath}" ${args}` : `${targetPath} ${args}`
				const child = exec(command, processOptions)
				child.unref()
				// Wait a moment to check if the process is still running
				await new Promise((resolve) => setTimeout(resolve, attempts * 1000))
				const isRunning = await this.isRunning()
				if (isRunning) {
					await this.startService(versionInfo)
					break
				}
			} catch (err: any) {
				if (attempts >= maxRetries) {
					throw new Error(
						`Failed to start ${this.processName} process after multiple retries: ${err.message}`,
					)
				}
				await new Promise((resolve) => setTimeout(resolve, attempts * 1000))
			}
		}
	}
	/**
	 * 1.开始获取服务信息：5分钟内 5秒一次，超过5分钟后 30秒一次，直到获取到服务信息开始下一步
	 * 2.获取到 codebase-sync 服务地址信息（name， protocol，port）
	 */
	async startService(versionInfo: VersionInfo, retryTime = 0) {
		const { homeDir } = this.getTargetPath(versionInfo)
		const wellKnownPath = path.join(homeDir, ".costrict", "share", ".well-known.json")
		try {
			// 判断 wellKnownPath 文件是否存在
			if (!fs.existsSync(wellKnownPath)) {
				throw new Error("wellKnown 文件不存在")
			}

			// 读取 wellKnownPath
			const { services } = JSON.parse(fs.readFileSync(wellKnownPath, "utf-8"))
			const codebaseIndexerServiceConfig = services.find((service: any) => service.name === this.serverName)

			if (!codebaseIndexerServiceConfig) {
				throw new Error("Failed to find codebase-indexer service in well-known.json")
			}

			if (codebaseIndexerServiceConfig.status !== "running") {
				throw new Error("codebase-indexer service norun!")
			}

			await this.setServerHost(
				`${codebaseIndexerServiceConfig.protocol}://localhost:${codebaseIndexerServiceConfig.port}`,
			)
		} catch (error) {
			this.logger.error(`[CodebaseIndexService] ${error}`)
			// 文件不存在，等待 5 s后再次尝试
			const interval = retryTime < 5 * 60 * 1000 ? 5000 : 30_000
			await new Promise((resolve) => setTimeout(resolve, interval))
			await this.startService({ ...versionInfo }, retryTime + interval)
		}
	}

	/**
	 * 将 VersionId 对象格式化为版本字符串
	 * @param versionId 版本 ID 对象
	 * @returns 版本字符串
	 * @private
	 */
	private formatVersionId(versionId: VersionId): string {
		return `${versionId?.major}.${versionId?.minor}.${versionId?.micro}`
	}

	/**
	 * 获取文件存储路径信息
	 * @param fileName 文件名
	 * @returns 返回包含目标路径、目录和缓存目录的对象
	 */
	getTargetPath(
		versionInfo: VersionInfo,
		fileName: string = this.processName,
	): { targetPath: string; cacheDir: string; homeDir: string } {
		const platform = this.platformDetector.platform
		const homeDir = platform === "windows" ? process.env.USERPROFILE : process.env.HOME

		if (!homeDir) {
			throw new Error("Failed to determine home directory path")
		}

		// const arch = this.platformDetector.arch
		// const version = this.formatVersionId(versionInfo.versionId)
		const cacheDir = path.join(homeDir, ".costrict", "bin")
		// const targetDir = path.join(cacheDir, version, platform, arch)
		const targetPath = path.join(cacheDir, `${fileName}${platform === "windows" ? ".exe" : ""}`)

		return { targetPath, cacheDir, homeDir }
	}

	/**
	 * 发布工作区事件
	 * @param request 工作区事件请求
	 * @param token 访问令牌
	 * @returns Promise<ApiResponse<number>> 返回响应数据
	 */
	async publishWorkspaceEvents(
		request: WorkspaceEventRequest,
		token?: string,
		keepalive?: boolean,
	): Promise<ApiResponse<number>> {
		this.serverEndpointAndHostCheck()

		const url = `${this.serverHost}/codebase-indexer/api/v1/events`

		const options: RequestInit = {
			method: "POST",
			keepalive,
			body: JSON.stringify(request),
		}

		return this.makeRequest<number>(url, options, token)
	}

	/**
	 * 手动触发索引构建
	 * @param request 索引构建请求
	 * @param token 访问令牌
	 * @returns Promise<ApiResponse<number>> 返回响应数据
	 */
	async triggerIndexBuild(request: IndexBuildRequest, token?: string): Promise<ApiResponse<number>> {
		this.serverEndpointAndHostCheck()

		const url = `${this.serverHost}/codebase-indexer/api/v1/index`

		const options: RequestInit = {
			method: "POST",
			body: JSON.stringify(request),
		}

		return this.makeRequest<number>(url, options, token)
	}

	async sycnToken(token?: string) {
		// 获取 token
		this.serverEndpointAndHostCheck()
		const url = `${this.serverHost}/codebase-indexer/api/v1/token`

		const options: RequestInit = {
			method: "POST",
			body: JSON.stringify({
				clientId: this.clientId, // 客户ID
				accessToken: token, // 访问令牌
				serverEndpoint: this.serverEndpoint, // 云端服务端点
			}),
		}

		return this.makeRequest<number>(url, options, token)
	}
	/**
	 * 探活接口
	 * @param token 访问令牌
	 * @returns Promise<ApiResponse<number>> 返回响应数据
	 */
	async healthCheck(token?: string): Promise<ApiResponse<number>> {
		this.serverEndpointAndHostCheck()

		const url = `${this.serverHost}/codebase-indexer/api/v1/healthz`

		const options: RequestInit = {
			method: "GET",
		}

		return this.makeRequest<number>(url, options, token)
	}

	/**
	 * 检测忽略文件
	 * @param request 忽略文件请求
	 * @param token 访问令牌
	 * @returns Promise<ApiResponse<boolean>> 返回响应数据
	 */
	async checkIgnoreFiles(request: IgnoreFilesRequest, token?: string): Promise<ApiResponse<boolean>> {
		this.serverEndpointAndHostCheck()

		const url = `${this.serverHost}/codebase-indexer/api/v1/files/ignore`

		const options: RequestInit = {
			method: "POST",
			body: JSON.stringify(request),
		}

		return this.makeRequest<boolean>(url, options, token)
	}

	/**
	 * 查询索引状态
	 * @param clientId 客户端ID
	 * @param workspace 工作区路径
	 * @param token 访问令牌
	 * @returns Promise<ApiResponse<IndexStatusResponse>> 返回响应数据
	 */
	async getIndexStatus(workspace: string, token?: string): Promise<ApiResponse<IndexStatusResponse>> {
		this.serverEndpointAndHostCheck()

		const url = `${this.serverHost}/codebase-indexer/api/v1/index/status?workspace=${encodeURIComponent(workspace)}`

		const options: RequestInit = {
			method: "GET",
		}

		return this.makeRequest<IndexStatusResponse>(url, options, token)
	}

	/**
	 * 索引功能开关
	 * @param request 开关请求
	 * @param token 访问令牌
	 * @returns Promise<ApiResponse<boolean>> 返回响应数据
	 */
	async toggleIndexSwitch(request: IndexSwitchRequest, token?: string): Promise<ApiResponse<boolean>> {
		this.serverEndpointAndHostCheck()

		const url = `${this.serverHost}/codebase-indexer/api/v1/switch?workspace=${encodeURIComponent(request.workspace)}&switch=${request.switch}`

		const options: RequestInit = {
			method: "GET",
		}

		return this.makeRequest<boolean>(url, options, token)
	}

	serverEndpointAndHostCheck() {
		if (!this.serverEndpoint) {
			throw new Error("Server endpoint is required!")
		}

		if (!this.serverHost) {
			throw new Error("codebase-indexer service norun!")
		}
	}
}

// 默认导出主客户端类
export default CodebaseIndexClient
