import * as vscode from "vscode"
import * as path from "path"
import { EventEmitter } from "events"
import { simpleGit, SimpleGit } from "simple-git"
import { ILogger } from "../../../utils/logger"
import ZgsmCodebaseIndexManager, { IndexBuildRequest } from "."

export interface CheckoutEvent {
	oldBranch: string | undefined
	newBranch: string
}

export class GitCheckoutDetector extends EventEmitter {
	private git: SimpleGit
	private lastBranch: string | undefined
	// 防抖时间戳
	private lastEmit?: NodeJS.Timeout

	constructor(private repoRoot: string) {
		super()
		this.git = simpleGit(repoRoot)
		this.init()
	}

	/** 返回 .git/HEAD 的绝对路径 */
	get headPath(): string {
		return path.join(this.repoRoot, ".git", "HEAD")
	}

	/** 初始化：读取当前分支 */
	private async init(): Promise<void> {
		try {
			this.lastBranch = await this.currentBranch()
		} catch {
			/* ignore */
		}
	}

	/** 对外暴露：当检测到 checkout 时触发 'checkout' 事件 */
	async onHeadChanged(): Promise<void> {
		clearTimeout(this.lastEmit)

		this.lastEmit = setTimeout(async () => {
			try {
				const newBranch = await this.currentBranch()
				// 校验：必须是本地分支
				if (!newBranch || !newBranch.startsWith("refs/heads/")) return

				const branchName = newBranch.replace("refs/heads/", "")
				if (branchName === this.lastBranch?.replace("refs/heads/", "")) return // 未改变

				const event: CheckoutEvent = {
					oldBranch: this.lastBranch,
					newBranch: branchName,
				}
				this.lastBranch = branchName
				this.emit("checkout", event)
			} catch {
				/* 读取失败时静默忽略 */
			}
		}, 1000)
	}

	/** 获取当前本地分支 ref；失败时返回 undefined */
	private async currentBranch(): Promise<string | undefined> {
		try {
			// 1. 先尝试拿本地分支 ref
			const ref = (await this.git.raw(["symbolic-ref", "HEAD"])).trim()
			return ref // 形如 refs/heads/main
		} catch {
			// 2. 失败说明可能是游离 HEAD，用短哈希当名字
			try {
				const sha = (await this.git.revparse(["--short", "HEAD"])).trim()
				return sha // 形如 a1b2c3d
			} catch {
				return undefined
			}
		}
	}
}

export function initGitCheckoutDetector(context: vscode.ExtensionContext, logger: ILogger) {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	if (!root) return

	const detector = new GitCheckoutDetector(root)

	// 用 VS Code 的 watcher 监听 .git/HEAD
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, ".git/HEAD"))
	watcher.onDidCreate(() => detector.onHeadChanged())
	watcher.onDidChange(() => detector.onHeadChanged())

	// 收到事件后弹通知
	detector?.on("checkout", async ({ oldBranch, newBranch }) => {
		oldBranch = oldBranch?.replace("refs/heads/", "")
		// newBranch
		try {
			const zgsmCodebaseIndexManager = ZgsmCodebaseIndexManager.getInstance()

			// 获取工作区路径
			const workspacePath = root
			const rebuildType = "all"
			const path = root

			// 构建 IndexBuildRequest
			const indexBuildRequest = {
				workspace: workspacePath,
				path: path,
				type: rebuildType,
			} as IndexBuildRequest

			// 调用 ZgsmCodebaseIndexManager.triggerIndexBuild()
			const result = await zgsmCodebaseIndexManager.triggerIndexBuild(indexBuildRequest)

			if (result.success) {
				vscode.window.showInformationMessage(`分支切换：${oldBranch ?? "(未知)"} → ${newBranch}`)
				logger.info(`[GitCheckoutDetector:${oldBranch} -> ${newBranch}] 成功触发索引重新构建: ${rebuildType}`)
			} else {
				logger.error(
					`[GitCheckoutDetector:${oldBranch} -> ${newBranch}] 触发索引重新构建失败: ${result.message}`,
				)
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "触发索引重新构建时发生未知错误"
			logger.error(`[GitCheckoutDetector:${oldBranch} -> ${newBranch}] ${errorMessage}`)
		}
	})

	context.subscriptions.push(watcher)
}
