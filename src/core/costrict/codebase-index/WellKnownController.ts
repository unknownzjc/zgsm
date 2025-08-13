import path from "path"
import { fileExistsAtPath } from "../../../utils/fs"
import fs from "fs/promises"
import * as vscode from "vscode"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .coignore files.
 */
export class WellKnownController {
	protected homeDir: string
	protected filename = ".wellknown.json"
	protected disposables: vscode.Disposable[] = []
	protected config = {
		onChange(type: string): void {},
		onDisable() {},
	}
	wellKnownInitialized: boolean

	constructor(homeDir: string, opt = {}) {
		this.homeDir = homeDir
		this.wellKnownInitialized = false
		Object.assign(this.config, opt)
		// Set up file watcher for .coignore
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadWellKnown()
	}

	/**
	 * Set up the file watcher for .coignore changes
	 */
	protected setupFileWatcher(): void {
		const wellKnownPattern = new vscode.RelativePattern([this.homeDir, "share"].join("/"), this.filename)
		const fileWatcher = vscode.workspace.createFileSystemWatcher(wellKnownPattern)

		// Watch for changes and updates
		this.disposables.push(
			fileWatcher.onDidChange(() => {
				this.config.onChange("changed")
				// this.loadWellKnown()
			}),
			fileWatcher.onDidCreate(() => {
				this.config.onChange("created")
				// this.loadWellKnown()
			}),
			fileWatcher.onDidDelete(() => {
				this.config.onChange("deleted")
				// this.loadWellKnown()
			}),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(fileWatcher)
	}

	/**
	 * Load custom patterns from .coignore if it exists
	 */
	protected async loadWellKnown(): Promise<void> {
		// const content = (await Promise.all(rules)).join("\n")
		// if (content.trim().length > 0) {
		// 	this.ignoreInstance.add(content)
		// 	this.ignoreInstance.add(".coignore")
		// 	this.wellKnownInitialized = true
		// } else {
		// 	this.wellKnownInitialized = false
		// }
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	// validateAccess(filePath: string): boolean {
	// 	// Always allow access if .coignore does not exist
	// 	if (!this.wellKnownInitialized) {
	// 		return true
	// 	}
	// 	try {
	// 		// Normalize path to be relative to cwd and use forward slashes
	// 		const absolutePath = path.resolve(this.cwd, filePath)
	// 		const relativePath = path.relative(this.cwd, absolutePath).toPosix()

	// 		// Ignore expects paths to be path.relative()'d
	// 		return !this.ignoreInstance.ignores(relativePath)
	// 	} catch (error) {
	// 		// console.error(`Error validating access for ${filePath}:`, error)
	// 		// Ignore is designed to work with relative file paths, so will throw error for paths outside cwd. We are allowing access to all files outside cwd.
	// 		return true
	// 	}
	// }

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}
}
