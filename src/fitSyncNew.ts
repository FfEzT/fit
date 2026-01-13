import { Fit } from "./fit"
import { ClashStatus, FileOpRecord } from "./fitTypes"
import { VaultOperations } from "./vaultOps"
import { LocalStores } from "main"
import FitNotice from "./fitNotice"
import { conflictResolutionFolder } from "./const"
import { PipelineContext } from "./syncPipeline"
import {
    getAllFilePaths,
    calculateFileHash,
    getRemoteTreeSha,
    detectChanges,
    resolveConflict,
    syncLocalToRemote,
    syncRemoteToLocal,
    updateLocalStore
} from "./syncStages"
import { GitHubRateLimiter } from "./rateLimiter"

export interface IFitSyncNew {
    fit: Fit
}

export class FitSyncNew implements IFitSyncNew {
    fit: Fit
    vaultOps: VaultOperations
    saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>
    rateLimiter: GitHubRateLimiter

    constructor(
        fit: Fit,
        vaultOps: VaultOperations,
        saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>
    ) {
        this.fit = fit
        this.vaultOps = vaultOps
        this.saveLocalStoreCallback = saveLocalStoreCallback
        this.rateLimiter = new GitHubRateLimiter()
    }

    private async unresolvedChangesConflicts(): Promise<boolean> {
        return await this.vaultOps.vault.adapter.exists(conflictResolutionFolder)
    }

    private createPipelineContext(syncNotice: FitNotice): PipelineContext {
        return {
            fit: this.fit,
            saveLocalStoreCallback: this.saveLocalStoreCallback,
            syncNotice,
            rateLimiter: this.rateLimiter
        }
    }

    async sync(syncNotice: FitNotice):
        Promise<{
            ops: Array<{heading: string, ops: FileOpRecord[]}>,
            clash: ClashStatus[],
        } | void>
    {
        syncNotice.setMessage("Performing pre sync checks.")

        if (await this.unresolvedChangesConflicts()) {
            syncNotice.setMessage(`There are unresolved files: pls, resolve files in: ${conflictResolutionFolder}.`)
            return
        }

        const context = this.createPipelineContext(syncNotice)

        try {
            syncNotice.setMessage("Getting file list...")

            // Stage 1: Get all file paths
            const filePaths = await getAllFilePaths(undefined, context)

            if (filePaths.length === 0) {
                syncNotice.setMessage("No files to sync")
                return
            }

            syncNotice.setMessage(`Calculating hashes for ${filePaths.length} files...`)

            // Stage 2: Calculate file hashes in parallel
            const fileHashes = await Promise.all(
                filePaths.map(path => calculateFileHash(path, context))
            )

            syncNotice.setMessage("Getting remote changes...")

            // Stage 3: Get remote tree SHA (can run in parallel with hash calculation)
            const remoteHashes = await getRemoteTreeSha(undefined, context)

            syncNotice.setMessage("Detecting changes...")

            // Stage 4: Detect changes
            const fileChanges = await detectChanges({ localHashes: fileHashes, remoteHashes }, context)

            // Stage 5: Filter files that need synchronization
            const filesToSync = fileChanges.filter(fc => fc.needsSync)

            if (filesToSync.length === 0) {
                syncNotice.setMessage("Sync successful - no changes needed")
                return
            }

            syncNotice.setMessage(`Syncing ${filesToSync.length} files...`)

            // Stage 6: Separate conflicts and non-conflicts
            const conflicts = filesToSync.filter(fc => fc.hasConflict)
            const nonConflicts = filesToSync.filter(fc => !fc.hasConflict)

            const results: any[] = []

            // Stage 7: Process conflicts in parallel
            if (conflicts.length > 0) {
                syncNotice.setMessage(`Resolving ${conflicts.length} conflicts...`)
                const conflictResults = await Promise.all(
                    conflicts.map(fc => resolveConflict(fc, context))
                )
                results.push(...conflictResults)
            }

            // Stage 8: Process non-conflicts in parallel
            if (nonConflicts.length > 0) {
                syncNotice.setMessage(`Syncing ${nonConflicts.length} non-conflict files...`)

                // Sync local changes to remote
                const localChanges = nonConflicts.filter(fc => fc.localStatus)
                if (localChanges.length > 0) {
                    const localToRemoteResults = await Promise.all(
                        localChanges.map(fc => syncLocalToRemote(fc, context))
                    )
                    results.push(...localToRemoteResults)
                }

                // Sync remote changes to local
                const remoteChanges = nonConflicts.filter(fc => fc.remoteStatus)
                if (remoteChanges.length > 0) {
                    const remoteToLocalResults = await Promise.all(
                        remoteChanges.map(fc => syncRemoteToLocal(fc, context))
                    )
                    results.push(...remoteToLocalResults)
                }
            }

            // Stage 9: Update local store
            await updateLocalStore(results, context)

            // Prepare results for return
            const successfulOps = results.filter(r => r.success)
            const failedOps = results.filter(r => !r.success)

            const localOps = successfulOps
                .filter(r => r.localOp)
                .map(r => r.localOp) as FileOpRecord[]

            const remoteOps = successfulOps
                .filter(r => r.remoteOp)
                .map(r => r.remoteOp)

            const clashStatuses = conflicts.map(fc => ({
                path: fc.path,
                localStatus: fc.localStatus!,
                remoteStatus: fc.remoteStatus!
            }))

            if (failedOps.length > 0) {
                syncNotice.setMessage(`Sync completed with ${failedOps.length} errors`)
            } else {
                syncNotice.setMessage("Sync successful")
            }

            return {
                ops: [
                    {heading: "Local file updates:", ops: localOps},
                    {heading: "Remote file updates:", ops: remoteOps},
                ],
                clash: clashStatuses,
            }
        } catch (error) {
            syncNotice.setMessage(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
            throw error
        }
    }
}
