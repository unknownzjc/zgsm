import { Registry } from "prom-client"
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
	private registry: Registry
	private metricsRecorder: MetricsRecorder

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

		// Initialize registry and recorder
		this.registry = new Registry()
		this.metricsRecorder = new MetricsRecorder(this.registry)

		// Load persisted metrics asynchronously (don't block constructor)
		this.loadPersistedMetrics()

		this.setupPush()
		this.updateTelemetryState(true)
	}

	private async operateWithLock<T>(
		operation: (recorder: MetricsRecorder, registry: Registry) => Promise<T>,
	): Promise<T | undefined> {
		let release: (() => Promise<void>) | null = null
		try {
			// Add timeout to lock operation to prevent infinite waiting
			// proper-lockfile returns a release function, which is the recommended way
			release = await lockfile.lock(this.persistenceFilePath, {
				stale: 5000, // Consider lock stale after 30 seconds (helps with zombie locks)
				retries: {
					retries: 3,
					maxTimeout: 1000,
				},
				onCompromised: (err) => {
					this.logger.warn(`[PrometheusTelemetryClient] Lock compromised: ${err.message}`)
				},
			})

			// Use the class-level registry and recorder instances
			const result = await operation(this.metricsRecorder, this.registry)

			return result
		} catch (error) {
			this.logger.error(`[PrometheusTelemetryClient] Lock operation failed: ${error}`)
			return undefined
		} finally {
			if (release) {
				try {
					await release()
				} catch (unlockError) {
					this.logger.error(`[PrometheusTelemetryClient] Failed to release lock: ${unlockError}`)
				}
			}
		}
	}

	private async loadPersistedMetrics(): Promise<void> {
		try {
			// Check if persistence file exists, create if needed
			try {
				await fs.access(this.persistenceFilePath)
			} catch (_) {
				// File doesn't exist, create directory and file
				await fs.mkdir(path.dirname(this.persistenceFilePath), { recursive: true })
				await fs.writeFile(this.persistenceFilePath, "[]", "utf-8")
				return
			}
			// Load existing metrics
			await this.metricsSerializer.load(this.registry, this.persistenceFilePath)
		} catch (error) {
			this.logger.error(`[PrometheusTelemetryClient] Failed to load persisted metrics: ${error}`)
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
		return this.operateWithLock(async (_, registry) => {
			// recorder is unused here, which is perfectly fine.
			const metricsText = await registry.metrics()
			if (!metricsText.trim()) {
				this.logger.debug("[PrometheusTelemetryClient] No metrics to push.")
				return
			}
			const provider = this.providerRef?.deref() as unknown as ClineProvider
			const { apiConfiguration } = await provider.getState()
			const { zgsmAccessToken } = apiConfiguration

			const jobName = "costrict"
			const instance = this.hashWorkspaceDir()
			const pushUrl = `${this.endpoint}/metrics/job/${encodeURIComponent(jobName)}/instance/${encodeURIComponent(instance)}`

			try {
				await retry(
					async () => {
						const response = await fetch(pushUrl, {
							method: "POST",
							headers: {
								"Content-Type": "text/plain",
								Authorization: `Bearer ${zgsmAccessToken}`,
							},
							body: metricsText,
						})

						if (!response.ok) {
							throw new Error(
								`HTTP error! status: ${response.status}, statusText: ${response.statusText}`,
							)
						}
					},
					{
						retries: 2, // Reduce retries to prevent long lock holding
						maxTimeout: 2000,
					},
				)

				this.logger.debug("[PrometheusTelemetryClient] Push successful.")
			} catch (error) {
				this.logger.error(`[PrometheusTelemetryClient] Push failed after retries: ${error}`)
			}
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
