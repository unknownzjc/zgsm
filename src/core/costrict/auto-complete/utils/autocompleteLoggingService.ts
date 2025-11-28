/**
 * The following code is modified based on
 * https://github.com/continuedev/continue/blob/main/core/autocomplete/util/AutocompleteLoggingService.ts
 *
 * Apache-2.0 License
 * Copyright 2023 Continue Dev, Inc.
 * https://github.com/continuedev/continue/blob/main/LICENSE
 */
export class AutocompleteLoggingService {
	// Key is completionId
	private _abortControllers = new Map<string, AbortController>()
	_lastDisplayedCompletion: { id: string; displayedAt: number } | undefined = undefined

	public createAbortController(completionId: string): AbortController {
		const abortController = new AbortController()
		this._abortControllers.set(completionId, abortController)
		return abortController
	}

	public deleteAbortController(completionId: string) {
		this._abortControllers.delete(completionId)
	}

	public cancel() {
		this._abortControllers.forEach((abortController) => {
			abortController.abort()
		})
		this._abortControllers.clear()
	}
}
