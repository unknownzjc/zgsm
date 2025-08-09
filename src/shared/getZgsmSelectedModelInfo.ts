import {
	anthropicDefaultModelId,
	deepSeekDefaultModelId,
	geminiDefaultModelId,
	mistralDefaultModelId,
	ModelInfo,
	openAiNativeDefaultModelId,
	zgsmModels,
} from "@roo-code/types"

interface IZgsmModelResponseData extends ModelInfo {
	id?: string
}
// Module-level variable to store full response data
let zgsmFullResponseData: WeakRef<IZgsmModelResponseData[]> = new WeakRef([])

export const getZgsmSelectedModelInfo = (modelId: string): IZgsmModelResponseData => {
	if (!modelId) {
		return {} as IZgsmModelResponseData
	}

	const responseData = zgsmFullResponseData.deref()
	if (responseData && responseData.length) {
		const modelInfo = responseData.find((item) => item.id === modelId)

		if (modelInfo) {
			return modelInfo
		}
	}

	const ids = Object.keys(zgsmModels as Record<string, ModelInfo>)

	let mastchKey = ids.find((id) => modelId && id.includes(modelId))

	if (!mastchKey) {
		if (modelId.startsWith("claude-")) {
			mastchKey = anthropicDefaultModelId
		} else if (modelId.startsWith("deepseek-")) {
			mastchKey = deepSeekDefaultModelId
		} else if (modelId.startsWith("gpt-")) {
			mastchKey = openAiNativeDefaultModelId
		} else if (modelId.startsWith("gemini-")) {
			mastchKey = geminiDefaultModelId
		} else if (modelId.startsWith("mistral-")) {
			mastchKey = mistralDefaultModelId
		}
	}

	return (zgsmModels as Record<string, IZgsmModelResponseData>)[`${mastchKey}`] || zgsmModels.default
}

// Function to set full response data
export const setZgsmFullResponseData = (data: IZgsmModelResponseData[]): void => {
	zgsmFullResponseData = new WeakRef(data)
}

// Function to get full response data
export const getZgsmFullResponseData = (): IZgsmModelResponseData[] => {
	return zgsmFullResponseData.deref() || []
}
