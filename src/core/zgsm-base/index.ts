/**
 * ZGSM Core Module
 *
 * This module provides the core ZGSM functionality including:
 * - Code completion
 * - Code lens providers
 * - Language support
 * - Internationalization
 * - Common utilities
 */

// Re-export all modules
export * from "../zgsm-completion"
export * from "../zgsm-codelens"
export * from "./common"
export * from "./language"

// Export data as a namespace to avoid conflicts
export * as ZgsmData from "./data"

// Export activation functions
export * from "./activate"
