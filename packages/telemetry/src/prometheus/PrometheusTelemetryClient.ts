import { Pushgateway, Registry } from "prom-client"
import delay from "delay"
import crypto from "crypto"
import retry from "async-retry"
import path from "path"
import * as lockfile from "proper-lockfile"
import * as fs from "fs/promises"
import * as os from "os"

import { type TelemetryEvent, TelemetryEventName } from "@roo-code/types"

import { BaseTelemetryClient } from "../BaseTelemetryClient"
import MetricsRecorder from "./metrics"
import { createLogger, ILogger } from "../../../../src/utils/logger"
import { getWorkspacePath } from "../../../../src/utils/path"
import { Package } from "../../../../src/shared/package"
import { ClineProvider } from "../../../../src/core/webview/ClineProvider"
import { MetricsSerializer } from "./MetricsSerializer"

export class PrometheusTelemetryClient extends BaseTelemetryClient {
	private endpoint: string
	private logger: ILogger
	private metricsSerializer: MetricsSerializer
	private persistenceFilePath: string

	constructor(endpoint: string, debug = false) {
		super(
			{
				type: "include",
				events: [
					TelemetryEventName.CODE_ACCEPT,
					TelemetryEventName.CODE_REJECT,
					TelemetryEventName.CODE_TAB_COMPLETION,
					TelemetryEventName.ERROR,
				],
			},
			debug,
		)
		this.endpoint = endpoint
		this.logger = createLogger(Package.outputChannel)
		this.metricsSerializer = new MetricsSerializer(this.logger)

		const workspaceHash = this.hashWorkspaceDir()
		const homeDir = os.homedir()
		const persistenceDir = path.join(homeDir, ".costrict", "telemetry")
		this.persistenceFilePath = path.join(persistenceDir, `metrics-${workspaceHash}.json`)

		this.setupPush()
		this.updateTelemetryState(true)
	}

	private async operateWithLock<T>(
		operation: (recorder: MetricsRecorder, registry: Registry) => Promise<T>,
	): Promise<T | undefined> {
		try {
			// Check if file exists first, only create directory and file if needed
			try {
				await fs.access(this.persistenceFilePath)
			} catch (_) {
				// File doesn't exist, create directory and file
				await fs.mkdir(path.dirname(this.persistenceFilePath), { recursive: true })
				await fs.writeFile(this.persistenceFilePath, "[]", "utf-8")
			}

			await lockfile.lock(this.persistenceFilePath)

			const tempRegistry = new Registry()
			// Recorder is created ONCE here to register metrics.
			const tempRecorder = new MetricsRecorder(tempRegistry)

			await this.metricsSerializer.load(tempRegistry, this.persistenceFilePath)

			// We pass the recorder instance to the operation.
			const result = await operation(tempRecorder, tempRegistry)

			return result
		} catch (error) {
			this.logger.error(`[PrometheusTelemetryClient] Lock operation failed: ${error}`)
			return undefined
		} finally {
			await lockfile.unlock(this.persistenceFilePath)
		}
	}

	private hashWorkspaceDir() {
		return crypto.createHash("sha256").update(getWorkspacePath()).digest("hex").toString().slice(0, 8)
	}
	private async setupPush() {
		const times = 60 * 60 * 1000
		setInterval(async () => {
			try {
				if (this.debug) {
					this.logger.debug(`[PrometheusTelemetryClient] Periodic push triggered.`)
				}
				await delay(Math.random() * 1000)
				await this.pushAdd()
			} catch (error) {
				this.logger.error(`[PrometheusTelemetryClient#setupPush] ${error}`)
			}
		}, times)
	}

	public async pushAdd() {
		return this.operateWithLock(async (recorder, registry) => {
			// recorder is unused here, which is perfectly fine.
			if ((await registry.getMetricsAsJSON()).length === 0) {
				this.logger.debug("[PrometheusTelemetryClient] No metrics to push.")
				return
			}
			const provider = this.providerRef?.deref() as unknown as ClineProvider
			const { apiConfiguration } = await provider.getState()
			const { zgsmAccessToken } = apiConfiguration
			const client = new Pushgateway(
				this.endpoint,
				{ headers: { Authorization: `Bearer ${zgsmAccessToken}` } },
				registry,
			)
			await retry(
				() =>
					client.pushAdd({
						jobName: "costrict",
						groupings: { instance: this.hashWorkspaceDir() },
					}),
				{ retries: 3 },
			)

			this.logger.debug("[PrometheusTelemetryClient] Push successful.")
		})
	}

	public override async capture(event: TelemetryEvent): Promise<void> {
		if (!this.isTelemetryEnabled() || !this.isEventCapturable(event.event)) {
			if (this.debug) {
				this.logger.debug(`[PrometheusTelemetryClient#capture] Skipping event: ${event.event}`)
			}
			return
		}

		await this.operateWithLock(async (recorder, registry) => {
			// Use the recorder instance passed from operateWithLock. NO `new` here.
			const properties = await this.getEventProperties(event)
			recorder.record({ event: event.event, properties })

			// Save the modified state back to the file.
			await this.metricsSerializer.save(registry, this.persistenceFilePath)

			if (this.debug) {
				this.logger.debug(`[PrometheusTelemetryClient#capture] Captured and persisted: ${event.event}`)
			}
		})
	}

	protected override async getEventProperties(event: TelemetryEvent) {
		let providerProperties: TelemetryEvent["properties"] = {}
		const { properties } = event
		const provider = this.providerRef?.deref()
		if (provider) {
			try {
				// Get properties from the provider
				providerProperties = await provider.getTelemetryProperties()
			} catch (error) {
				// Log error but continue with capturing the event.
				console.error(
					`Error getting telemetry properties: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
		const mergedProperties = { ...providerProperties, ...(properties || {}) }
		return mergedProperties
	}
	public override updateTelemetryState(_didUserOptIn: boolean): void {
		this.telemetryEnabled = true
	}
	public override shutdown(): Promise<void> {
		return new Promise((resolve) => {
			this.pushAdd()
				.catch((error) => {
					this.logger.error(`[PrometheusTelemetryClient#shutdown] Final push failed: ${error}`)
				})
				.finally(resolve)
		})
	}
}
