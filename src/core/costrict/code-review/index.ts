import * as vscode from "vscode"
import path from "node:path"

import { ClineProvider } from "../../webview/ClineProvider"
import { getCommand } from "../../../utils/commands"
import { toRelativePath } from "../../../utils/path"
import { CostrictCommandId } from "@roo-code/types"
import { t } from "../../../i18n"
import { IssueStatus, TaskStatus } from "../../../shared/codeReview"
import { getVisibleProviderOrLog } from "../../../activate/registerCommands"

import { CodeReviewService } from "./codeReviewService"
import { CommentService } from "../../../integrations/comment"
import type { ReviewComment } from "./reviewComment"
import { ReviewTarget, ReviewTargetType } from "./types"
import { CodeBaseError, type TelemetryErrorType } from "../telemetry"
import { zgsmCodebaseIndexManager } from "../codebase-index"
const startReview = async (
	reviewInstance: CodeReviewService,
	targets: ReviewTarget[],
	isReviewRepo: boolean = false,
) => {
	const visibleProvider = await ClineProvider.getInstance()
	const codebaseSyncService = zgsmCodebaseIndexManager
	if (visibleProvider) {
		const filePaths = targets.map((target) => path.join(visibleProvider.cwd, target.file_path))

		reviewInstance.setProvider(visibleProvider)
		if (!isReviewRepo) {
			try {
				const success = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: t("common:review.tip.file_check"),
					},
					async (progress) => {
						const { success } = await codebaseSyncService.checkIgnoreFiles({ paths: filePaths })
						progress.report({ increment: 100 })
						return success
					},
				)
				if (!success) {
					vscode.window.showInformationMessage(t("common:review.tip.codebase_sync_ignore_file"))
					return
				}
			} catch (error) {
				vscode.window.showInformationMessage(t("common:review.tip.service_unavailable"))
				return
			}
		}
		visibleProvider.postMessageToWebview({
			type: "action",
			action: "codeReviewButtonClicked",
		})

		reviewInstance.sendReviewTaskUpdateMessage(TaskStatus.RUNNING, {
			issues: [],
			progress: null,
			message: t("common:review.tip.codebase_sync"),
		})
		try {
			const { success, code } = await codebaseSyncService.syncCodebase(isReviewRepo ? [] : filePaths) // todo
			if (success) {
				await reviewInstance.startReviewTask(targets)
			} else {
				if (code === "401") {
					await reviewInstance.handleAuthError()
					codebaseSyncService.recordError(CodeBaseError.AuthError as TelemetryErrorType)
					return
				}
				reviewInstance.pushErrorToWebview(new Error(t("common:review.tip.codebase_sync_failed")))
				codebaseSyncService.recordError(CodeBaseError.SyncFailed as TelemetryErrorType)
			}
		} catch (error) {
			reviewInstance.pushErrorToWebview(new Error(t("common:review.tip.service_unavailable")))
		}
	}
}
export function initCodeReview(
	context: vscode.ExtensionContext,
	provider: ClineProvider,
	outputChannel: vscode.OutputChannel,
) {
	const reviewInstance = CodeReviewService.getInstance()
	const commentService = CommentService.getInstance()
	reviewInstance.setProvider(provider)
	reviewInstance.setCommentService(commentService)
	const commandMap: Partial<Record<CostrictCommandId, any>> = {
		codeReviewButtonClicked: async () => {
			let visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				visibleProvider = await ClineProvider.getInstance()
			}

			visibleProvider?.postMessageToWebview({ type: "action", action: "codeReviewButtonClicked" })
		},
		codeReview: async () => {
			const visibleProvider = await ClineProvider.getInstance()
			const editor = vscode.window.activeTextEditor
			if (!visibleProvider || !editor) {
				return
			}
			const fileUri = editor.document.uri
			const range = editor.selection
			const cwd = visibleProvider.cwd.toPosix()
			reviewInstance.startReviewTask([
				{
					type: ReviewTargetType.CODE,
					file_path: toRelativePath(fileUri.fsPath.toPosix(), cwd),
					line_range: [range.start.line, range.end.line],
				},
			])
		},
		reviewFilesAndFolders: async (_: vscode.Uri, selectedUris: vscode.Uri[]) => {
			const visibleProvider = await ClineProvider.getInstance()
			if (!visibleProvider) {
				return
			}
			const cwd = visibleProvider.cwd.toPosix()
			const targets: ReviewTarget[] = await Promise.all(
				selectedUris.map(async (uri) => {
					const stat = await vscode.workspace.fs.stat(uri)
					return {
						type: stat.type === vscode.FileType.Directory ? ReviewTargetType.FOLDER : ReviewTargetType.FILE,
						file_path: toRelativePath(uri.fsPath.toPosix(), cwd),
					}
				}),
			)
			startReview(reviewInstance, targets)
		},
		reviewRepo: async () => {
			const visibleProvider = await ClineProvider.getInstance()
			if (!visibleProvider) {
				return
			}
			startReview(
				reviewInstance,
				[
					{
						type: ReviewTargetType.FOLDER,
						file_path: "",
					},
				],
				true,
			)
		},
		acceptIssue: async (thread: vscode.CommentThread) => {
			const visibleProvider = await ClineProvider.getInstance()
			if (!visibleProvider) {
				return
			}
			reviewInstance.setProvider(visibleProvider)
			const comments = thread.comments as ReviewComment[]
			comments.forEach(async (comment) => {
				reviewInstance.updateIssueStatus(comment.id, IssueStatus.ACCEPT)
			})
		},
		rejectIssue: async (thread: vscode.CommentThread) => {
			const visibleProvider = await ClineProvider.getInstance()
			if (!visibleProvider) {
				return
			}
			reviewInstance.setProvider(visibleProvider)
			const comments = thread.comments as ReviewComment[]
			comments.forEach(async (comment) => {
				reviewInstance.updateIssueStatus(comment.id, IssueStatus.REJECT)
			})
		},
	}
	for (const [id, callback] of Object.entries(commandMap)) {
		const command = getCommand(id as CostrictCommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}
}

export { CodeReviewService, startReview, ReviewTargetType }
