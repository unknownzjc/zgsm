import * as vscode from "vscode"

interface ExpectedGhostTextAcceptance {
	documentUri: string
	documentVersion: number
	text: string
	startLine: number
	startCharacter: number
	endLine: number
	endCharacter: number
}

/**
 * This singleton tracks whether a given ghost text is accepted or not.
 * We need this because there is no clean way of determining if a ghost text has been accepted outside of vscode command callback.
 * The above mentioned callback is not viable because it's too slow.
 * We need a way to reject model predictions on cursor movement, but cursor can move due to many reasons -- one being accepting a ghost text.
 * We need to differentiate the ghost text acceptance from a deliberate cursor movement to reject the completion.
 * The cursor movement event listener fires much before the vscode command callback, so the chain of edits often breaks when cursor moves due to accepting a ghost text.
 * This is not what we want, as we want to keep the current chain of edits alive when the user accepts the completion.
 */
export class TextAcceptanceTracker {
	private static instance: TextAcceptanceTracker | undefined
	private expectedAcceptance: ExpectedGhostTextAcceptance | null = null

	// 上一次补全的状态记录
	private lastCompletionAccepted: boolean = false
	private lastCompletionTimestamp: number = 0
	private lastCompletionId: string = ""

	private constructor() {}

	public static getInstance(): TextAcceptanceTracker {
		if (!TextAcceptanceTracker.instance) {
			TextAcceptanceTracker.instance = new TextAcceptanceTracker()
		}
		return TextAcceptanceTracker.instance
	}

	public static clearInstance() {
		TextAcceptanceTracker.instance = undefined
	}

	public setExpectedTextAcceptance(document: vscode.TextDocument, text: string, startPosition: vscode.Position) {
		// Calculate end position
		const lines = text.split("\n")
		let endLine: number
		let endCharacter: number

		if (lines.length > 1) {
			endLine = startPosition.line + lines.length - 1
			endCharacter = lines[lines.length - 1].length
		} else {
			endLine = startPosition.line
			endCharacter = startPosition.character + text.length
		}

		this.expectedAcceptance = {
			documentUri: document.uri.toString(),
			documentVersion: document.version,
			text,
			startLine: startPosition.line,
			startCharacter: startPosition.character,
			endLine,
			endCharacter,
		}
	}

	public checkTextWasAccepted(document: vscode.TextDocument, newPosition: vscode.Position): boolean {
		if (!this.expectedAcceptance) return false

		// Check document match.
		if (this.expectedAcceptance.documentUri !== document.uri.toString()) {
			return false
		}

		// Check document version (must be newer).
		if (document.version <= this.expectedAcceptance.documentVersion) {
			return false
		}

		// Check if cursor is at expected end position.
		const expectedEndPos = new vscode.Position(
			this.expectedAcceptance.endLine,
			this.expectedAcceptance.endCharacter,
		)

		if (newPosition.isEqual(expectedEndPos)) {
			// The cursor is where we'd expect after accepting the ghost text.

			// Verify text was inserted (optional additional check).
			const startPos = new vscode.Position(
				this.expectedAcceptance.startLine,
				this.expectedAcceptance.startCharacter,
			)
			const expectedText = this.expectedAcceptance.text

			try {
				const actualRange = new vscode.Range(startPos, expectedEndPos)

				const actualText = document.getText(actualRange)

				if (actualText === expectedText) {
					// Clear the expectation.
					this.expectedAcceptance = null
					return true
				}
			} catch {
				// Range might be invalid, just fall through.
			}
		}

		return false
	}

	/**
	 * 记录补全被接受
	 * @param completionId 补全请求的唯一标识
	 */
	public recordAcceptance(completionId: string): void {
		this.lastCompletionAccepted = true
		this.lastCompletionTimestamp = Date.now()
		this.lastCompletionId = completionId
	}

	/**
	 * 记录补全被拒绝
	 * @param completionId 补全请求的唯一标识
	 */
	public recordRejection(completionId: string): void {
		this.lastCompletionAccepted = false
		this.lastCompletionTimestamp = Date.now()
		this.lastCompletionId = completionId
	}

	/**
	 * 获取上一次补全是否被接受
	 * @returns 1 表示接受，0 表示拒绝或无记录
	 */
	public getPreviousLabel(): number {
		return this.lastCompletionAccepted ? 1 : 0
	}

	/**
	 * 获取上一次补全处理的时间戳
	 * @returns 时间戳，如果无记录则返回一小时前的时间戳
	 */
	public getPreviousLabelTimestamp(): number {
		return this.lastCompletionTimestamp || Date.now() - 3600000
	}

	/**
	 * 获取上一次补全的 ID
	 */
	public getLastCompletionId(): string {
		return this.lastCompletionId
	}

	/**
	 * 检查是否有待处理的补全预期
	 */
	public hasExpectedAcceptance(): boolean {
		return this.expectedAcceptance !== null
	}

	/**
	 * 清除当前的补全预期（用于拒绝场景）
	 */
	public clearExpectedAcceptance(): void {
		this.expectedAcceptance = null
	}
}
