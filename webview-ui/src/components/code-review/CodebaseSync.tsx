import React, { useState, useEffect, useRef } from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ExclamationTriangleIcon } from "@radix-ui/react-icons"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Button } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { IndexStatusInfo } from "@/components/settings/ZgsmCodebaseSettings"
import { ReviewTarget } from "@roo/codeReview"

interface CodebaseSyncProps {
	onCancel: () => void
	targets: ReviewTarget[]
}

const CodebaseSync: React.FC<CodebaseSyncProps> = ({ onCancel, targets }) => {
	const { t } = useAppTranslation()
	const { zgsmCodebaseIndexEnabled } = useExtensionState()
	const [indexStatus, setIndexStatus] = useState<IndexStatusInfo>({
		process: 100,
		status: "success",
		totalFiles: 100,
		totalSucceed: 100,
		totalFailed: 0,
		failedReason: "",
		failedFiles: [],
		processTs: 100,
	})
	// 轮询相关状态
	const pollingIntervalId = useRef<NodeJS.Timeout | null>(null)
	const [isPolling, setIsPolling] = useState(false)

	const fetchCodebaseIndexStatus = () => {
		vscode.postMessage({
			type: "zgsmPollCodebaseIndexStatus",
		})
	}
	// 轮询相关函数
	const startPolling = (delay = 5_000) => {
		console.log("codebase-index startPolling")

		if (isPolling) return

		setIsPolling(true)
		const intervalId = setInterval(() => {
			fetchCodebaseIndexStatus()
		}, delay) // 每5秒轮询一次

		pollingIntervalId.current = intervalId
	}
	const stopPolling = () => {
		if (pollingIntervalId.current) {
			clearInterval(pollingIntervalId.current)
			pollingIntervalId.current = null
		}
		setIsPolling(false)
	}
	const onContinue = () => {
		vscode.postMessage({
			type: "zgsmCodebaseIndexEnabled",
			bool: true,
		})
		// 发送重新构建消息到扩展
		vscode.postMessage({
			type: "zgsmRebuildCodebaseIndex",
			values: {
				type: "codegraph",
			},
		})
		startPolling()
	}
	const navigateToSettings = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault()
		vscode.postMessage({
			type: "settingsButtonclicked",
			values: {
				section: "contextManagement",
			},
		})
	}

	// 处理来自扩展的消息
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "codebaseIndexStatusResponse" && message?.payload && message.payload?.status) {
				const { codegraph } = message.payload.status
				setIndexStatus(codegraph)

				// 如果状态为 success 或 error，可以考虑停止轮询
				if (codegraph.status === "success" || codegraph.status === "failed") {
					// 所有索引都已完成，可以停止轮询
					stopPolling()
					vscode.postMessage({
						type: "startCodereview",
						values: {
							targets,
						},
					})
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [targets])

	// 组件卸载时清理定时器
	useEffect(() => {
		return () => {
			if (pollingIntervalId.current) {
				clearInterval(pollingIntervalId.current)
				pollingIntervalId.current = null
			}
		}
	}, [])
	return (
		<div className="flex items-center mt-5 px-5">
			{!zgsmCodebaseIndexEnabled ||
				(indexStatus.status === "pending" && (
					<div className="flex flex-col gap-[26px]">
						<div className="flex items-center">
							<ExclamationTriangleIcon color="#FFD500" width={20} height={20} />
							<span className="ml-2">{t("codereview:codebase.syncTips")}</span>
						</div>
						<div className="flex gap-1">
							<Button onClick={onContinue}>{t("codereview:codebase.syncConfirm")}</Button>
							<Button variant="secondary" onClick={onCancel}>
								{t("codereview:codebase.syncCancel")}
							</Button>
						</div>
					</div>
				))}
			{zgsmCodebaseIndexEnabled && indexStatus.status === "running" && (
				<div className="flex items-center mb-4">
					<div
						className="w-4 h-4 rounded-full border-2 border-transparent animate-spin"
						style={{ borderTopColor: "rgba(23, 112, 230, 0.7)" }}
					/>
					<span className="ml-2">{t("codereview:codebase.running", { progress: indexStatus.process })}</span>
				</div>
			)}
			{zgsmCodebaseIndexEnabled && indexStatus.status === "failed" && (
				<div className="flex items-center mb-4">
					<ExclamationTriangleIcon color="#FFD500" width={20} height={20} />
					<span className="ml-2">
						<Trans
							i18nKey="codereview:codebase.failed"
							components={{
								settingsLink: <VSCodeLink href="#" onClick={navigateToSettings}></VSCodeLink>,
							}}
						/>
					</span>
				</div>
			)}
			{zgsmCodebaseIndexEnabled && indexStatus.status === "success" && (
				<div className="flex items-center mb-4">
					<div
						className="w-4 h-4 rounded-full border-2 border-transparent animate-spin"
						style={{ borderTopColor: "rgba(23, 112, 230, 0.7)" }}
					/>
					<span className="ml-2">{t("codereview:codebase.success")}</span>
				</div>
			)}
		</div>
	)
}

export default CodebaseSync
