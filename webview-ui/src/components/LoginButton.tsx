import React, { useEffect, useState } from "react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

export const LoginButton: React.FC = () => {
	const { apiConfiguration } = useExtensionState()
	const [isLoggedIn, setIsLoggedIn] = useState(false)
	const [isLoading, setIsLoading] = useState(false)

	useEffect(() => {
		setIsLoggedIn(!!(apiConfiguration?.zgsmRefreshToken && apiConfiguration?.zgsmAccessToken))
	}, [apiConfiguration])

	const handleAuthClick = () => {
		setIsLoading(true)
		vscode.postMessage({
			type: isLoggedIn ? "zgsmLogout" : "zgsmLogin",
			values: {
				apiConfiguration,
			},
		})

		setTimeout(() => {
			setIsLoading(false)
		}, 5000)
	}

	return (
		<button
			onClick={handleAuthClick}
			disabled={isLoading}
			className={`px-4 py-2 rounded-md transition-all
        ${isLoggedIn ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"}
        ${isLoading && "opacity-50 cursor-wait"}
      `}>
			{isLoading ? "处理中..." : isLoggedIn ? "测试登出" : "测试登录"}
		</button>
	)
}
