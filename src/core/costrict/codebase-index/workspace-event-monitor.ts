import * as vscode from "vscode"
import { watch, FSWatcher } from "chokidar"
import { ZgsmCodebaseIndexManager } from "./index"
import { WorkspaceEventData, WorkspaceEventRequest } from "./types"
import { TelemetryService } from "@roo-code/telemetry"
import { CodeBaseError } from "../telemetry/constants"
import { ILogger } from "../../../utils/logger"
import { computeHash } from "../base/common"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { getWorkspacePath } from "../../../utils/path"

/**
 * 工作区事件监控配置
 */
export interface WorkspaceEventMonitorConfig {
	enabled: boolean
	debounceMs: number
	batchSize: number
	maxRetries: number
	retryDelayMs: number
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: WorkspaceEventMonitorConfig = {
	enabled: true,
	debounceMs: 1000,
	batchSize: 30,
	maxRetries: 2,
	retryDelayMs: 2000,
}

/**
 * 工作区事件监控器（单例模式）
 * 负责监听工作区事件并推送给服务端
 */
export class WorkspaceEventMonitor {
	private static instance: WorkspaceEventMonitor
	private isInitialized = false
	private config: WorkspaceEventMonitorConfig = { ...DEFAULT_CONFIG }
	private disposables: vscode.Disposable[] = []
	private eventBuffer: Map<string, WorkspaceEventData> = new Map()
	private flushTimer: NodeJS.Timeout | null = null
	private lastFlushTime = 0
	private ignoreFilename = ".coignore"
	private logger?: ILogger
	private ignoreController: RooIgnoreController
	// 用于解决命令行删除文件问题的文件系统监控器
	private fileSystemWatcher: FSWatcher | null = null

	// 用于解决无内容变更保存问题的文档状态跟踪
	private documentContentCache: Map<string, { contentHash: string; version: number }> = new Map()

	/**
	 * 私有构造函数，确保单例模式
	 */
	private constructor() {
		this.ignoreController = new RooIgnoreController(getWorkspacePath(), this.ignoreFilename)
		this.ignoreController.initialize().catch((error) => {
			this.log.error("[WorkspaceEventMonitor] 初始化忽略控制器失败:", error.message)
		})
	}

	private get log(): ILogger | Console {
		return this.logger || console
	}
	/**
	 * 获取单例实例
	 */
	public static getInstance(): WorkspaceEventMonitor {
		if (!WorkspaceEventMonitor.instance) {
			WorkspaceEventMonitor.instance = new WorkspaceEventMonitor()
		}
		return WorkspaceEventMonitor.instance
	}

	/**
	 * 初始化事件监控器
	 */
	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			this.log.info("[WorkspaceEventMonitor] 事件监控器已经初始化，跳过")
			return
		}

		try {
			this.log.info("[WorkspaceEventMonitor] 开始初始化事件监控器")

			// 注册VSCode事件监听器
			this.registerEventListeners()

			// 处理当前已打开的工作区
			this.handleInitialWorkspaceOpen()

			this.isInitialized = true
			this.log.info("[WorkspaceEventMonitor] 事件监控器初始化成功")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "初始化事件监控器时发生未知错误"
			this.log.error("[WorkspaceEventMonitor] 初始化失败:", errorMessage)
			// 在测试环境中跳过遥测服务
			try {
				if (TelemetryService.instance) {
					TelemetryService.instance.captureError(CodeBaseError.SyncFailed)
				}
			} catch {
				// 忽略遥测服务相关错误
			}
			throw new Error(errorMessage)
		}
	}

	/**
	 * 处理VSCode关闭事件
	 */
	public async handleVSCodeClose(): Promise<void> {
		this.log.info("[WorkspaceEventMonitor] 检测到VSCode关闭事件")

		// 发送工作区关闭事件
		await this.sendWorkspaceCloseEvents()

		// 继续销毁事件监控器
		await this.dispose()
	}

	/**
	 * 发送工作区关闭事件
	 */
	private async sendWorkspaceCloseEvents(): Promise<void> {
		if (!this.config.enabled) return

		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return
		}

		const workspace = this.getCurrentWorkspace()
		if (!workspace) {
			this.log.warn("[WorkspaceEventMonitor] 无法确定当前工作区")
			return
		}

		// 创建关闭事件
		const closeEvents: WorkspaceEventData[] = workspaceFolders.map((folder) => ({
			eventType: "close_workspace",
			eventTime: new Date().toISOString(),
			sourcePath: folder.uri.fsPath,
			targetPath: "",
		}))
		ZgsmCodebaseIndexManager.getInstance().client?.publishWorkspaceEvents(
			{
				workspace,
				data: closeEvents,
			},
			await ZgsmCodebaseIndexManager.getInstance().readAccessToken(),
			true,
		)
	}

	/**
	 * 销毁事件监控器
	 */
	public async dispose() {
		this.log.info("[WorkspaceEventMonitor] 开始销毁事件监控器")
		// 取消定时器
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}

		// 清理事件监听器
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []

		// 关闭文件系统监控器
		if (this.fileSystemWatcher) {
			this.fileSystemWatcher.close()
			this.fileSystemWatcher = null
			this.log.info("[WorkspaceEventMonitor] 文件系统监控器已关闭")
		}

		// 清理文档内容缓存
		this.documentContentCache.clear()
		this.log.info("[WorkspaceEventMonitor] 文档内容缓存已清理")

		// 发送剩余事件
		if (this.eventBuffer.size > 0) {
			await this.flushEventsSync()
		}

		this.isInitialized = false
		this.log.info("[WorkspaceEventMonitor] 事件监控器已销毁")
	}

	/**
	 * 更新配置
	 */
	public updateConfig(newConfig: Partial<WorkspaceEventMonitorConfig>): void {
		this.config = { ...this.config, ...newConfig }
		this.log.info("[WorkspaceEventMonitor] 配置已更新:", this.config)
	}

	/**
	 * 注册事件监听器
	 */
	private registerEventListeners(): void {
		// 安全地检查 VSCode API 是否存在
		if (typeof vscode === "undefined" || !vscode.workspace) {
			this.log.warn("[WorkspaceEventMonitor] VSCode API 不可用，跳过事件监听器注册")
			return
		}

		try {
			// 文件保存事件
			if (vscode.workspace.onDidSaveTextDocument) {
				this.disposables.push(vscode.workspace.onDidSaveTextDocument(this.handleDocumentSave.bind(this)))
			}

			// 文件删除/重命名事件
			if (vscode.workspace.onDidDeleteFiles) {
				this.disposables.push(vscode.workspace.onDidDeleteFiles(this.handleFileDelete.bind(this)))
			}
			if (vscode.workspace.onDidRenameFiles) {
				this.disposables.push(vscode.workspace.onDidRenameFiles(this.handleFileRename.bind(this)))
			}

			// 工作区文件夹变化事件
			if (vscode.workspace.onDidChangeWorkspaceFolders) {
				this.disposables.push(
					vscode.workspace.onDidChangeWorkspaceFolders(this.handleWorkspaceChange.bind(this)),
				)
			}

			// 扩展激活事件
			if (vscode.workspace.onWillCreateFiles) {
				this.disposables.push(vscode.workspace.onWillCreateFiles(this.handleWillCreateFiles.bind(this)))
			}

			// 注册文件系统监控器来解决命令行删除文件问题
			this.registerFileSystemWatcher()
		} catch (error) {
			this.log.warn("[WorkspaceEventMonitor] 注册事件监听器失败:", error)
		}
	}

	/**
	 * 注册文件系统监控器
	 */
	private registerFileSystemWatcher(): void {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.log.warn("[WorkspaceEventMonitor] 没有工作区文件夹，跳过文件系统监控器注册")
			return
		}

		// 监控所有工作区文件夹
		const watchPaths = workspaceFolders.map((folder) => folder.uri.fsPath)

		try {
			this.fileSystemWatcher = watch(watchPaths, {
				ignored: /(^|[\/\\])\../, // 忽略隐藏文件
				persistent: true,
				ignoreInitial: true, // 忽略初始扫描
				awaitWriteFinish: {
					stabilityThreshold: 1000,
					pollInterval: 100,
				},
			})

			// 监听文件删除事件
			this.fileSystemWatcher.on("unlink", (filePath: string) => {
				this.log.info(`[WorkspaceEventMonitor] 文件系统监控器检测到文件删除: ${filePath}`)
				this.handleFileSystemFileDelete(filePath)
			})

			this.log.info(`[WorkspaceEventMonitor] 文件系统监控器已注册，监控路径: ${watchPaths.join(", ")}`)
		} catch (error) {
			this.log.error("[WorkspaceEventMonitor] 注册文件系统监控器失败:", error)
		}
	}

	/**
	 * 处理文件系统检测到的文件删除事件
	 */
	private handleFileSystemFileDelete(filePath: string): void {
		if (!this.ignoreController.validateAccess(filePath)) return
		if (!this.config.enabled) return

		const eventKey = `delete:${filePath}`
		const eventData: WorkspaceEventData = {
			eventType: "delete_file",
			eventTime: new Date().toISOString(),
			sourcePath: filePath,
			targetPath: "",
		}

		this.addEvent(eventKey, eventData)
		this.log.info(`[WorkspaceEventMonitor] 文件系统删除事件已添加到缓冲区: ${filePath}`)
	}

	/**
	 * 处理文档打开事件
	 */
	private handleDocumentOpen(document: vscode.TextDocument): void {
		if (!this.config.enabled) return

		const uri = document.uri
		if (!this.ignoreController.validateAccess(uri.fsPath)) return
		if (uri.scheme !== "file") return

		const eventKey = `open:${uri.fsPath}`
		const eventData: WorkspaceEventData = {
			eventType: "add_file",
			eventTime: new Date().toISOString(),
			sourcePath: "",
			targetPath: uri.fsPath,
		}

		this.addEvent(eventKey, eventData)
	}

	/**
	 * 处理文档保存事件
	 */
	private handleDocumentSave(document: vscode.TextDocument): void {
		if (!this.config.enabled) return

		const uri = document.uri

		if (uri.scheme !== "file") return

		const filePath = uri.fsPath
		if (!this.ignoreController.validateAccess(filePath)) return
		const currentContentHash = computeHash(document.getText())
		const currentVersion = document.version

		// 调试日志：记录保存事件触发
		this.log.info(`[WorkspaceEventMonitor] 文档保存事件触发: ${filePath}`)
		this.log.info(`[WorkspaceEventMonitor] 文档语言ID: ${document.languageId}`)
		this.log.info(`[WorkspaceEventMonitor] 文档版本: ${currentVersion}`)
		this.log.info(`[WorkspaceEventMonitor] 文档内容hash: ${currentContentHash}`)

		// 检查文档内容是否真的发生了变化
		const cachedInfo = this.documentContentCache.get(filePath)
		let hasContentChanged = false

		if (cachedInfo) {
			// 比较内容
			hasContentChanged = cachedInfo.contentHash !== currentContentHash
			this.log.info(`[WorkspaceEventMonitor] 内容变更检查: ${hasContentChanged ? "有变更" : "无变更"}`)
			this.log.info(`[WorkspaceEventMonitor] 缓存版本: ${cachedInfo.version}, 当前版本: ${currentVersion}`)
		} else {
			this.log.info(`[WorkspaceEventMonitor] 首次保存文档，无缓存信息`)
		}

		// 更新缓存
		this.documentContentCache.set(filePath, {
			contentHash: currentContentHash,
			version: currentVersion,
		})

		// 只有在内容真正发生变化时才触发事件
		if (hasContentChanged) {
			this.log.info(`[WorkspaceEventMonitor] 文档内容有变更，触发修改事件`)
			const eventKey = `modify:${filePath}`
			const eventData: WorkspaceEventData = {
				eventType: "modify_file",
				eventTime: new Date().toISOString(),
				sourcePath: filePath,
				targetPath: filePath,
			}

			this.addEvent(eventKey, eventData)
		} else {
			this.log.info(`[WorkspaceEventMonitor] 文档内容无变更，跳过事件触发`)
		}
	}

	/**
	 * 处理文件删除事件
	 */
	private handleFileDelete(event: vscode.FileDeleteEvent): void {
		if (!this.config.enabled) return

		// 调试日志：记录删除事件触发
		this.log.info(`[WorkspaceEventMonitor] 文件删除事件触发，删除文件数量: ${event.files.length}`)
		this.log.info(`[WorkspaceEventMonitor] 删除事件时间: ${new Date().toISOString()}`)

		event.files.forEach((uri) => {
			if (!this.ignoreController.validateAccess(uri.fsPath)) return
			if (uri.scheme !== "file") return

			this.log.info(`[WorkspaceEventMonitor] 删除文件: ${uri.fsPath}`)
			this.log.info(`[WorkspaceEventMonitor] 删除文件 scheme: ${uri.scheme}`)

			const eventKey = `delete:${uri.fsPath}`
			const eventData: WorkspaceEventData = {
				eventType: "delete_file",
				eventTime: new Date().toISOString(),
				sourcePath: uri.fsPath,
				targetPath: "",
			}

			this.addEvent(eventKey, eventData)
		})
	}

	/**
	 * 处理文件重命名/移动事件
	 */
	private handleFileRename(event: vscode.FileRenameEvent): void {
		if (!this.config.enabled) return

		event.files.forEach(({ oldUri, newUri }) => {
			if (!this.ignoreController.validateAccess(newUri.fsPath)) return
			if (oldUri.scheme !== "file" || newUri.scheme !== "file") return

			const eventKey = `rename:${oldUri.fsPath}:${newUri.fsPath}`
			const eventData: WorkspaceEventData = {
				eventType: "rename_file",
				eventTime: new Date().toISOString(),
				sourcePath: oldUri.fsPath,
				targetPath: newUri.fsPath,
			}

			this.addEvent(eventKey, eventData)
		})
	}

	/**
	 * 处理工作区变化事件
	 */
	private handleWorkspaceChange(event: vscode.WorkspaceFoldersChangeEvent): void {
		if (!this.config.enabled) return

		// 处理新增的工作区
		event.added.forEach((folder) => {
			if (!this.ignoreController.validateAccess(folder.uri.fsPath)) return
			const eventKey = `workspace:open:${folder.uri.fsPath}`
			const eventData: WorkspaceEventData = {
				eventType: "open_workspace",
				eventTime: new Date().toISOString(),
				sourcePath: folder.uri.fsPath,
			}
			this.addEvent(eventKey, eventData)
		})

		// 处理移除的工作区
		event.removed.forEach((folder) => {
			if (!this.ignoreController.validateAccess(folder.uri.fsPath)) return
			const eventKey = `workspace:close:${folder.uri.fsPath}`
			const eventData: WorkspaceEventData = {
				eventType: "close_workspace",
				eventTime: new Date().toISOString(),
				sourcePath: folder.uri.fsPath,
			}
			this.addEvent(eventKey, eventData)
		})
	}

	/**
	 * 处理即将创建文件事件
	 */
	private handleWillCreateFiles(event: vscode.FileWillCreateEvent): void {
		if (!this.config.enabled) return

		event.files.forEach((uri) => {
			if (!this.ignoreController.validateAccess(uri.fsPath)) return
			if (uri.scheme !== "file") return

			const eventKey = `create:${uri.fsPath}`
			const eventData: WorkspaceEventData = {
				eventType: "add_file",
				eventTime: new Date().toISOString(),
				sourcePath: "",
				targetPath: uri.fsPath,
			}

			this.addEvent(eventKey, eventData)
		})
	}

	/**
	 * 处理工作区初始化打开事件
	 */
	private handleInitialWorkspaceOpen(): void {
		if (!this.config.enabled) return

		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return
		}

		workspaceFolders.forEach((folder) => {
			if (!this.ignoreController.validateAccess(folder.uri.fsPath)) return
			const eventKey = `workspace:initial:${folder.uri.fsPath}`
			const eventData: WorkspaceEventData = {
				eventType: "open_workspace",
				eventTime: new Date().toISOString(),
				sourcePath: folder.uri.fsPath,
			}
			this.addEvent(eventKey, eventData)
		})
	}

	/**
	 * 添加事件到缓冲区
	 */
	private addEvent(key: string, event: WorkspaceEventData): void {
		// 去重：使用事件键作为唯一标识符
		this.eventBuffer.set(key, event)

		// 检查是否需要立即刷新
		const now = Date.now()
		if (now - this.lastFlushTime >= this.config.debounceMs) {
			this.scheduleFlush()
		} else if (this.eventBuffer.size >= this.config.batchSize) {
			// 如果缓冲区已满，立即刷新
			this.flushEvents()
		}
	}

	/**
	 * 计划刷新事件
	 */
	private scheduleFlush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
		}

		this.flushTimer = setTimeout(async () => {
			try {
				await this.flushEvents()
			} catch (error) {
				this.log.error("[WorkspaceEventMonitor] 刷新事件时发生错误:", error)
				// 确保在错误情况下也重置定时器
			} finally {
				this.flushTimer = null
			}
		}, this.config.debounceMs)
	}

	/**
	 * 刷新事件到服务端
	 */
	private async flushEvents(): Promise<void> {
		if (this.eventBuffer.size === 0) return

		// 获取当前工作区
		const workspace = this.getCurrentWorkspace()
		if (!workspace) {
			this.log.warn("[WorkspaceEventMonitor] 无法确定当前工作区")
			return
		}

		// 准备事件数据
		const events = Array.from(this.eventBuffer.values())
		this.eventBuffer.clear()
		this.lastFlushTime = Date.now()

		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}

		// 发送到服务端
		await this.sendEventsToServer(workspace, events)
	}

	/**
	 * 同步刷新事件到服务端（用于VSCode关闭时的紧急发送）
	 */
	private async flushEventsSync(): Promise<void> {
		if (this.eventBuffer.size === 0) return

		// 获取当前工作区
		const workspace = this.getCurrentWorkspace()
		if (!workspace) {
			this.log.warn("[WorkspaceEventMonitor] 无法确定当前工作区")
			return
		}

		// 准备事件数据
		const events = Array.from(this.eventBuffer.values())
		this.eventBuffer.clear()
		this.lastFlushTime = Date.now()

		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}

		// 发送到服务端
		await this.sendEventsToServer(workspace, events)
	}

	/**
	 * 发送事件到服务端
	 */
	private async sendEventsToServer(workspace: string, events: WorkspaceEventData[]): Promise<void> {
		if (events.length === 0) return

		const request: WorkspaceEventRequest = {
			workspace,
			data: events,
		}
		const evts = [...new Set(events.map((v) => v.eventType))].join()
		let retryCount = 0
		const startTime = Date.now()
		const maxTotalRetryTime = 30000 // 30秒总重试时间限制

		while (retryCount <= this.config.maxRetries) {
			try {
				this.log.info(`[WorkspaceEventMonitor] ${evts} 发送 ${events.length} 个事件到服务端`)
				const response = await ZgsmCodebaseIndexManager.getInstance().publishWorkspaceEvents(request)

				if (response.success) {
					this.log.info(`[WorkspaceEventMonitor] ${evts} 事件发送成功，消息响应: ${response.data}`)
					return
				} else {
					this.log.warn(`[WorkspaceEventMonitor] ${evts} 事件发送失败: ${response.message}`)
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "未知错误"

				// 检查是否达到总重试时间限制（防止无限循环）
				const elapsedTime = Date.now() - startTime
				if (elapsedTime >= maxTotalRetryTime) {
					this.log.error(
						`[WorkspaceEventMonitor] ${evts} 达到总重试时间限制(${maxTotalRetryTime}ms)，放弃重试`,
					)
					break
				}

				if (retryCount < this.config.maxRetries) {
					// 使用指数退避策略
					const delayMs = Math.min(
						this.config.retryDelayMs * Math.pow(2, retryCount),
						10000, // 最大延迟10秒
					)
					this.log.error(`[WorkspaceEventMonitor] ${evts} 发送事件失败 (${delayMs}ms 后重试):`, errorMessage)
					this.log.info(`[WorkspaceEventMonitor] ${evts} ${retryCount + 1}/${this.config.maxRetries}重试失败`)
					await this.delay(delayMs)
					retryCount++
				} else {
					this.log.error(
						`[WorkspaceEventMonitor] ${evts} 达到最大重试次数(${this.config.maxRetries})，事件发送失败`,
					)
					try {
						TelemetryService.instance?.captureError?.(CodeBaseError.SyncFailed)
					} catch {
						// 忽略遥测服务相关错误
					}
					break // 明确退出循环
				}
			}
		}
	}

	/**
	 * 获取当前工作区路径
	 */
	private getCurrentWorkspace(): string | null {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return null
		}

		// 如果有多个工作区，使用第一个
		return workspaceFolders[0].uri.fsPath
	}

	/**
	 * 延迟函数
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	public setLogger(logger: ILogger): void {
		this.logger = logger
	}

	/**
	 * 获取当前状态
	 */
	public getStatus(): {
		isInitialized: boolean
		eventBufferSize: number
		config: WorkspaceEventMonitorConfig
	} {
		return {
			isInitialized: this.isInitialized,
			eventBufferSize: this.eventBuffer.size,
			config: { ...this.config },
		}
	}
}

/**
 * 全局工作区事件监控器实例
 */
export const workspaceEventMonitor = WorkspaceEventMonitor.getInstance()
