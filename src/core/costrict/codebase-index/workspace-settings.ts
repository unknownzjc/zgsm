import * as vscode from "vscode"

/**
 * 工作区事件监控配置管理
 */
export class WorkspaceSettings {
	private static instance: WorkspaceSettings

	private constructor() {}

	public static getInstance(): WorkspaceSettings {
		if (!WorkspaceSettings.instance) {
			WorkspaceSettings.instance = new WorkspaceSettings()
		}
		return WorkspaceSettings.instance
	}

	/**
	 * 获取工作区事件监控配置
	 */
	public getWorkspaceEventConfig() {
		const config = vscode.workspace.getConfiguration("zgsm.workspaceEvents")
		return {
			enabled: config.get<boolean>("enabled", true),
			debounceMs: config.get<number>("debounceMs", 1000),
			batchSize: config.get<number>("batchSize", 50),
			maxRetries: config.get<number>("maxRetries", 3),
			retryDelayMs: config.get<number>("retryDelayMs", 1000),
		}
	}

	/**
	 * 监听配置变化
	 */
	public onConfigurationChanged(callback: () => void): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("zgsm.workspaceEvents")) {
				callback()
			}
		})
	}
}
