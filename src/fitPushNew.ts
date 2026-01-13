import { Fit } from "./fit"
import { LocalChange, LocalUpdate } from "./fitTypes"
import { PipelineContext } from "./syncPipeline"
import {
    getAllFilePaths,
    calculateFileHash,
    detectChanges,
    syncLocalToRemote,
    updateLocalStore
} from "./syncStages"
import { GitHubRateLimiter } from "./rateLimiter"

export interface IFitPushNew {
    fit: Fit
}

export class FitPushNew implements IFitPushNew {
    fit: Fit
    rateLimiter: GitHubRateLimiter

    constructor(fit: Fit) {
        this.fit = fit
        this.rateLimiter = new GitHubRateLimiter()
    }

    private createPipelineContext(saveLocalStoreCallback: (path: string, localStore: any) => Promise<void>): PipelineContext {
        return {
            fit: this.fit,
            saveLocalStoreCallback,
            syncNotice: null as any, // Not used in push operations
            rateLimiter: this.rateLimiter
        }
    }

    async pushChangedFilesToRemote(
        localUpdate: LocalUpdate,
        saveLocalStoreCallback: (path: string, localStore: any) => Promise<void>
    ): Promise<{pushedChanges: LocalChange[], lastFetchedRemoteSha: Record<string, string>, lastFetchedCommitSha: string}|null> {
        const context = this.createPipelineContext(saveLocalStoreCallback)

        try {
            if (localUpdate.localChanges.length === 0) {
                return null
            }

            // Stage 1: Get all file paths
            const filePaths = await getAllFilePaths(undefined, context)

            // Stage 2: Calculate file hashes in parallel
            const fileHashes = await Promise.all(
                filePaths.map(path => calculateFileHash(path, context))
            )

            // Stage 3: Get current remote tree SHA
            const { remoteCommitSha } = await this.fit.remoteUpdated()
            const remoteHashes = await this.fit.getRemoteTreeSha(remoteCommitSha)

            // Stage 4: Detect changes
            const fileChanges = await detectChanges({ localHashes: fileHashes, remoteHashes }, context)

            // Stage 5: Filter only local changes
            const localOnlyChanges = fileChanges.filter(fc => fc.localStatus && !fc.remoteStatus)

            if (localOnlyChanges.length === 0) {
                return null
            }

            // Stage 6: Sync local changes to remote in parallel
            const syncResults = await Promise.all(
                localOnlyChanges.map(fc => syncLocalToRemote(fc, context))
            )

            // Stage 7: Update local store
            await updateLocalStore(syncResults, context)

            // Get updated remote information
            const updatedRefSha = await this.fit.updateRef(remoteCommitSha)
            const updatedRemoteTreeSha = await this.fit.getRemoteTreeSha(updatedRefSha)

            // Return successful remote operations
            const pushedChanges = syncResults
                .filter(r => r.success && r.remoteOp)
                .map(r => r.remoteOp) as LocalChange[]

            return {
                pushedChanges,
                lastFetchedRemoteSha: updatedRemoteTreeSha,
                lastFetchedCommitSha: updatedRefSha
            }
        } catch (error) {
            console.error("Push operation failed:", error)
            throw error
        }
    }

    async createCommitFromLocalUpdate(localUpdate: LocalUpdate): Promise<{createdCommitSha: string, pushedChanges: LocalChange[]} | null> {
        const context = this.createPipelineContext(async () => {})

        try {
            const { localChanges, parentCommitSha } = localUpdate

            if (localChanges.length === 0) {
                return null
            }

            // Get remote tree
            const remoteTree = await this.fit.getTree(parentCommitSha)

            // Create tree nodes from local changes
            const treeNodes = await Promise.all(
                localChanges.map(async (change) => {
                    return await this.fit.createTreeNodeFromFile(change, remoteTree)
                })
            )

            const validTreeNodes = treeNodes.filter(Boolean) as any[]

            if (validTreeNodes.length === 0) {
                return null
            }

            // Create tree
            const latestRemoteCommitTreeSha = await this.fit.getCommitTreeSha(parentCommitSha)
            const createdTreeSha = await this.fit.createTree(validTreeNodes, latestRemoteCommitTreeSha)

            // Create commit
            const createdCommitSha = await this.fit.createCommit(createdTreeSha, parentCommitSha)

            return {
                createdCommitSha,
                pushedChanges: localChanges
            }
        } catch (error) {
            console.error("Failed to create commit from local update:", error)
            throw error
        }
    }
}
