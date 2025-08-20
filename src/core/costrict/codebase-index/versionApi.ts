import { ZgsmAuthApi, ZgsmAuthConfig } from "../auth"
import { PlatformDetector } from "./platform"
import { PlatformResponse, VersionInfo } from "./types"

/**
 * 版本 API 类
 * 用于获取客户端版本列表信息
 */
export class VersionApi {
	private platformDetector: PlatformDetector

	constructor() {
		this.platformDetector = new PlatformDetector()
	}

	/**
	 * 获取版本列表
	 * @returns Promise<PlatformResponse> 返回平台版本信息
	 * @throws 当 API 调用失败时抛出错误
	 */
	async getVersionList(): Promise<PlatformResponse> {
		const { zgsmBaseUrl } = await ZgsmAuthApi.getInstance().getApiConfiguration()
		const baseUrl = zgsmBaseUrl || ZgsmAuthConfig.getInstance().getDefaultApiBaseUrl()
		const platform = this.platformDetector.platform
		const arch = this.platformDetector.arch
		const url = `${baseUrl}/costrict/costrict/${platform}/${arch}/platform.json`

		try {
			const response = await fetch(url)

			if (!response.ok) {
				const errorData = await response.text()
				throw new Error(`获取版本列表失败: ${errorData}`)
			}

			const data: PlatformResponse = await response.json()
			return data
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${url} 获取版本列表时发生错误: ${error.message}`)
			} else {
				throw new Error(`${url} 获取版本列表时发生未知错误`)
			}
		}
	}

	/**
	 * 获取最新版本信息
	 * @returns Promise<VersionInfo> 返回最新版本信息
	 * @throws 当 API 调用失败时抛出错误
	 */
	async getLatestVersion(): Promise<VersionInfo> {
		const platformData = await this.getVersionList()
		return platformData.newest
	}

	/**
	 * 检查是否有可用更新
	 * @param currentVersion 当前版本
	 * @returns Promise<boolean> 如果有可用更新返回 true，否则返回 false
	 * @throws 当 API 调用失败时抛出错误
	 */
	async shouldUpdate(currentVersionInfo: VersionInfo): Promise<boolean> {
		try {
			const latestVersion = await this.getLatestVersion()

			// 简单的版本比较逻辑
			if (latestVersion?.versionId?.major > currentVersionInfo?.versionId?.major) {
				return true
			}
			if (
				latestVersion?.versionId?.major === currentVersionInfo?.versionId?.major &&
				latestVersion?.versionId?.minor > currentVersionInfo?.versionId?.minor
			) {
				return true
			}
			if (
				latestVersion?.versionId?.major === currentVersionInfo?.versionId?.major &&
				latestVersion?.versionId?.minor === currentVersionInfo?.versionId?.minor &&
				latestVersion?.versionId?.micro > currentVersionInfo?.versionId?.micro
			) {
				return true
			}

			return false
		} catch (error) {
			throw new Error(`检查更新时发生错误: ${error instanceof Error ? error.message : "未知错误"}`)
		}
	}
}
