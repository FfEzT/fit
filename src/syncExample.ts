import { Fit } from "./fit"
import { VaultOperations } from "./vaultOps"
import { FitSyncNew } from "./fitSyncNew"
import { FitPullNew } from "./fitPullNew"
import { FitPushNew } from "./fitPushNew"
import { LocalStores } from "main"
import FitNotice from "./fitNotice"
import { GitHubRateLimiter } from "./rateLimiter"

/**
 * Example of how to use the new functional programming-based synchronization architecture
 */
export class SyncExample {
    private fit: Fit
    private vaultOps: VaultOperations
    private fitSync: FitSyncNew
    private fitPull: FitPullNew
    private fitPush: FitPushNew
    private rateLimiter: GitHubRateLimiter

    constructor(
        fit: Fit,
        vaultOps: VaultOperations,
        saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>
    ) {
        this.fit = fit
        this.vaultOps = vaultOps
        this.rateLimiter = new GitHubRateLimiter()

        this.fitSync = new FitSyncNew(fit, vaultOps, saveLocalStoreCallback)
        this.fitPull = new FitPullNew(fit)
        this.fitPush = new FitPushNew(fit)
    }

    /**
     * Example of a full synchronization using the new architecture
     */
    async performFullSync(): Promise<void> {
        const syncNotice = new FitNotice(["Starting synchronization..."])

        try {
            // Perform full synchronization with minimal locking and maximum parallelism
            const result = await this.fitSync.sync(syncNotice)

            if (result) {
                console.log(`Sync completed successfully!`)
                console.log(`Local operations: ${result.ops[0].ops.length}`)
                console.log(`Remote operations: ${result.ops[1].ops.length}`)
                console.log(`Conflicts: ${result.clash.length}`)

                if (result.clash.length > 0) {
                    console.log("Conflicts detected:")
                    result.clash.forEach(conflict => {
                        console.log(`  - ${conflict.path}: local=${conflict.localStatus}, remote=${conflict.remoteStatus}`)
                    })
                }
            }
        } catch (error) {
            console.error("Synchronization failed:", error)
            syncNotice.setMessage(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Example of pulling only remote changes
     */
    async pullRemoteChangesOnly(): Promise<void> {
        const saveLocalStoreCallback = async (path: string, localStore: Partial<LocalStores>) => {
            // Implementation would save to local storage
            console.log("Saving local store:", localStore)
        }

        try {
            const fileOps = await this.fitPull.pullRemoteToLocal(saveLocalStoreCallback)
            console.log(`Pulled ${fileOps.length} files from remote`)

            fileOps.forEach(op => {
                console.log(`  ${op.status}: ${op.path}`)
            })
        } catch (error) {
            console.error("Pull operation failed:", error)
        }
    }

    /**
     * Example of pushing only local changes
     */
    async pushLocalChangesOnly(): Promise<void> {
        const saveLocalStoreCallback = async (path: string, localStore: Partial<LocalStores>) => {
            // Implementation would save to local storage
            console.log("Saving local store:", localStore)
        }

        try {
            // Get local changes
            const localChanges = await this.fit.getLocalChanges()

            if (localChanges.length === 0) {
                console.log("No local changes to push")
                return
            }

            // Get latest remote commit SHA
            const { remoteCommitSha } = await this.fit.remoteUpdated()

            const localUpdate = {
                localChanges,
                parentCommitSha: remoteCommitSha
            }

            const result = await this.fitPush.pushChangedFilesToRemote(localUpdate, saveLocalStoreCallback)

            if (result) {
                console.log(`Pushed ${result.pushedChanges.length} files to remote`)

                result.pushedChanges.forEach(change => {
                    console.log(`  ${change.status}: ${change.path}`)
                })
            }
        } catch (error) {
            console.error("Push operation failed:", error)
        }
    }

    /**
     * Example of monitoring rate limiter stats
     */
    monitorRateLimiter(): void {
        const stats = this.rateLimiter.getStats()
        console.log("Rate Limiter Stats:")
        console.log(`  Current running: ${stats.currentRunning}`)
        console.log(`  Queue length: ${stats.queueLength}`)
        console.log(`  Requests in window: ${stats.requestCount}`)
        console.log(`  Window time left: ${Math.round(stats.windowTimeLeft / 1000)}s`)
    }

    /**
     * Example of custom rate limiting for specific operations
     */
    async executeWithCustomRateLimit<T>(
        operation: () => Promise<T>,
        maxConcurrent: number = 5,
        maxRequestsPerWindow: number = 100
    ): Promise<T> {
        const customRateLimiter = new GitHubRateLimiter()

        // Override the default settings
        ;(customRateLimiter as any).maxConcurrent = maxConcurrent
        ;(customRateLimiter as any).maxRequestsPerWindow = maxRequestsPerWindow

        return await customRateLimiter.execute(operation)
    }
}

/**
 * Factory function to create a new SyncExample instance
 */
export function createSyncExample(
    fit: Fit,
    vaultOps: VaultOperations,
    saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>
): SyncExample {
    return new SyncExample(fit, vaultOps, saveLocalStoreCallback)
}
