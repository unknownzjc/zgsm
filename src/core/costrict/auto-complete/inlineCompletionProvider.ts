import {
	InlineCompletionItemProvider,
	InlineCompletionItem,
	TextDocument,
	Position,
	Range,
	InlineCompletionContext,
	CancellationToken,
	ExtensionContext,
	Disposable,
	workspace,
} from "vscode"
import { v7 as uuidv7 } from "uuid"
import { CompletionProvider, AutoCompleteInput } from "./core/completionProvider"
import { ClineProvider } from "../../webview/ClineProvider"
import { extractPrefixSuffix, getDependencyImports } from "./utils"
import { getWorkspacePath, toRelativePath } from "../../../utils/path"
import { CalculateHideScore } from "./types"
import { LangSetting, LangSwitch } from "../base/common/lang-util"
import { TextAcceptanceTracker } from "./textAcceptanceTracker"
export class InlineCompletionProvider implements InlineCompletionItemProvider {
	private completionProvider: CompletionProvider
	private disposables: Disposable[] = []
	private currentCompletionId: string = ""

	constructor(
		private readonly context: ExtensionContext,
		private readonly provider: ClineProvider,
	) {
		this.completionProvider = new CompletionProvider(provider)
		this._setupTextDocumentChangeListener()
	}
	public async provideInlineCompletionItems(
		document: TextDocument,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken,
	): Promise<InlineCompletionItem[]> {
		const tracker = TextAcceptanceTracker.getInstance()

		// 如果有待处理的补全预期且没有被接受，标记为拒绝
		if (tracker.hasExpectedAcceptance() && this.currentCompletionId) {
			tracker.recordRejection(this.currentCompletionId)
			tracker.clearExpectedAcceptance()
		}

		let triggerMode = "auto"
		if (this.context.workspaceState.get("shortCutKeys") === true) {
			triggerMode = "manual"
			this.context.workspaceState.update("shortCutKeys", false)
		}
		if (!this.isCompletionAllowed(triggerMode, document.languageId)) {
			return []
		}

		const input = await this._prepareInput(document, position, context, token)
		const result = await this.completionProvider.provideInlineCompletionItems(input)
		this.provider.log(`[Completions]: ${JSON.stringify(result)}`)
		if (!result || !result.completion) {
			return []
		}

		// 保存当前补全 ID 用于后续跟踪
		this.currentCompletionId = result.completionId

		// 设置预期的文本接受
		tracker.setExpectedTextAcceptance(document, result.completion, position)

		// 返回 InlineCompletionItem
		return [new InlineCompletionItem(result.completion, new Range(position, position))]
	}
	private async _prepareInput(
		document: TextDocument,
		position: Position,
		_context: InlineCompletionContext,
		_token: CancellationToken,
	): Promise<AutoCompleteInput> {
		const completionId = uuidv7()
		const { prefix, suffix } = extractPrefixSuffix(document, position)
		const projectPath = getWorkspacePath()
		const calculateHideScore = await this._calculateHideScore(document, position)
		const relativePath = toRelativePath(document.uri.fsPath, projectPath)
		const importContent = getDependencyImports(relativePath, document.getText())
		return {
			completionId,
			languageId: document.languageId,
			promptOptions: {
				prefix,
				suffix,
				project_path: projectPath,
				file_project_path: relativePath,
				import_content: importContent.join("\n"),
			},
			calculateHideScore,
		}
	}
	private async _calculateHideScore(document: TextDocument, position: Position): Promise<CalculateHideScore> {
		const tracker = TextAcceptanceTracker.getInstance()
		return {
			is_whitespace_after_cursor: this._isWhitespaceAfterCursor(document, position),
			document_length: document.getText().length,
			prompt_end_pos: document.offsetAt(position),
			previous_label: tracker.getPreviousLabel(),
			previous_label_timestamp: tracker.getPreviousLabelTimestamp(),
		}
	}

	/**
	 * 检查光标后是否全为空白字符
	 */
	private _isWhitespaceAfterCursor(document: TextDocument, position: Position): boolean {
		const lineText = document.lineAt(position.line).text
		const textAfterCursor = lineText.substring(position.character)
		return textAfterCursor.trim() === ""
	}
	/**
	 * 判断是否允许代码补全
	 * @param triggerMode 触发模式: "auto" | "manual"
	 * @param language 编程语言标识
	 * @returns 是否允许补全
	 */
	private isCompletionAllowed(triggerMode: string, language: string): boolean {
		// 全局禁用时直接返回
		if (!LangSetting.completionEnabled) {
			return false
		}

		const langSwitch = LangSetting.getCompletionDisable(language)

		// 不支持的语言直接禁用
		if (langSwitch === LangSwitch.Unsupported) {
			return false
		}

		// 自动模式下需检查语言开关，手动模式强制允许
		return triggerMode !== "auto" || langSwitch !== LangSwitch.Disabled
	}

	/**
	 * 设置文档变化监听器，用于检测补全是否被接受
	 */
	private _setupTextDocumentChangeListener(): void {
		const disposable = workspace.onDidChangeTextDocument((event) => {
			const tracker = TextAcceptanceTracker.getInstance()

			// 如果没有待处理的补全预期，直接返回
			if (!tracker.hasExpectedAcceptance() || !this.currentCompletionId) {
				return
			}

			const document = event.document
			const changes = event.contentChanges
			const lastChange = changes?.[changes.length - 1]

			if (!lastChange) {
				return
			}

			// 计算插入后的光标位置
			const insertedText = lastChange.text
			const lines = insertedText.split("\n")
			let newPosition: Position

			if (lines.length > 1) {
				// 多行文本：结束位置在最后一行
				newPosition = new Position(
					lastChange.range.start.line + lines.length - 1,
					lines[lines.length - 1].length,
				)
			} else {
				// 单行文本：结束位置在起始位置 + 文本长度
				newPosition = new Position(
					lastChange.range.start.line,
					lastChange.range.start.character + insertedText.length,
				)
			}

			// 使用 tracker 的 checkTextWasAccepted 进行检查
			if (tracker.checkTextWasAccepted(document, newPosition)) {
				// checkTextWasAccepted 内部已清除 expectedAcceptance
				tracker.recordAcceptance(this.currentCompletionId)
				this.currentCompletionId = ""
			}
		})

		this.disposables.push(disposable)
	}

	public dispose(): void {
		Disposable.from(...this.disposables).dispose()
	}
}
