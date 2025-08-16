import fs from "fs"
import os from "os"
import { exec, spawn } from "child_process"
import path from "path"
import { jwtDecode } from "jwt-decode"
import { ZgsmAuthApi, ZgsmAuthConfig } from "../auth"
import { getClientId } from "../../../utils/getClientId"
import { ILogger } from "../../../utils/logger"

export function execPromise(command: string, opt: any = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, opt, (error, stdout) => {
			if (error) {
				reject(error)
			} else {
				resolve(stdout?.toString())
			}
		})
	})
}

export const getWellKnownConfig = () => {
	try {
		// const { homeDir } = this.getTargetPath()
		const wellKnownPath = path.join(os.homedir(), ".costrict", "share", ".well-known.json")

		// 判断 wellKnownPath 文件是否存在
		if (!fs.existsSync(wellKnownPath)) {
			return {
				services: [],
			}
		}

		return JSON.parse(fs.readFileSync(wellKnownPath, "utf-8"))
	} catch (error) {
		return {
			services: [],
		}
	}
}

// 读取信息
export const readAccessToken = () => {
	const homeDir = os.homedir()

	if (!homeDir) {
		throw new Error("无法确定用户主目录路径")
	}

	const tokenDir = path.join(homeDir, ".costrict", "share")

	// 确保目录存在
	if (!fs.existsSync(tokenDir)) {
		return null
	}
	const tokenFilePath = path.join(tokenDir, "auth.json")
	// 读取令牌文件
	if (!fs.existsSync(tokenFilePath)) {
		return null
	}
	return JSON.parse(fs.readFileSync(tokenFilePath, "utf8"))
}
export const writeAccessToken = async (accessToken: string) => {
	const homeDir = os.homedir()

	if (!homeDir) {
		throw new Error("无法确定用户主目录路径")
	}

	const tokenDir = path.join(homeDir, ".costrict", "share")

	// 确保目录存在
	if (!fs.existsSync(tokenDir)) {
		fs.mkdirSync(tokenDir, { recursive: true })
	}
	const tokenFilePath = path.join(tokenDir, "auth.json")
	// 写入令牌文件
	const jwt = jwtDecode(accessToken) as any
	const { zgsmBaseUrl } = await ZgsmAuthApi.getInstance().getApiConfiguration()
	const baseUrl = zgsmBaseUrl || ZgsmAuthConfig.getInstance().getDefaultApiBaseUrl()

	const config = {
		id: jwt.id,
		name: jwt.displayName,
		access_token: accessToken,
		machine_id: getClientId(),
		base_url: baseUrl,
	}
	fs.writeFileSync(tokenFilePath, JSON.stringify(config, null, 2), "utf8")
}

export const getServiceConfig = (serverName: string) => {
	const { services } = getWellKnownConfig()
	const service = services.find((item: any) => item.name === serverName.split(".")[0])
	return service
}

export function processIsRunning(processName: string, logger: ILogger): Promise<number[]> {
	return new Promise((resolve, reject) => {
		const platform = os.platform()

		let cmd: string
		let args: string[]

		if (platform === "linux" || platform === "darwin") {
			cmd = "pgrep"
			args = ["-x", processName]
		} else if (platform === "win32") {
			cmd = "tasklist"
			args = ["/FI", `IMAGENAME eq ${processName}`, "/FO", "CSV", "/NH"]
		} else {
			return reject(new Error(`Unsupported platform: ${platform}`))
		}

		const ps = spawn(cmd, args)

		const chunks: Buffer[] = []
		ps.stdout.on("data", (data) => chunks.push(data))
		ps.stderr.on("data", (data) => {
			const errorMsg = data.toString().trim()
			if (errorMsg) {
				logger.error(`stderr[${cmd}]:` + errorMsg)
			}
		})

		ps.on("close", (code) => {
			try {
				const output = Buffer.concat(chunks)
				const stdout = output.toString("utf8").trim()

				if (platform === "win32") {
					// Windows 平台处理
					if (!stdout || stdout.includes("No tasks are running") || stdout.includes("信息:")) {
						return resolve([])
					}

					const lines = stdout.split("\n")
					const pids: number[] = []

					for (const line of lines) {
						if (!line.trim()) continue

						try {
							// 更健壮的 CSV 解析
							const parts = line.split('","').map((p) => p.replace(/^"|"$/g, ""))
							if (parts.length >= 2) {
								const pid = parseInt(parts[1], 10)
								if (!isNaN(pid) && pid > 0) {
									pids.push(pid)
								}
							}
						} catch (parseError) {
							logger.warn(`解析行失败: "${line}"` + parseError)
							continue
						}
					}

					return resolve(pids)
				} else {
					// Linux/macOS 平台处理
					if (code === 0) {
						const pids = stdout
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0)
							.map(Number)
							.filter((pid) => !isNaN(pid) && pid > 0)

						return resolve(pids)
					} else {
						// pgrep 返回非零码通常表示未找到进程
						return resolve([])
					}
				}
			} catch (error) {
				logger.error("处理进程列表时出错:" + error.message)
				return resolve([]) // 出错时返回空数组而不是抛出异常
			}
		})

		ps.on("error", (err) => {
			logger.error(`执行命令失败 [${cmd} ${args.join(" ")}]:` + err.message)
			reject(err)
		})
	})
}
