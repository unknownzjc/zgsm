import { PackageInfoResponse, VersionInfo } from "./types"

/**
 * 包信息 API 类
 * 用于获取客户端文件检验信息
 */
export class PackageInfoApi {
	private baseUrl: string

	/**
	 * 构造函数
	 * @param baseUrl API 基础 URL，默认为 https://zgsm.sangfor.com/shenma/api/v1
	 */
	constructor(baseUrl: string) {
		this.baseUrl = baseUrl
	}

	/**
	 * 获取指定版本的包信息
	 * @param version 版本字符串，格式为 "major.minor.micro"，例如 "1.0.731"
	 * @returns Promise<PackageInfoResponse> 返回包信息响应
	 * @throws 当 API 调用失败时抛出错误
	 */
	async getPackageInfo(versionInfo: VersionInfo): Promise<PackageInfoResponse> {
		const url = `${this.baseUrl}${versionInfo.infoUrl}`

		try {
			const response = await fetch(url)

			if (!response.ok) {
				const errorData = await await response.text()
				throw new Error(`获取包信息失败: ${errorData}`)
			}

			const data: PackageInfoResponse = await response.json()
			return data
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`获取包信息时发生错误: ${error.message}`)
			} else {
				throw new Error("获取包信息时发生未知错误")
			}
		}
	}
}
