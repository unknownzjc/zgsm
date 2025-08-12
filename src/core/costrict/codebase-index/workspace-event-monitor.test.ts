import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { WorkspaceEventMonitor, workspaceEventMonitor } from "./workspace-event-monitor"
import { ZgsmCodebaseIndexManager } from "./index"

describe("WorkspaceEventMonitor", () => {
	let monitor: WorkspaceEventMonitor
	let mockCodebaseIndexManager: any

	beforeEach(() => {
		// 重置单例
		;(WorkspaceEventMonitor as any).instance = null
		monitor = WorkspaceEventMonitor.getInstance()

		// 设置默认配置
		monitor.updateConfig({
			enabled: true,
			debounceMs: 100,
			batchSize: 10,
			maxRetries: 1,
			retryDelayMs: 10,
		})

		// 模拟 ZgsmCodebaseIndexManager
		mockCodebaseIndexManager = {
			publishWorkspaceEvents: vi.fn().mockResolvedValue({
				success: true,
				data: 12345,
				message: "success",
			}),
		}
		;(ZgsmCodebaseIndexManager as any).getInstance = vi.fn().mockReturnValue(mockCodebaseIndexManager)
	})

	afterEach(() => {
		monitor.dispose()
		vi.clearAllMocks()
	})

	describe("单例模式", () => {
		it("应该返回同一个实例", () => {
			const instance1 = WorkspaceEventMonitor.getInstance()
			const instance2 = WorkspaceEventMonitor.getInstance()
			expect(instance1).toBe(instance2)
		})
	})

	describe("初始化和销毁", () => {
		it("应该成功初始化", async () => {
			await expect(monitor.initialize()).resolves.not.toThrow()
			await expect(monitor.initialize()).resolves.not.toThrow() // 重复初始化
			expect(monitor.getStatus().isInitialized).toBe(true)
		})

		it("应该正确销毁", async () => {
			await monitor.initialize()
			monitor.dispose()
			expect(monitor.getStatus().isInitialized).toBe(false)
		})
	})

	describe("配置管理", () => {
		it("应该更新配置", () => {
			const newConfig = { enabled: false, batchSize: 100 }
			monitor.updateConfig(newConfig)

			const status = monitor.getStatus()
			expect(status.config.enabled).toBe(false)
			expect(status.config.batchSize).toBe(100)
		})
	})

	describe("事件处理", () => {
		it("应该处理文档打开事件", () => {
			const mockDocument = {
				uri: {
					fsPath: "/test/file.txt",
					scheme: "file",
				},
				getText: () => "mock document content",
				version: 1,
			} as any

			monitor["handleDocumentOpen"](mockDocument)
			expect(monitor.getStatus().eventBufferSize).toBeGreaterThan(0)
		})

		it("应该过滤非文件协议的事件", () => {
			const mockDocument = {
				uri: {
					fsPath: "/test/file.txt",
					scheme: "http",
				},
				getText: () => "mock document content",
				version: 1,
			} as any

			monitor["handleDocumentOpen"](mockDocument)
			expect(monitor.getStatus().eventBufferSize).toBe(0)
		})

		it("应该处理文档保存事件", () => {
			const mockDocument = {
				uri: {
					fsPath: "/test/file.txt",
					scheme: "file",
				},
				getText: () => "mock document content",
				version: 1,
			} as any

			// 先设置一个不同的内容缓存，这样保存时会检测到变化
			monitor["documentContentCache"].set("/test/file.txt", {
				contentHash: "different-hash",
				version: 0,
			})

			monitor["handleDocumentSave"](mockDocument)
			expect(monitor.getStatus().eventBufferSize).toBeGreaterThan(0)
		})

		it("应该处理文件删除事件", () => {
			const mockEvent = {
				files: [
					{ fsPath: "/test/file1.txt", scheme: "file" },
					{ fsPath: "/test/file2.txt", scheme: "file" },
				],
			} as any

			monitor["handleFileDelete"](mockEvent)
			expect(monitor.getStatus().eventBufferSize).toBe(2)
		})

		it("应该处理文件重命名事件", () => {
			const mockEvent = {
				files: [
					{
						oldUri: { fsPath: "/test/old.txt", scheme: "file" },
						newUri: { fsPath: "/test/new.txt", scheme: "file" },
					},
				],
			} as any

			monitor["handleFileRename"](mockEvent)
			expect(monitor.getStatus().eventBufferSize).toBe(1)
		})

		it("应该处理工作区变化事件", () => {
			const mockEvent = {
				added: [{ uri: { fsPath: "/workspace/new", scheme: "file" } }],
				removed: [{ uri: { fsPath: "/workspace/old", scheme: "file" } }],
			} as any

			monitor["handleWorkspaceChange"](mockEvent)
			expect(monitor.getStatus().eventBufferSize).toBe(2)
		})

		it("应该处理文件创建事件", () => {
			const mockEvent = {
				files: [{ fsPath: "/test/new.txt", scheme: "file" }],
			} as any

			monitor["handleWillCreateFiles"](mockEvent)
			expect(monitor.getStatus().eventBufferSize).toBe(1)
		})

		it("应该遵守enabled配置", () => {
			monitor.updateConfig({ enabled: false })

			const mockDocument = {
				uri: {
					fsPath: "/test/file.txt",
					scheme: "file",
				},
				getText: () => "mock document content",
				version: 1,
			} as any

			monitor["handleDocumentOpen"](mockDocument)
			expect(monitor.getStatus().eventBufferSize).toBe(0)
		})
	})

	describe("事件去重", () => {
		it("应该去重相同的事件", () => {
			const mockDocument = {
				uri: {
					fsPath: "/test/file.txt",
					scheme: "file",
				},
				getText: () => "mock document content",
				version: 1,
			} as any

			// 多次触发相同事件
			monitor["handleDocumentOpen"](mockDocument)
			monitor["handleDocumentOpen"](mockDocument)
			monitor["handleDocumentOpen"](mockDocument)

			// 应该只保留最新的事件
			expect(monitor.getStatus().eventBufferSize).toBe(1)
		})
	})

	describe("全局实例", () => {
		it("应该提供全局实例", () => {
			expect(workspaceEventMonitor).toBeInstanceOf(WorkspaceEventMonitor)
		})
	})
})
