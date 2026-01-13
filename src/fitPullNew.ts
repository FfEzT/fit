import { Fit } from "./fit"
import { LocalStores } from "main"
import { FileOpRecord, LocalChange, RemoteChange } from "./fitTypes"
import { PipelineContext } from "./syncPipeline"
import {
    getAllFilePaths,
    calculateFileHash,
    getRemoteTreeSha,
    detectChanges,
    syncRemoteToLocal,
    updateLocalStore
} from "./syncStages"
import { GitHubRateLimiter } from "./rateLimiter"

export interface IFitPullNew {
    fit: Fit
}

export class FitPullNew implements IFitPullNew {
    fit: Fit
    rateLimiter: GitHubRateLimiter

    constructor(fit: Fit) {
        this.fit = fit
        this.rateLimiter = new GitHubRateLimiter()
    }

    private createPipelineContext(saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>): PipelineContext {
        return {
            fit: this.fit,
            saveLocalStoreCallback,
            syncNotice: null as any, // Not used in pull operations
            rateLimiter: this.rateLimiter
        }
    }

    async pullRemoteToLocal(
        saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>
    ): Promise<FileOpRecord[]> {
        const context = this.createPipelineContext(saveLocalStoreCallback)

        try {
            // Stage 1: Get all file paths
            const filePaths = await getAllFilePaths(undefined, context)

            // Stage 2: Calculate file hashes in parallel
            const fileHashes = await Promise.all(
                filePaths.map(path => calculateFileHash(path, context))
            )

            // Stage 3: Get remote tree SHA
            const remoteHashes = await getRemoteTreeSha(undefined, context)

            // Stage 4: Detect changes
            const fileChanges = await detectChanges({ localHashes: fileHashes, remoteHashes }, context)

            // Stage 5: Filter only remote changes
            const remoteOnlyChanges = fileChanges.filter(fc => fc.remoteStatus && !fc.localStatus)

            if (remoteOnlyChanges.length === 0) {
                return []
            }

            // Stage 6: Sync remote changes to local in parallel
            const syncResults = await Promise.all(
                remoteOnlyChanges.map(fc => syncRemoteToLocal(fc, context))
            )

            // Stage 7: Update local store
            await updateLocalStore(syncResults, context)

            // Return successful local operations
            return syncResults
                .filter(r => r.success && r.localOp)
                .map(r => r.localOp) as FileOpRecord[]
        } catch (error) {
            console.error("Pull operation failed:", error)
            throw error
        }
    }

    async getRemoteChanges(): Promise<RemoteChange[]> {
        const context = this.createPipelineContext(async () => {})

        try {
            // Get remote tree SHA
            const remoteHashes = await getRemoteTreeSha(undefined, context)

            // Get remote changes
            const remoteChanges = this.fit.getRemoteChanges(remoteHashes)

            return remoteChanges
        } catch (error) {
            console.error("Failed to get remote changes:", error)
            throw error
        }
    }
}
