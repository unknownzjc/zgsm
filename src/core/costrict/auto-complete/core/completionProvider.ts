import OpenAI from "openai"
import { Completion } from "openai/resources/completions"
import { ClineProvider } from "../../../webview/ClineProvider"
import { ZgsmAuthConfig } from "../../auth/authConfig"
import { ZgsmAuthStorage } from "../../auth/authStorage"
import { NOT_PROVIDERED, settings } from "../../base/common/constant"
import { CalculateHideScore, PromptOptions, AutocompleteOutcome } from "../types"
import { ProviderSettings } from "@roo-code/types"
import { COSTRICT_DEFAULT_HEADERS } from "../../../../shared/headers"
import { getClientId } from "../../../../utils/getClientId"
import { AutocompleteDebouncer } from "../utils/autocompleteDebouncer"
import { AutocompleteLoggingService } from "../utils/autocompleteLoggingService"

export interface AutoCompleteInput {
	completionId: string
	languageId: string
	promptOptions: PromptOptions
	calculateHideScore: CalculateHideScore
}
const MAX_SUGGESTIONS_HISTORY = 20
const DEBOUNCE_DELAY_MS = 300
interface FillInAtCursorSuggestion {
	text: string
	prefix: string
	suffix: string
	completionId: string
}
interface LLMRetrievalResult {
	suggestions: FillInAtCursorSuggestion
	completionId: string
	time: number
	timestamp: string
}
/**
 * Find a matching suggestion from the history based on current prefix and suffix
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion text, or null if no match found
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): { text: string; completionId: string } | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// First, try exact prefix/suffix match
		if (prefix === fillInAtCursor.prefix && suffix === fillInAtCursor.suffix) {
			return { text: fillInAtCursor.text, completionId: fillInAtCursor.completionId }
		}

		// If no exact match, but suggestion is available, check for partial typing
		// The user may have started typing the suggested text
		if (
			fillInAtCursor.text !== "" &&
			prefix.startsWith(fillInAtCursor.prefix) &&
			suffix === fillInAtCursor.suffix
		) {
			// Extract what the user has typed between the original prefix and current position
			const typedContent = prefix.substring(fillInAtCursor.prefix.length)

			// Check if the typed content matches the beginning of the suggestion
			if (fillInAtCursor.text.startsWith(typedContent)) {
				// Return the remaining part of the suggestion (with already-typed portion removed)
				return {
					text: fillInAtCursor.text.substring(typedContent.length),
					completionId: fillInAtCursor.completionId,
				}
			}
		}
	}

	return null
}
export class CompletionProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []
	private debouncer = new AutocompleteDebouncer()
	private loggingService = new AutocompleteLoggingService()

	constructor(private readonly provider: ClineProvider) {}

	private async _prepareLlm() {
		const { apiConfiguration } = await this.provider.getState()
		if (!apiConfiguration.zgsmAccessToken) {
			this.provider.log("Failed to get login information. Please log in again to use the completion service")
			return undefined
		}
		const apiConfig = await this._getApiConfig(apiConfiguration)
		const fullUrl = `${apiConfig.baseUrl}${apiConfig.completionUrl}`
		if (apiConfig.apiKey === NOT_PROVIDERED) {
			return undefined
		}
		return new OpenAI({
			baseURL: fullUrl,
			apiKey: apiConfig.apiKey,
			defaultHeaders: {
				...COSTRICT_DEFAULT_HEADERS,
			},
			timeout: 5000,
			maxRetries: 0,
		})
	}

	private async _getApiConfig(apiConfiguration: ProviderSettings) {
		const completionUrl = "/code-completion/api/v1"
		const tokens = await ZgsmAuthStorage.getInstance().getTokens()

		return {
			baseUrl: apiConfiguration.zgsmBaseUrl || ZgsmAuthConfig.getInstance().getDefaultApiBaseUrl(),
			completionUrl,
			apiKey: apiConfiguration.zgsmAccessToken || tokens?.access_token || NOT_PROVIDERED,
		}
	}

	/**
	 * 提供内联补全项
	 * @param input - 补全输入参数
	 * @param token - 可选的外部 AbortSignal（由 VSCode CancellationToken 转换而来）
	 * @returns 补全结果，或 undefined（取消/错误）
	 */
	public async provideInlineCompletionItems(
		input: AutoCompleteInput,
		token?: AbortSignal,
	): Promise<AutocompleteOutcome | undefined> {
		// 1. 取消之前的所有请求
		this.loggingService.cancel()

		// 2. 没有外部 token 才创建内部 controller
		if (!token) {
			const abortController = this.loggingService.createAbortController(input.completionId)
			token = abortController.signal
		}

		try {
			// 3. 检查是否已取消
			if (token.aborted) {
				return undefined
			}

			const llm = await this._prepareLlm()
			if (!llm) {
				return undefined
			}

			// 4. Debounce
			const shouldDebounce = await this.debouncer.delayAndShouldDebounce(DEBOUNCE_DELAY_MS, token)
			if (shouldDebounce) {
				return undefined
			}

			// 5. 再次检查是否已取消
			if (token.aborted) {
				return undefined
			}

			const startTime = Date.now()
			const { prefix, suffix } = input.promptOptions
			const suggestion = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)
			let completion: string | undefined = ""
			let completionId: string | undefined = ""
			let cacheHit = false

			if (suggestion != null) {
				completion = suggestion.text
				completionId = suggestion.completionId
				cacheHit = true
			} else {
				// 6. 发起网络请求
				await this.fetchAndCacheSuggestions(llm, input, token)

				// 7. 竞态检查
				if (token.aborted) {
					return undefined
				}

				const suggestion = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)
				if (!suggestion) {
					return undefined
				}
				completion = suggestion.text
				completionId = suggestion.completionId
			}

			// 8. 最终检查是否已取消
			if (token.aborted) {
				return undefined
			}

			const outcome: AutocompleteOutcome = {
				time: Date.now() - startTime,
				completion,
				completionId,
				cacheHit,
			}
			return outcome
		} catch (e) {
			// 9. 错误处理：捕获 AbortError
			if (this.isAbortError(e)) {
				return undefined
			}
			throw e
		} finally {
			// 10. 清理资源
			this.loggingService.deleteAbortController(input.completionId)
		}
	}

	/**
	 * 判断是否为 AbortError
	 */
	private isAbortError(e: unknown): boolean {
		if (e instanceof Error) {
			return (
				e.name === "AbortError" ||
				e.message.includes("aborted") ||
				e.message.includes("cancelled") ||
				e.message.includes("canceled")
			)
		}
		return false
	}

	public updateSuggestions(fillInAtCursor: FillInAtCursorSuggestion): void {
		const isDuplicate = this.suggestionsHistory.some(
			(existing) =>
				existing.text === fillInAtCursor.text &&
				existing.prefix === fillInAtCursor.prefix &&
				existing.suffix === fillInAtCursor.suffix,
		)

		if (isDuplicate) {
			return
		}

		// Add to the end of the array (most recent)
		this.suggestionsHistory.push(fillInAtCursor)

		// Remove oldest if we exceed the limit
		if (this.suggestionsHistory.length > MAX_SUGGESTIONS_HISTORY) {
			this.suggestionsHistory.shift()
		}
	}

	private async fetchAndCacheSuggestions(llm: OpenAI, input: AutoCompleteInput, token: AbortSignal) {
		const response = await this.getFromLLM(llm, input, token)

		// 竞态检查：更新缓存前检查是否已取消
		if (token.aborted) {
			return
		}

		this.updateSuggestions(response.suggestions)
	}

	private async getFromLLM(llm: OpenAI, input: AutoCompleteInput, token: AbortSignal) {
		const clientId = getClientId()
		const headers = {
			...COSTRICT_DEFAULT_HEADERS,
			"X-Request-ID": input.completionId,
			"zgsm-client-id": clientId,
		}
		const { prefix, suffix } = input.promptOptions
		const response = await llm.completions.create(
			{
				model: settings.openai_model,
				temperature: settings.temperature,
				prompt: null,
			},
			{
				headers,
				signal: token, // 传递给 OpenAI SDK 以支持取消网络请求
				body: {
					model: settings.openai_model,
					temperature: settings.temperature,
					client_id: clientId,
					stop: [],
					completion_id: input.completionId,
					language_id: input.languageId,
					calculate_hide_score: input.calculateHideScore,
					prompt_options: input.promptOptions,
					parent_id: "",
				},
			},
		)
		const text = this.acquireCompletionText(response)
		const completionId = this.acquireCompletionId(response)
		return {
			suggestions: {
				text,
				prefix,
				suffix,
				completionId,
			},
		}
	}

	private acquireCompletionText(response: Completion) {
		const choice = response?.choices?.find((c) => c.text?.trim())
		if (!choice?.text) {
			return ""
		}

		let text = choice.text.trim()

		// Since Chinese characters occupy 3 bytes, the plugin may be affected by Max Tokens. When the result is returned, only half of the last Chinese character is returned, resulting in garbled characters.
		// The garbled characters need to be replaced with ''.
		if (text.includes("�")) {
			text = text.replace(/�/g, "")
		}
		return text
	}

	private acquireCompletionId(resp: Completion): string {
		if (!resp || !resp.choices || resp.choices.length === 0 || !resp.id) {
			return ""
		}

		return resp.id
	}

	/**
	 * 取消所有正在进行的请求
	 */
	public cancel(): void {
		this.loggingService.cancel()
	}
}
