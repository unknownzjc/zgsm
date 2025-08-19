import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { RefreshCw, FileText, AlertCircle, Copy } from "lucide-react"
import { format } from "date-fns"

import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"
import {
	Button,
	Progress,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	Popover,
	PopoverTrigger,
	PopoverContent,
	Badge,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface ZgsmCodebaseSettingsProps {
	apiConfiguration: ExtensionStateContextType["apiConfiguration"]
}

interface IndexStatus {
	fileCount: number | string
	lastUpdated: string
	progress: number
	status: "success" | "failed" | "running" | "pending"
	errorMessage?: string
	failedFiles?: string[]
}

// 后端返回的索引状态信息类型
export interface IndexStatusInfo {
	status: "success" | "failed" | "running" | "pending"
	process: number
	totalFiles: number
	totalSucceed: number
	totalFailed: number
	failedReason: string
	failedFiles: string[]
	processTs: number
	totalChunks?: number
}

// 将后端的 IndexStatusInfo 转换为前端组件使用的 IndexStatus 格式
const mapIndexStatusInfoToIndexStatus = (statusInfo: IndexStatusInfo): IndexStatus => {
	let errorMessage: string | undefined
	let progress = 0

	switch (statusInfo.status) {
		case "running":
			progress = statusInfo.process
			break
		case "pending":
			progress = 0
			break
		case "success":
			progress = 100
			break
		case "failed":
			progress = 100
			errorMessage = statusInfo.failedReason || "索引构建失败"
			break
	}

	const lastUpdated = statusInfo.processTs
		? format(new Date(statusInfo.processTs * 1000), "yyyy-MM-dd HH:mm:ss")
		: "-"

	return {
		fileCount: statusInfo.totalFiles,
		lastUpdated,
		progress,
		status: statusInfo.status,
		errorMessage,
		failedFiles: statusInfo.failedFiles,
	}
}

export const ZgsmCodebaseSettings = ({ apiConfiguration }: ZgsmCodebaseSettingsProps) => {
	const { zgsmCodebaseIndexEnabled } = useExtensionState()
	const [showDisableConfirmDialog, setShowDisableConfirmDialog] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)

	// 轮询相关状态
	const pollingIntervalId = useRef<NodeJS.Timeout | null>(null)
	const isPollingActive = useRef<boolean>(false)

	// 判断是否处于【待启用】状态 - 仅当API提供商不是zgsm时
	const isPendingEnable = useMemo(() => apiConfiguration?.apiProvider !== "zgsm", [apiConfiguration?.apiProvider])

	// 使用 useMemo 避免不必要的状态更新
	const shouldDisableAll = useMemo(
		() => isPendingEnable || !zgsmCodebaseIndexEnabled,
		[isPendingEnable, zgsmCodebaseIndexEnabled],
	)

	const [semanticIndex, setSemanticIndex] = useState<IndexStatus>({
		fileCount: "-",
		lastUpdated: "-",
		progress: 0,
		status: "pending",
	})

	const [codeIndex, setCodeIndex] = useState<IndexStatus>({
		fileCount: "-",
		lastUpdated: "-",
		progress: 0,
		status: "pending",
	})

	// 停止轮询
	const stopPolling = useCallback(() => {
		if (pollingIntervalId.current) {
			clearInterval(pollingIntervalId.current)
			pollingIntervalId.current = null
		}
		isPollingActive.current = false
	}, [])

	// 开始轮询 - 立即获取一次状态，然后每5秒获取一次
	const startPolling = useCallback(() => {
		// 如果已经在轮询中，直接返回
		if (isPollingActive.current) {
			return
		}

		// 先停止之前的轮询
		if (pollingIntervalId.current) {
			clearInterval(pollingIntervalId.current)
			pollingIntervalId.current = null
		}

		// 标记轮询状态为活跃
		isPollingActive.current = true

		// 立即获取一次状态
		vscode.postMessage({
			type: "zgsmPollCodebaseIndexStatus",
		})

		// 每5秒获取一次状态
		pollingIntervalId.current = setInterval(() => {
			vscode.postMessage({
				type: "zgsmPollCodebaseIndexStatus",
			})
		}, 5000)
	}, [])

	// 检查是否应该停止轮询（两个索引都完成了）
	const shouldStopPolling = useCallback((embedding?: IndexStatusInfo, codegraph?: IndexStatusInfo) => {
		return (
			embedding &&
			codegraph &&
			(embedding.status === "success" || embedding.status === "failed") &&
			(codegraph.status === "success" || codegraph.status === "failed")
		)
	}, [])

	// 处理来自扩展的消息
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "codebaseIndexStatusResponse" && message.payload?.status) {
				const { embedding, codegraph } = message.payload.status
				console.log("codebaseIndexStatusResponse", { embedding, codegraph })

				if (embedding) {
					setSemanticIndex(mapIndexStatusInfoToIndexStatus(embedding))
				}
				if (codegraph) {
					setCodeIndex(mapIndexStatusInfoToIndexStatus(codegraph))
				}

				// 如果构建状态为成功/失败，则停止轮询
				if (shouldStopPolling(embedding, codegraph)) {
					stopPolling()
				}
			}
		}

		window.addEventListener("message", handleMessage)

		// 1. 打开页面获取一次构建状态，然后每隔5秒获取一次构建状态
		if (zgsmCodebaseIndexEnabled && !isPendingEnable) {
			startPolling()
		}

		return () => {
			window.removeEventListener("message", handleMessage)
			// 4. 关闭页面时，停止轮询
			stopPolling()
		}
	}, [zgsmCodebaseIndexEnabled, isPendingEnable, startPolling, stopPolling, shouldStopPolling])

	// 防重复调用的 ref
	const lastToggleTime = useRef<number>(0)

	const handleCodebaseIndexToggle = useCallback(
		(e: any) => {
			// 防止重复调用 - 如果距离上次调用少于 200ms，则忽略
			const now = Date.now()
			if (now - lastToggleTime.current < 200) {
				return
			}
			lastToggleTime.current = now

			// 在测试中e.preventDefault可能不存在
			if (e && e.preventDefault) {
				e.preventDefault()
			}
			if (e && e.stopPropagation) {
				e.stopPropagation()
			}

			const checked = !zgsmCodebaseIndexEnabled

			// 如果正在处理中，防止重复触发
			if (isProcessing) {
				return
			}

			// 如果是从开启状态切换到关闭状态，需要确认
			if (!checked) {
				setShowDisableConfirmDialog(true)
				return
			}

			// 发送消息到扩展
			vscode.postMessage({ type: "zgsmCodebaseIndexEnabled", bool: checked })

			// 6. 打开开关时，获取一次构建状态，然后每隔5秒获取一次构建状态
			setTimeout(() => {
				startPolling()
			}, 100)
		},
		[zgsmCodebaseIndexEnabled, isProcessing, startPolling],
	)

	const handleConfirmDisable = useCallback(() => {
		// 防止重复点击
		if (isProcessing) {
			return
		}

		// 设置处理状态锁，防止重复处理
		setIsProcessing(true)

		try {
			// 发送消息到扩展
			vscode.postMessage({ type: "zgsmCodebaseIndexEnabled", bool: false })

			// 立即关闭弹窗
			setShowDisableConfirmDialog(false)

			// 5. 关闭开关时，停止轮询
			stopPolling()

			// 使用 setTimeout 确保扩展状态更新完成后再重置处理状态
			setTimeout(() => {
				setIsProcessing(false)
			}, 150)
		} catch (error) {
			console.error("Failed to disable codebase index:", error)
			setIsProcessing(false)
		}
	}, [isProcessing, stopPolling])

	const handleCancelDisable = useCallback(() => {
		setShowDisableConfirmDialog(false)
	}, [])

	const handleRebuildSemanticIndex = useCallback(() => {
		setSemanticIndex((prev) => ({ ...prev, status: "running", progress: 0 }))

		// 发送重新构建消息到扩展
		vscode.postMessage({
			type: "zgsmRebuildCodebaseIndex",
			values: {
				type: "embedding",
			},
		})

		// 7. 手动点击重新构建，获取一次构建状态，然后每隔5秒获取一次构建状态
		startPolling()
	}, [startPolling])

	const handleRebuildCodeIndex = useCallback(() => {
		setCodeIndex((prev) => ({ ...prev, status: "running", progress: 0 }))

		// 发送重新构建消息到扩展
		vscode.postMessage({
			type: "zgsmRebuildCodebaseIndex",
			values: {
				type: "codegraph",
			},
		})

		// 7. 手动点击重新构建，获取一次构建状态，然后每隔5秒获取一次构建状态
		startPolling()
	}, [startPolling])

	const handleEditIgnoreFile = useCallback(() => {
		vscode.postMessage({
			type: "openFile",
			text: "./.coignore",
			values: { create: true, content: "" },
		})
	}, [])

	const handleOpenFailedFile = useCallback((filePath: string) => {
		vscode.postMessage({
			type: "openFile",
			text: filePath,
			values: {},
		})
	}, [])

	const renderIndexSection = useCallback(
		(
			title: string,
			description: string,
			indexStatus: IndexStatus,
			onRebuild: () => void,
			disabled: boolean = false,
			isPendingEnableSection: boolean = false,
		) => {
			return (
				<div
					className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
					<div className="flex items-center gap-4 font-bold">
						<FileText className="w-4 h-4" />
						<div>{title}</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mb-3">{description}</div>

					{isPendingEnableSection ? (
						<div className="text-vscode-descriptionForeground text-sm italic py-4">启用后显示详细信息</div>
					) : (
						<>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<div className="text-vscode-descriptionForeground text-sm">文件数</div>
									<div className="font-medium">{indexStatus.fileCount}</div>
								</div>
								<div>
									<div className="text-vscode-descriptionForeground text-sm">最新更新时间</div>
									<div className="font-medium">{indexStatus.lastUpdated}</div>
								</div>
							</div>

							<div className="mt-2">
								<div className="flex justify-between text-sm mb-1">
									<span>构建进度</span>
									<span>{indexStatus.progress.toFixed(1)}%</span>
								</div>
								<Progress value={indexStatus.progress} className="h-2" />
							</div>
						</>
					)}

					<div className="flex items-center justify-between mt-3">
						<div className="flex items-center gap-2">
							{isPendingEnableSection ? (
								<div className="flex items-center gap-2">
									<div className="w-3 h-3 bg-gray-400 rounded-full"></div>
									<span>待启用</span>
								</div>
							) : (
								<>
									{indexStatus.status === "running" && (
										<div className="flex items-center gap-2">
											<div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
											<span>同步中...</span>
										</div>
									)}
									{indexStatus.status === "pending" && (
										<div className="flex items-center gap-2">
											<div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse"></div>
											<span>待同步</span>
										</div>
									)}
									{indexStatus.status === "success" && (
										<div className="flex items-center gap-2">
											<div className="w-3 h-3 bg-green-500 rounded-full"></div>
											<span>同步成功</span>
										</div>
									)}
									{indexStatus.status === "failed" && (
										<div className="flex items-center gap-2">
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger>
														<div className="flex items-center gap-2">
															<div className="w-3 h-3 bg-red-500 rounded-full"></div>
															<span>同步失败</span>
															<Badge variant="destructive" className="text-xs">
																{indexStatus.failedFiles?.length || 0}
															</Badge>
														</div>
													</TooltipTrigger>
													<TooltipContent>
														<p>{indexStatus.errorMessage || "同步失败文件"}</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>

											<Popover>
												<PopoverTrigger asChild>
													<Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
														<AlertCircle className="w-3 h-3 mr-1" />
														查看详情
													</Button>
												</PopoverTrigger>
												<PopoverContent className="w-80 max-h-60 overflow-y-auto">
													<div className="space-y-3">
														<div className="flex items-center gap-2">
															<AlertCircle className="w-4 h-4 text-red-500" />
															<h4 className="font-medium">同步失败文件</h4>
														</div>

														{indexStatus.errorMessage && (
															<p className="text-sm text-vscode-errorForeground">
																{indexStatus.errorMessage}
															</p>
														)}

														{indexStatus.failedFiles &&
														indexStatus.failedFiles.length > 0 ? (
															<div className="space-y-2">
																<div className="flex justify-between items-center">
																	<p className="text-sm font-medium">失败文件列表:</p>
																	<Button
																		variant="ghost"
																		size="sm"
																		className="h-6 px-2 text-xs"
																		onClick={async () => {
																			try {
																				const fileText =
																					indexStatus.failedFiles?.join(
																						"\n",
																					) || ""
																				await navigator.clipboard.writeText(
																					fileText,
																				)
																			} catch (error) {
																				console.error(
																					"Failed to copy to clipboard:",
																					error,
																				)
																			}
																		}}
																		disabled={disabled}>
																		<Copy className="w-3 h-3 mr-1" />
																		复制
																	</Button>
																</div>
																<div className="max-h-40 overflow-y-auto border border-vscode-input-border rounded p-2 bg-vscode-textBlockQuote-background">
																	<ul className="text-xs space-y-1">
																		{indexStatus.failedFiles.map((file, index) => (
																			<li
																				key={`${file}-${index}`}
																				className={`text-vscode-errorForeground font-mono p-1 rounded transition-colors duration-150 ${disabled ? "" : "hover:bg-vscode-list-hoverBackground cursor-pointer hover:text-vscode-foreground hover:underline"}`}
																				onClick={() =>
																					!disabled &&
																					handleOpenFailedFile(file)
																				}>
																				{file}
																			</li>
																		))}
																	</ul>
																</div>
															</div>
														) : (
															<p className="text-sm text-vscode-descriptionForeground">
																暂无失败文件信息
															</p>
														)}
													</div>
												</PopoverContent>
											</Popover>
										</div>
									)}
								</>
							)}
						</div>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div>
										<Button
											onClick={onRebuild}
											variant="outline"
											size="sm"
											className="flex items-center gap-1"
											disabled={indexStatus.status === "running" || isPendingEnableSection}>
											<RefreshCw
												className={`w-3 h-3 ${indexStatus.status === "running" && !isPendingEnableSection ? "animate-spin" : ""}`}
											/>
											重新构建
										</Button>
									</div>
								</TooltipTrigger>
								{isPendingEnableSection && (
									<TooltipContent>
										<p>
											{isPendingEnable
												? "仅 Costrict 提供商支持此服务"
												: "Codebase 索引构建已禁用"}
										</p>
									</TooltipContent>
								)}
							</Tooltip>
						</TooltipProvider>
					</div>
				</div>
			)
		},
		[handleOpenFailedFile, isPendingEnable],
	)

	return (
		<div>
			<AlertDialog
				open={showDisableConfirmDialog}
				onOpenChange={(open) => {
					setShowDisableConfirmDialog(open)
				}}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>确定要禁用 Codebase 索引构建功能吗？</AlertDialogTitle>
						<AlertDialogDescription>
							禁用后将导致以下影响：
							<ul className="list-disc list-inside mt-2 space-y-1">
								<li>代码补全效果降低</li>
								<li>代码生成效果降低</li>
								<li>代码审查功能无法正常使用</li>
								<li>模型无法对整个项目进行有效分析</li>
							</ul>
							<br />
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleCancelDisable}>取消</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmDisable}>确认</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<SectionHeader>
				<div className="flex items-center gap-2">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={zgsmCodebaseIndexEnabled}
										onChange={handleCodebaseIndexToggle}
										disabled={isPendingEnable}
									/>
									<div>Codebase索引构建</div>
								</div>
							</TooltipTrigger>
							{isPendingEnable && (
								<TooltipContent>
									<p>仅 Costrict 提供商支持此服务</p>
								</TooltipContent>
							)}
						</Tooltip>
					</TooltipProvider>
				</div>
			</SectionHeader>

			<Section>
				<div className={`space-y-6 ${!zgsmCodebaseIndexEnabled ? "opacity-50" : ""}`}>
					{renderIndexSection(
						"语义索引构建",
						"为提高代码补全等功能效果，系统会自动将相关语义索引同步构建上传，方便模型对上下文进行分析理解。",
						semanticIndex,
						handleRebuildSemanticIndex,
						!zgsmCodebaseIndexEnabled,
						shouldDisableAll,
					)}

					{renderIndexSection(
						"代码索引构建",
						"为保证代码审查功能的正常使用，系统会自动将相关代码索引同步构建上传，方便模型对上下文进行分析理解。",
						codeIndex,
						handleRebuildCodeIndex,
						!zgsmCodebaseIndexEnabled,
						shouldDisableAll,
					)}

					<div className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background`}>
						<div className="flex items-center gap-4 font-bold">
							<FileText className="w-4 h-4" />
							<div>Ignore文件设置</div>
						</div>
						<div className="text-vscode-descriptionForeground text-sm mb-3">
							无需同步上传的索引文件可添加到.coignore文件中
						</div>
						<Button onClick={handleEditIgnoreFile} variant="outline" size="sm" className="w-fit">
							编辑
						</Button>
					</div>
				</div>
			</Section>
		</div>
	)
}
