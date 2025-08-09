/**
 * 平台和架构检测器
 * 用于检测当前运行环境的平台和架构信息
 */
export class PlatformDetector {
	/**
	 * 获取当前平台信息
	 * @returns 返回平台名称：'windows'、'darwin' 或 'linux'
	 */
	get platform(): string {
		switch (process.platform) {
			case "win32":
				return "windows"
			case "darwin":
				return "darwin"
			default:
				return "linux"
		}
	}

	/**
	 * 获取当前架构信息
	 * @returns 返回架构名称：'amd64' 或 'arm64'
	 */
	get arch(): string {
		switch (process.arch) {
			case "ia32":
			case "x64":
				return "amd64"
			default:
				return "arm64"
		}
	}
}
