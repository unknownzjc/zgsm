import fs from "fs"
import os from "os"
import { exec, spawn } from "child_process"
import path from "path"
import { jwtDecode } from "jwt-decode"
import { ZgsmAuthApi, ZgsmAuthConfig } from "../auth"
import { getClientId } from "../../../utils/getClientId"

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
	const service = services.find((item: any) => item.name === serverName)
	return service
}

export function processIsRunning(processName: string): Promise<number[]> {
	return new Promise((resolve, reject) => {
		const platform = os.platform()

		let cmd: string
		let args: string[]

		if (platform === "linux" || platform === "darwin") {
			// Linux / macOS
			cmd = "pgrep"
			args = ["-x", processName]
		} else if (platform === "win32") {
			// Windows
			cmd = "tasklist"
			args = ["/FO", "CSV", "/NH"]
		} else {
			return reject(new Error(`Unsupported platform: ${platform}`))
		}

		const ps = spawn(cmd, args)
		let stdout = ""
		let stderr = ""

		ps.stdout.on("data", (data) => (stdout += data.toString()))
		ps.stderr.on("data", (data) => (stderr += data.toString()))

		ps.on("close", (code) => {
			if (platform === "linux" || platform === "darwin") {
				if (code === 0) {
					resolve(stdout.trim().split("\n").map(Number))
				} else {
					resolve([]) // 没找到
				}
			} else if (platform === "win32") {
				const lines = stdout.trim().split("\n")
				const pids: number[] = []
				for (const line of lines) {
					if (!line.trim()) continue
					const parts = line.split('","').map((p) => p.replace(/^"|"$/g, ""))
					const name = parts[0]?.toLowerCase()
					const pid = parseInt(parts[1], 10)
					if (name === processName.toLowerCase()) {
						pids.push(pid)
					}
				}
				resolve(pids)
			}
		})

		ps.on("error", (err) => reject(err))
	})
}
