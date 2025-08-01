import { ModelInfo } from "../model.js"
import { anthropicModels } from "./anthropic.js"
import { bedrockModels } from "./bedrock.js"
import { chutesModels } from "./chutes.js"
import { claudeCodeModels } from "./claude-code.js"
import { deepSeekModels } from "./deepseek.js"
import { geminiModels } from "./gemini.js"
import { groqModels } from "./groq.js"
import { mistralModels } from "./mistral.js"
import { openAiNativeModels } from "./openai.js"
import { vertexModels } from "./vertex.js"
import { vscodeLlmModels } from "./vscode-llm.js"
import { xaiModels } from "./xai.js"

export const zgsmDefaultModelId = "glm45-fp8"

export const zgsmModels = {
	...anthropicModels,
	...bedrockModels,
	...chutesModels,
	...claudeCodeModels,
	...deepSeekModels,
	...geminiModels,
	...groqModels,
	...mistralModels,
	...openAiNativeModels,
	...vertexModels,
	...vscodeLlmModels,
	...xaiModels,
	"glm45-fp8": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.5-FP8 model with 128k token context window, optimized for agent-based applications with MoE architecture.",
	},
	"qwen25-vl-32b": {
		maxTokens: 32768,
		contextWindow: 64_000,
		maxThinkingTokens: null,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
		minTokensPerCachePoint: undefined,
		maxCachePoints: undefined,
		cachableFields: undefined,
		inputPrice: 1.5,
		outputPrice: 6.0,
		cacheWritesPrice: 1.8,
		cacheReadsPrice: 0.15,
		description: "Qwen2.5-VL Multimodal Model，maximum supporting 64K context, with text and visual capabilities",
	},
	default: {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		maxThinkingTokens: null,
		supportsComputerUse: false,
		supportsPromptCache: true,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
		minTokensPerCachePoint: undefined,
		maxCachePoints: undefined,
		cachableFields: undefined,
		description: undefined,
	} as ModelInfo,
} as const satisfies Record<string, ModelInfo>
