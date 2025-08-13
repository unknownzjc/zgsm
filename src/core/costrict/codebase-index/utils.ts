import { exec } from "child_process"

export function execPromise(command: string, opt: any = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, opt, (error, stdout) => {
			if (error) {
				reject(error)
			} else {
				resolve(stdout?.toString())
			}
		}).unref()
	})
}
