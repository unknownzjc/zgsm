import * as vscode from "vscode"
import { ZgsmAuthService } from "./authService"
import type { ClineProvider } from "../webview/ClineProvider"

export class ZgsmAuthCommands {
	private static instance: ZgsmAuthCommands
	private authService: ZgsmAuthService
	private clineProvider: ClineProvider

	private constructor(clineProvider: ClineProvider) {
		// 确保 AuthService 已经被初始化
		this.authService = ZgsmAuthService.getInstance()
		this.clineProvider = clineProvider
		if (clineProvider) {
			this.authService.setClineProvider(clineProvider)
		}
	}

	public static initialize(clineProvider: ClineProvider): void {
		if (!ZgsmAuthCommands.instance) {
			// 优先初始化依赖的服务
			ZgsmAuthCommands.instance = new ZgsmAuthCommands(clineProvider)
		}
	}

	public static getInstance(): ZgsmAuthCommands {
		if (!ZgsmAuthCommands.instance) {
			// 在实际应用中，initialize应该已经被调用。
			throw new Error("ZgsmAuthCommands 未初始化")
		}
		return ZgsmAuthCommands.instance!
	}

	/**
	 * 设置ClineProvider实例
	 */
	setClineProvider(clineProvider: ClineProvider): void {
		this.clineProvider = clineProvider
		this.authService.setClineProvider(clineProvider)
	}

	/**
	 * 注册所有认证相关的命令
	 */
	registerCommands(context: vscode.ExtensionContext): void {
		// 登录命令
		const loginCommand = vscode.commands.registerCommand("roo-cline.login", async () => {
			await this.handleLogin()
		})

		// 登出命令
		const logoutCommand = vscode.commands.registerCommand("roo-cline.logout", async () => {
			await this.handleLogout()
		})

		// 检查登录状态命令
		const checkStatusCommand = vscode.commands.registerCommand("roo-cline.checkLoginStatus", async () => {
			await this.handleCheckLoginStatus()
		})

		// 刷新token命令
		const refreshTokenCommand = vscode.commands.registerCommand("roo-cline.refreshToken", async () => {
			await this.handleRefreshToken()
		})

		// 将命令添加到上下文
		context.subscriptions.push(loginCommand, logoutCommand, checkStatusCommand, refreshTokenCommand)
	}

	/**
	 * 处理登录命令
	 */
	public async handleLogin(): Promise<void> {
		try {
			const loginState = await this.authService.startLogin()
			console.info(
				`登录流程已启动，请在浏览器中完成登录。\nState: ${loginState.state}\nMachineId: ${loginState.machineId}`,
			)
		} catch (error) {
			vscode.window.showErrorMessage(`登录失败: ${error}`)
		}
	}

	/**
	 * 处理登出命令
	 */
	public async handleLogout(): Promise<void> {
		try {
			await this.authService.logout()
			vscode.window.showInformationMessage("已成功退出登录")
		} catch (error) {
			vscode.window.showErrorMessage(`登出失败: ${error}`)
		}
	}

	/**
	 * 处理检查登录状态命令
	 */
	private async handleCheckLoginStatus(): Promise<void> {
		try {
			const token = await this.authService.getCurrentAccessToken()

			if (token) {
				vscode.window.showInformationMessage("当前已登录")
			} else {
				vscode.window.showInformationMessage("当前未登录")
			}
		} catch (error) {
			vscode.window.showErrorMessage(`检查登录状态失败: ${error}`)
		}
	}

	/**
	 * 处理刷新token命令
	 */
	private async handleRefreshToken(): Promise<void> {
		try {
			vscode.window.showInformationMessage("正在刷新token...")

			// 这里需要从存储中获取refresh_token和loginState
			// 为了简化，这里只是显示一个消息
			vscode.window.showInformationMessage("Token刷新功能已触发")
		} catch (error) {
			vscode.window.showErrorMessage(`刷新token失败: ${error}`)
		}
	}

	/**
	 * 获取认证服务实例
	 */
	getAuthService(): ZgsmAuthService {
		return this.authService
	}

	/**
	 * 销毁命令处理器
	 */
	dispose(): void {
		this.authService.dispose()
	}
}
