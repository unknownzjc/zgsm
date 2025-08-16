import { ILogger } from "../../../utils/logger"

/**
 * 版本 ID 接口
 */
export interface VersionId {
	major: number
	minor: number
	micro: number
}

/**
 * 工作区事件类型
 */
export type WorkspaceEventType =
	| "open_workspace" // 打开工作区
	| "close_workspace" // 关闭工作区
	| "add_file" // 添加了文件
	| "modify_file" // 修改了文件（编辑并保存才算修改文件）
	| "delete_file" // 删除了文件/文件夹
	| "rename_file" // 重命名或移动了文件/文件夹

/**
 * 工作区事件数据
 */
export interface WorkspaceEventData {
	eventType: WorkspaceEventType
	eventTime: number | string
	sourcePath: string
	targetPath?: string
}

/**
 * 工作区事件请求
 */
export interface WorkspaceEventRequest {
	workspace: string
	data: WorkspaceEventData[]
}

/**
 * 手动触发索引构建请求
 */
export interface IndexBuildRequest {
	workspace: string
	path: string
	type: "codegraph" | "embedding" | "all"
}

/**
 * 检测忽略文件请求
 */
export interface IgnoreFilesRequest {
	workspacePath: string
	workspaceName: string
	filePaths: string[]
}

/**
 * 索引状态信息
 */
export interface IndexStatusInfo {
	status: "success" | "failed" | "running" | "pending"
	process: number
	totalFiles: number
	totalSucceed: number
	totalFailed: number
	failedReason: string
	failedFiles: string[]
	processTs: number
	totalChunks?: number
}

/**
 * 索引状态响应
 */
export interface IndexStatusResponse {
	embedding: IndexStatusInfo
	codegraph: IndexStatusInfo
}

/**
 * 索引功能开关请求
 */
export interface IndexSwitchRequest {
	workspace: string
	switch: "on" | "off"
}

/**
 * API 通用响应
 */
export interface ApiResponse<T = any> {
	code: string | number
	message: string
	success: boolean
	data: T
}

/**
 * 请求头配置
 */
export interface RequestHeaders {
	"X-Request-ID": string
	"Client-ID": string
	Authorization: string
	"Server-Endpoint": string
}

/**
 * 版本信息接口
 */
export interface VersionInfo {
	versionId: VersionId
	appUrl: string
	infoUrl: string
	status?: "downloading" | "downloaded" | "failed"
}

/**
 * 平台响应接口
 */
export interface PlatformResponse {
	packageName: string
	os: string
	arch: string
	newest: VersionInfo
	versions: VersionInfo[]
}

/**
 * 包信息响应接口
 */
export interface PackageInfoResponse {
	packageName: string
	packageType: string
	fileName: string
	os: string
	arch: string
	size: number
	checksum: string
	sign: string
	checksumAlgo: string
	versionId: VersionId
	build: string
	description: string
}

/**
 * CodebaseIndex 管理器接口
 */
export interface ICodebaseIndexManager {
	/**
	 * 初始化客户端
	 */
	initialize(): Promise<void>

	/**
	 * 重启客户端
	 */
	restartClient(): Promise<void>

	/**
	 * 检查并升级客户端
	 */
	checkAndUpgradeClient(): Promise<"firstInstall" | "failed" | "upgraded" | "noUpdate" | "needZgsm">

	/**
	 * 设置日志提供者
	 * @param logger 日志提供者
	 */
	setLogger(logger: ILogger): void

	/**
	 * 设置服务器端点
	 * @param endpoint 服务器端点地址
	 */
	setServerEndpoint(endpoint: string): Promise<void>

	/**
	 * 发布工作区事件
	 * @param request 工作区事件请求
	 */
	publishWorkspaceEvents(request: WorkspaceEventRequest): Promise<ApiResponse<number>>

	/**
	 * 手动触发索引构建
	 * @param request 索引构建请求
	 */
	triggerIndexBuild(request: IndexBuildRequest): Promise<ApiResponse<number>>

	/**
	 * 探活检查
	 */
	healthCheck(): Promise<ApiResponse<number>>

	/**
	 * 检测忽略文件
	 * @param request 忽略文件请求
	 */
	checkIgnoreFiles(request: IgnoreFilesRequest): Promise<ApiResponse<boolean>>

	/**
	 * 查询索引状态
	 * @param workspace 工作区路径
	 */
	getIndexStatus(workspace: string): Promise<ApiResponse<IndexStatusResponse>>

	/**
	 * 索引功能开关
	 * @param request 开关请求
	 */
	toggleIndexSwitch(request: IndexSwitchRequest): Promise<ApiResponse<boolean>>
}

/**
 * 客户端配置接口
 */
export interface CodebaseIndexClientConfig {
	/**
	 * API 基础 URL，默认为 https://zgsm.sangfor.com/costrict
	 */
	baseUrl?: string
	/**
	 * 下载超时时间（毫秒），默认为 30000ms (30秒)
	 */
	downloadTimeout?: number
	/**
	 * 版本号，用于构建文件路径
	 */
	versionInfo?: VersionInfo
	/**
	 * 签名验证公钥，如果未提供则使用默认公钥
	 */
	publicKey?: string
}

/**
 * 客户端下载进度信息接口
 */
export interface DownloadProgress {
	/**
	 * 已下载的字节数
	 */
	downloaded: number
	/**
	 * 总字节数
	 */
	total: number
	/**
	 * 下载进度百分比 (0-100)
	 */
	progress: number
}

/**
 * 客户端下载结果接口
 */
export interface DownloadResult {
	/**
	 * 是否成功
	 */
	success: boolean
	/**
	 * 文件保存路径
	 */
	filePath?: string
	/**
	 * 错误信息
	 */
	error?: string
	/**
	 * 版本信息
	 */
	versionInfo?: VersionInfo
	/**
	 * 包信息
	 */
	packageInfo?: PackageInfoResponse
}
export interface ICostrictServiceInfo {
	potolocol: "http" | "https"
	port: number
	[key: string]: any
}
