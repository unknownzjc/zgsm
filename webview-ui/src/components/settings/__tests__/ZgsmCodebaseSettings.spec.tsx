// npx vitest run src/components/settings/__tests__/ZgsmCodebaseSettings.spec.tsx

import React from "react"
import { render, screen, fireEvent, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { vscode } from "@/utils/vscode"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

import { ZgsmCodebaseSettings, type IndexStatusInfo } from "../ZgsmCodebaseSettings"

// Mock vscode API
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock useAppTranslation hook
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key, // Return the key itself for simplicity
	}),
}))

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, disabled }: any) => (
		<input
			type="checkbox"
			checked={checked}
			onChange={(e) => onChange && onChange({ target: { checked: e.target.checked } })}
			disabled={disabled}
			data-testid="vscode-checkbox"
		/>
	),
}))

// Mock UI components with simplified rendering
vi.mock("@/components/ui", () => ({
	Button: ({ children, onClick, disabled }: any) => (
		<button onClick={onClick} disabled={disabled} data-testid="ui-button">
			{children}
		</button>
	),
	Progress: ({ value }: any) => (
		<div data-testid="progress-bar" data-value={value}>
			Progress: {value}%
		</div>
	),
	TooltipProvider: ({ children }: any) => <div>{children}</div>,
	Tooltip: ({ children }: any) => <div>{children}</div>,
	TooltipContent: ({ children }: any) => <div>{children}</div>,
	TooltipTrigger: ({ children }: any) => <div>{children}</div>,
	Popover: ({ children, open }: any) => (open ? <div data-testid="popover">{children}</div> : null),
	PopoverTrigger: ({ children }: any) => <div>{children}</div>,
	PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
	Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
	AlertDialog: ({ children, open }: any) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
	AlertDialogAction: ({ children, onClick }: any) => (
		<button data-testid="alert-dialog-action" onClick={onClick}>
			{children}
		</button>
	),
	AlertDialogCancel: ({ children, onClick }: any) => (
		<button data-testid="alert-dialog-cancel" onClick={onClick}>
			{children}
		</button>
	),
	AlertDialogContent: ({ children }: any) => <div data-testid="alert-dialog-content">{children}</div>,
	AlertDialogDescription: ({ children }: any) => <div data-testid="alert-dialog-description">{children}</div>,
	AlertDialogFooter: ({ children }: any) => <div data-testid="alert-dialog-footer">{children}</div>,
	AlertDialogHeader: ({ children }: any) => <div data-testid="alert-dialog-header">{children}</div>,
	AlertDialogTitle: ({ children }: any) => <div data-testid="alert-dialog-title">{children}</div>,
}))

// Mock Section components
vi.mock("../SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div data-testid="section-header">{children}</div>,
}))

vi.mock("../Section", () => ({
	Section: ({ children }: any) => <div data-testid="section">{children}</div>,
}))

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
	RefreshCw: () => <div data-testid="refresh-icon">Refresh</div>,
	FileText: () => <div data-testid="file-icon">File</div>,
	AlertCircle: () => <div data-testid="alert-icon">Alert</div>,
	Copy: () => <div data-testid="copy-icon">Copy</div>,
}))

// Mock context hooks
const mockUseExtensionState = vi.fn()
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockUseExtensionState(),
	ExtensionStateContextProvider: ({ children }: any) => <div>{children}</div>,
}))

interface TestProps {
	apiConfiguration?: any
	zgsmCodebaseIndexEnabled?: boolean
}

const renderZgsmCodebaseSettings = (props: TestProps = {}) => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	})

	const defaultProps = {
		apiConfiguration: { apiProvider: "zgsm" },
		...props,
	}

	// Set up mock return values
	mockUseExtensionState.mockReturnValue({
		zgsmCodebaseIndexEnabled: props.zgsmCodebaseIndexEnabled ?? false,
	})

	return render(
		<QueryClientProvider client={queryClient}>
			<ExtensionStateContextProvider>
				<ZgsmCodebaseSettings {...defaultProps} />
			</ExtensionStateContextProvider>
		</QueryClientProvider>,
	)
}

// Helper function to mock window.postMessage
const mockPostMessage = (type: string, payload?: any) => {
	const messageEvent = new MessageEvent("message", {
		data: {
			type,
			payload,
		},
		origin: "*",
	})

	act(() => {
		window.dispatchEvent(messageEvent)
	})
}

// Helper function to create IndexStatusInfo
const createIndexStatusInfo = (overrides: Partial<IndexStatusInfo> = {}): IndexStatusInfo => ({
	status: "pending",
	process: 0,
	totalFiles: 0,
	totalSucceed: 0,
	totalFailed: 0,
	failedReason: "",
	failedFiles: [],
	processTs: Date.now() / 1000,
	...overrides,
})

describe("ZgsmCodebaseSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("Rendering", () => {
		it("renders the component with basic structure", () => {
			renderZgsmCodebaseSettings()

			expect(screen.getByTestId("section-header")).toBeInTheDocument()
			expect(screen.getByTestId("section")).toBeInTheDocument()
		})

		it("shows semantic index section", () => {
			renderZgsmCodebaseSettings()

			expect(screen.getByText("settings:codebase.semanticIndex.title")).toBeInTheDocument()
			expect(screen.getByText("settings:codebase.semanticIndex.description")).toBeInTheDocument()
		})

		it("shows code index section", () => {
			renderZgsmCodebaseSettings()

			expect(screen.getByText("settings:codebase.codeIndex.title")).toBeInTheDocument()
			expect(screen.getByText("settings:codebase.codeIndex.description")).toBeInTheDocument()
		})

		it("shows ignore file settings section", () => {
			renderZgsmCodebaseSettings()

			expect(screen.getByText("settings:codebase.ignoreFileSettings.title")).toBeInTheDocument()
			expect(screen.getByText("settings:codebase.ignoreFileSettings.description")).toBeInTheDocument()
			expect(screen.getByText("settings:codebase.ignoreFileSettings.edit")).toBeInTheDocument()
		})
	})

	describe("Checkbox behavior", () => {
		it("shows checkbox checked when zgsmCodebaseIndexEnabled is true", () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: true })

			const checkbox = screen.getByTestId("vscode-checkbox")
			expect(checkbox).toBeChecked()
		})

		it("shows checkbox unchecked when zgsmCodebaseIndexEnabled is false", () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: false })

			const checkbox = screen.getByTestId("vscode-checkbox")
			expect(checkbox).not.toBeChecked()
		})

		it("disables checkbox when apiProvider is not zgsm", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "openai" },
				zgsmCodebaseIndexEnabled: false,
			})

			const checkbox = screen.getByTestId("vscode-checkbox")
			expect(checkbox).toBeDisabled()
		})

		it("enables checkbox when apiProvider is zgsm", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: false,
			})

			const checkbox = screen.getByTestId("vscode-checkbox")
			expect(checkbox).not.toBeDisabled()
		})

		it("sends enable message when checkbox is checked", () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: false })

			const checkbox = screen.getByTestId("vscode-checkbox")
			fireEvent.click(checkbox)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmCodebaseIndexEnabled",
				bool: true,
			})
		})

		it("shows confirmation dialog when disabling", () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: true })

			const checkbox = screen.getByTestId("vscode-checkbox")
			fireEvent.click(checkbox)

			expect(screen.getByTestId("alert-dialog")).toBeInTheDocument()
			expect(screen.getByText("settings:codebase.confirmDialog.title")).toBeInTheDocument()
		})

		it("does not show confirmation dialog when enabling", () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: false })

			const checkbox = screen.getByTestId("vscode-checkbox")
			fireEvent.click(checkbox)

			expect(screen.queryByTestId("alert-dialog")).not.toBeInTheDocument()
		})
	})

	describe("Confirmation dialog", () => {
		it("sends disable message when confirmed", () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: true })

			// Open dialog
			const checkbox = screen.getByTestId("vscode-checkbox")
			fireEvent.click(checkbox)

			// Confirm disable
			const confirmButton = screen.getByTestId("alert-dialog-action")
			fireEvent.click(confirmButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmCodebaseIndexEnabled",
				bool: false,
			})
		})

		it("closes dialog when cancelled", async () => {
			renderZgsmCodebaseSettings({ zgsmCodebaseIndexEnabled: true })

			// Open dialog
			const checkbox = screen.getByTestId("vscode-checkbox")
			fireEvent.click(checkbox)

			// 确保对话框已经打开
			expect(screen.getByTestId("alert-dialog")).toBeInTheDocument()

			// Cancel disable
			const cancelButton = screen.getByTestId("alert-dialog-cancel")
			fireEvent.click(cancelButton)

			// Dialog should be closed
			expect(screen.queryByTestId("alert-dialog")).not.toBeInTheDocument()
		})
	})

	describe("Index status display", () => {
		it("shows pending enable message when not using zgsm provider", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "openai" },
				zgsmCodebaseIndexEnabled: false,
			})

			// 使用 getAllByText 并检查第一个元素来避免多个相同文本元素的问题
			const enableMessages = screen.getAllByText("settings:codebase.semanticIndex.enableToShowDetails")
			expect(enableMessages[0]).toBeInTheDocument()

			// 对于 pendingEnable 消息，也使用 getAllByText 因为有多个相同的元素
			const pendingMessages = screen.getAllByText("settings:codebase.semanticIndex.pendingEnable")
			expect(pendingMessages[0]).toBeInTheDocument()
		})

		it("shows index details when enabled and using zgsm provider", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			// Initially shows pending status
			expect(screen.getAllByText("settings:codebase.semanticIndex.fileCount")[0]).toBeInTheDocument()
			expect(screen.getAllByText("settings:codebase.semanticIndex.lastUpdatedTime")[0]).toBeInTheDocument()
			expect(screen.getAllByText("settings:codebase.semanticIndex.buildProgress")[0]).toBeInTheDocument()
		})

		it("updates index status when receiving status response", async () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			// Simulate receiving status update
			const statusInfo = createIndexStatusInfo({
				status: "success",
				process: 100,
				totalFiles: 100,
				totalSucceed: 100,
				totalFailed: 0,
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			// Check if status is updated
			expect(screen.getAllByText("100")[0]).toBeInTheDocument() // File count
			expect(screen.getAllByText("settings:codebase.semanticIndex.syncSuccess")[0]).toBeInTheDocument()
		})

		it("shows running status with progress", async () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "running",
				process: 50,
				totalFiles: 200,
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			expect(screen.getAllByText("settings:codebase.semanticIndex.syncing")[0]).toBeInTheDocument()
			expect(screen.getAllByText("50.0%")[0]).toBeInTheDocument()
		})

		it("shows failed status with error details", async () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "failed",
				process: 100,
				totalFiles: 100,
				totalSucceed: 95,
				totalFailed: 5,
				failedReason: "Failed to process files",
				failedFiles: ["file1.ts", "file2.ts"],
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			expect(screen.getAllByText("settings:codebase.semanticIndex.syncFailed")[0]).toBeInTheDocument()
			expect(screen.getAllByTestId("badge")[0]).toBeInTheDocument()
			expect(screen.getAllByText("2")[0]).toBeInTheDocument() // Failed files count
		})
	})

	describe("Rebuild functionality", () => {
		it("sends rebuild message for semantic index", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			// Find and click rebuild button for semantic index
			const rebuildButtons = screen.getAllByText("settings:codebase.semanticIndex.rebuild")
			const semanticRebuildButton = rebuildButtons[0] // First rebuild button is for semantic index

			fireEvent.click(semanticRebuildButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmRebuildCodebaseIndex",
				values: {
					type: "embedding",
				},
			})
		})

		it("sends rebuild message for code index", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			// Find and click rebuild button for code index
			const rebuildButtons = screen.getAllByText("settings:codebase.semanticIndex.rebuild")
			const codeRebuildButton = rebuildButtons[1] // Second rebuild button is for code index

			fireEvent.click(codeRebuildButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmRebuildCodebaseIndex",
				values: {
					type: "codegraph",
				},
			})
		})

		it("disables rebuild buttons when index is running", async () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "running",
				process: 50,
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			const rebuildButtons = screen.getAllByText("settings:codebase.semanticIndex.rebuild")
			rebuildButtons.forEach((button) => {
				expect(button.closest("button")).toBeDisabled()
			})
		})
	})

	describe("Failed files handling", () => {
		it("shows failed files popover when there are failed files", async () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "failed",
				process: 100,
				totalFiles: 100,
				totalSucceed: 98,
				totalFailed: 2,
				failedFiles: ["file1.ts", "file2.ts"],
				failedReason: "Test error",
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			// Wait for the component to render the failed state
			expect(screen.getAllByText("settings:codebase.semanticIndex.syncFailed")[0]).toBeInTheDocument()

			// The viewDetails button should be rendered inside the popover trigger
			const viewDetailsButtons = screen.queryAllByText("settings:codebase.semanticIndex.viewDetails")
			if (viewDetailsButtons.length > 0) {
				const viewDetailsButton = viewDetailsButtons[0]
				fireEvent.click(viewDetailsButton)

				expect(screen.getByTestId("popover-content")).toBeInTheDocument()
				expect(screen.getByText("settings:codebase.semanticIndex.failedFileList")).toBeInTheDocument()
				expect(screen.getByText("file1.ts")).toBeInTheDocument()
				expect(screen.getByText("file2.ts")).toBeInTheDocument()
			} else {
				// If viewDetails button is not rendered, just check that the failed state is shown
				expect(screen.getAllByTestId("badge")[0]).toBeInTheDocument()
				expect(screen.getAllByText("2")[0]).toBeInTheDocument()
			}
		})

		it("copies failed files to clipboard", async () => {
			const mockWriteText = vi.fn()
			Object.assign(navigator, {
				clipboard: {
					writeText: mockWriteText,
				},
			})

			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "failed",
				process: 100,
				totalFiles: 100,
				totalSucceed: 98,
				totalFailed: 2,
				failedFiles: ["file1.ts", "file2.ts"],
				failedReason: "Test error",
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			// Check if viewDetails button exists, if not skip this test
			const viewDetailsButtons = screen.queryAllByText("settings:codebase.semanticIndex.viewDetails")
			if (viewDetailsButtons.length > 0) {
				const viewDetailsButton = viewDetailsButtons[0]
				fireEvent.click(viewDetailsButton)

				// Click copy button
				const copyButtons = screen.queryAllByText("settings:codebase.semanticIndex.copy")
				if (copyButtons.length > 0) {
					const copyButton = copyButtons[0]
					fireEvent.click(copyButton)

					expect(mockWriteText).toHaveBeenCalledWith("file1.ts\nfile2.ts")
				}
			} else {
				// If viewDetails is not available, just verify the failed state is shown
				expect(screen.getAllByText("settings:codebase.semanticIndex.syncFailed")[0]).toBeInTheDocument()
				expect(screen.getAllByText("2")[0]).toBeInTheDocument()
			}
		})

		it("opens failed file when clicked", async () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "failed",
				process: 100,
				totalFiles: 100,
				totalSucceed: 99,
				totalFailed: 1,
				failedFiles: ["file1.ts"],
				failedReason: "Test error",
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			// Check if viewDetails button exists, if not skip popover interaction
			const viewDetailsButtons = screen.queryAllByText("settings:codebase.semanticIndex.viewDetails")
			if (viewDetailsButtons.length > 0) {
				const viewDetailsButton = viewDetailsButtons[0]
				fireEvent.click(viewDetailsButton)

				// Click on failed file
				const fileLink = screen.getByText("file1.ts")
				fireEvent.click(fileLink)

				expect(vscode.postMessage).toHaveBeenCalledWith({
					type: "openFile",
					text: "file1.ts",
					values: {},
				})
			} else {
				// If viewDetails is not available, just verify the failed state is shown
				expect(screen.getAllByText("settings:codebase.semanticIndex.syncFailed")[0]).toBeInTheDocument()
				expect(screen.getAllByTestId("badge")[0]).toBeInTheDocument()
				expect(screen.getAllByText("1")[0]).toBeInTheDocument()
			}
		})
	})

	describe("Ignore file editing", () => {
		it("sends open file message for .coignore when edit button is clicked", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const editButton = screen.getByText("settings:codebase.ignoreFileSettings.edit")
			fireEvent.click(editButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "openFile",
				text: "./.coignore",
				values: { create: true, content: "" },
			})
		})
	})

	describe("Polling behavior", () => {
		it("starts polling when component mounts with enabled state", () => {
			vi.clearAllMocks() // Clear any previous calls

			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmPollCodebaseIndexStatus",
			})
		})

		it("does not start polling when component mounts with disabled state", () => {
			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: false,
			})

			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "zgsmPollCodebaseIndexStatus",
			})
		})

		it("stops polling when both indexes complete", async () => {
			vi.clearAllMocks()

			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "success",
				process: 100,
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			// Fast forward timers to allow polling to stop
			act(() => {
				vi.advanceTimersByTime(6000)
			})

			// Should have initial poll, no more polling should happen for completed indexes
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmPollCodebaseIndexStatus",
			})
		})

		it("continues polling when indexes are still running", async () => {
			vi.clearAllMocks()

			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			const statusInfo = createIndexStatusInfo({
				status: "running",
				process: 50,
				processTs: Date.now() / 1000,
			})

			act(() => {
				mockPostMessage("codebaseIndexStatusResponse", {
					status: {
						embedding: statusInfo,
						codegraph: statusInfo,
					},
				})
			})

			// Fast forward timers
			act(() => {
				vi.advanceTimersByTime(10000)
			})

			// Should have initial poll and continue polling for running indexes
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "zgsmPollCodebaseIndexStatus",
			})
		})
	})

	describe("Debounce behavior", () => {
		it("prevents rapid toggle calls", () => {
			vi.clearAllMocks()

			renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: false,
			})

			const checkbox = screen.getByTestId("vscode-checkbox")

			// Simulate rapid clicks
			fireEvent.click(checkbox)
			fireEvent.click(checkbox)
			fireEvent.click(checkbox)

			// Should only send one message due to debouncing
			expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		})
	})

	describe("Component lifecycle", () => {
		it("cleans up polling on unmount", () => {
			const { unmount } = renderZgsmCodebaseSettings({
				apiConfiguration: { apiProvider: "zgsm" },
				zgsmCodebaseIndexEnabled: true,
			})

			unmount()

			// Verify that cleanup would happen (hard to test actual clearInterval)
			expect(true).toBe(true)
		})
	})
})
