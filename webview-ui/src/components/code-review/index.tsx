import React from "react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { TaskStatus } from "@roo/codeReview"
import CodeReviewPanel from "./CodeReviewPanel"
import WelcomePage from "./WelcomePage"
import CodebaseSync from "./CodebaseSync"

interface CodeReviewPageProps {
	isHidden?: boolean
	onIssueClick: (issueId: string) => void
	onTaskCancel: () => void
}

const CodeReviewPage: React.FC<CodeReviewPageProps> = ({ isHidden, onIssueClick, onTaskCancel }) => {
	const { reviewTask, reviewPagePayload, setReviewPagePayload, setReviewTask } = useExtensionState()
	const {
		status,
		data: { issues, progress, error = "", message = "", reviewProgress = "" },
	} = reviewTask
	const { targets, isCodebaseReady } = reviewPagePayload
	const onCancel = () => {
		setReviewPagePayload({
			targets,
			isCodebaseReady: true,
		})
		setReviewTask({
			status: TaskStatus.INITIAL,
			data: {
				issues: [],
				progress: null,
				error: "",
				message: "",
			},
		})
	}
	if (!isCodebaseReady) {
		return (
			<div
				className={`fixed top-[28px] left-0 right-0 bottom-0 flex flex-col overflow-hidden ${isHidden ? "hidden" : ""}`}>
				<CodebaseSync onCancel={onCancel} targets={targets} />
			</div>
		)
	}
	if (status === TaskStatus.INITIAL && issues.length === 0) {
		return <WelcomePage />
	}

	return (
		<div
			className={`fixed top-[28px] left-0 right-0 bottom-0 flex flex-col overflow-hidden ${isHidden ? "hidden" : ""}`}>
			<CodeReviewPanel
				issues={issues} // To be sourced from context
				taskStatus={status}
				progress={progress} // To be sourced from context
				reviewProgress={reviewProgress}
				message={message}
				errorMessage={error}
				onIssueClick={onIssueClick}
				onTaskCancel={onTaskCancel}
			/>
		</div>
	)
}

export default CodeReviewPage
