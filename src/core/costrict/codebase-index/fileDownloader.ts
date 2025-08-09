import * as fs from "fs"
import * as https from "https"
import * as http from "http"
import { URL } from "url"
import { PlatformDetector } from "./platform"
import { PackageInfoResponse, VersionInfo } from "./types"
import path from "path"
import * as crypto from "crypto"

/**
 * 下载进度回调函数类型
 * @param downloaded 已下载的字节数
 * @param total 总字节数
 * @param progress 下载进度百分比 (0-100)
 */
export type DownloadProgressCallback = (downloaded: number, total: number, progress: number) => void

/**
 * 文件下载器类
 * 用于从远程服务器下载客户端文件，支持进度回调和取消操作
 */
export class FileDownloader {
	private platformDetector: PlatformDetector
	private baseUrl: string
	private publicKey: string
	private abortController: AbortController | null = null
	private timeout: number

	/**
	 * 构造函数
	 * @param baseUrl API 基础 URL，默认为 https://zgsm.sangfor.com/shenma/api/v1
	 * @param timeout 请求超时时间（毫秒），默认为 30000ms (30秒)
	 */
	constructor(baseUrl: string, publicKey: string, timeout: number = 30000) {
		this.platformDetector = new PlatformDetector()
		this.baseUrl = baseUrl
		this.publicKey = publicKey
		this.timeout = timeout
	}

	/**
	 * 下载客户端文件
	 * @param version 版本字符串，格式为 "major.minor.micro"
	 * @param targetPath 文件保存路径
	 * @param packageInfo 包信息响应对象
	 * @param onProgress 下载进度回调函数
	 * @returns Promise<string> 下载完成后返回文件路径
	 * @throws 当下载失败时抛出错误
	 */
	async downloadClient(
		targetPath: string,
		versionInfo: VersionInfo,
		packageInfo: PackageInfoResponse,
		onProgress?: DownloadProgressCallback,
	): Promise<string> {
		const downloadUrl = `${this.baseUrl}${versionInfo.appUrl}`

		this.abortController = new AbortController()

		try {
			await this.downloadFileWithProgress(downloadUrl, targetPath, onProgress)

			// 验证文件完整性
			await this.verifyFileChecksum(targetPath, packageInfo.checksum, packageInfo.checksumAlgo)
			// // todo: 验证文件签名
			// if (!(await this.verifySignature(packageInfo.checksum, packageInfo.sign, this.publicKey))) {
			// 	fs.unlink(targetPath, () => {})
			// 	throw new Error("文件签名验证失败")
			// }

			// 如果不是 Windows 平台，设置文件可执行权限
			if (packageInfo.os !== "windows") {
				await fs.promises.chmod(targetPath, 0o755)
			}

			// 返回下载的文件路径
			return targetPath
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`下载客户端文件失败: ${error.message}`)
			}
			throw new Error("下载客户端文件时发生未知错误")
		} finally {
			this.abortController = null
		}
	}

	/**
	 * 取消当前下载操作
	 */
	cancelDownload(): void {
		if (this.abortController) {
			this.abortController.abort()
			this.abortController = null
		}
	}

	/**
	 * 使用流式下载文件，支持进度回调
	 * @param url 下载 URL
	 * @param targetPath 目标文件路径
	 * @param onProgress 进度回调函数
	 * @private
	 */
	private async downloadFileWithProgress(
		url: string,
		targetPath: string,
		onProgress?: DownloadProgressCallback,
		maxRetries: number = 3,
	): Promise<void> {
		const attemptDownload = async (attempt: number): Promise<void> => {
			return new Promise((resolve, reject) => {
				const parsedUrl = new URL(url)
				const isHttps = parsedUrl.protocol === "https:"
				const client = isHttps ? https : http

				const options = {
					hostname: parsedUrl.hostname,
					port: parsedUrl.port || (isHttps ? 443 : 80),
					path: parsedUrl.pathname + parsedUrl.search,
					method: "GET",
					timeout: this.timeout,
					signal: this.abortController?.signal,
				}

				const req = client.request(options, (res) => {
					if (res.statusCode !== 200) {
						reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`))
						return
					}

					const contentLength = parseInt(res.headers["content-length"] || "0", 10)
					let downloaded = 0

					const dir = path.dirname(targetPath)
					if (!fs.existsSync(dir)) {
						fs.mkdirSync(dir, { recursive: true })
					}

					const fileStream = fs.createWriteStream(targetPath)

					res.on("data", (chunk) => {
						downloaded += chunk.length

						if (onProgress && contentLength > 0) {
							const progress = Math.min(100, Math.round((downloaded / contentLength) * 100))
							onProgress(downloaded, contentLength, progress)
						}
					})

					res.pipe(fileStream)

					fileStream.on("finish", () => {
						fileStream.close()
						resolve()
					})

					fileStream.on("error", async (err) => {
						try {
							if (fs.existsSync(targetPath)) {
								await fs.promises.unlink(targetPath)
							}
						} catch (cleanupError) {
							console.error(`[FileDownloader] 清理失败文件时发生错误: ${targetPath}`, cleanupError)
						}
						reject(err)
					})
				})

				req.on("error", async (err) => {
					try {
						if (fs.existsSync(targetPath)) {
							await fs.promises.unlink(targetPath)
						}
					} catch (cleanupError) {
						console.error(`[FileDownloader] 清理失败文件时发生错误: ${targetPath}`, cleanupError)
					}
					reject(err)
				})

				req.on("timeout", () => {
					req.destroy()
					reject(new Error("Download request timeout"))
				})

				req.end()
			})
		}

		// Retry logic
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				await attemptDownload(attempt)
				return // Success
			} catch (error) {
				if (attempt === maxRetries) {
					throw new Error(
						`Download failed after ${maxRetries + 1} attempts. Last error: ${(error as Error).message}`,
					)
				}

				console.log(`Download attempt ${attempt + 1} failed, retrying...`)
				await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
			}
		}
	}

	private verifySignature(checksum: string, signatureHex: string, publicKeyPem: string): boolean {
		const signature = Buffer.from(signatureHex, "hex")
		const verifier = crypto.createVerify("SHA256")
		verifier.update(checksum)
		verifier.end()
		return verifier.verify(publicKeyPem, signature)
	}

	/**
	 * 验证文件校验和
	 * @param filePath 文件路径
	 * @param expectedChecksum 期望的校验和
	 * @param algorithm 校验算法，默认为 md5
	 * @private
	 */
	private async verifyFileChecksum(
		filePath: string,
		expectedChecksum: string,
		algorithm: string = "md5",
	): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const hash = crypto.createHash(algorithm)
			const stream = fs.createReadStream(filePath)

			stream.on("data", (chunk) => {
				hash.update(chunk)
			})

			stream.on("end", () => {
				const actualChecksum = hash.digest("hex")
				if (actualChecksum.toLowerCase() === expectedChecksum.toLowerCase()) {
					resolve(true)
				} else {
					fs.unlink(filePath, () => {})
					reject(new Error(`文件校验失败: 期望 ${expectedChecksum}, 实际 ${actualChecksum}`))
				}
			})

			stream.on("error", (err) => {
				reject(err)
			})
		})
	}
}
