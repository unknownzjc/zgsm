import * as vscode from "vscode"

/**
 * Workspace event monitoring configuration management
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
	 * Get workspace event monitoring configuration
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
	 * Listen for configuration changes
	 */
	public onConfigurationChanged(callback: () => void): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("zgsm.workspaceEvents")) {
				callback()
			}
		})
	}
}
