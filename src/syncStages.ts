import { arrayBufferToBase64 } from "obsidian"
import { Fit } from "./fit"
import { LocalChange, LocalFileStatus, RemoteChange, RemoteChangeType, ClashStatus, FileOpRecord } from "./fitTypes"
import { RECOGNIZED_TXT_EXT, extractExtension, removeLineEndingsFromBase64String, compareSha } from "./utils"
import { conflictResolutionFolder } from "./const"
import { PipelineContext, FileWithHash, FileChange, SyncResult, PipelineStage } from "./syncPipeline"
import { GitHubRateLimiter } from "./rateLimiter"

// Stage 1: Get all file paths
export const getAllFilePaths: PipelineStage<void, string[]> = async (_, context): Promise<string[]> => {
    const { fit } = context
    const allPaths = await fit.vaultOps.getFilesInVault()
    const paths = []

    for (let path of allPaths) {
        let isExcluded = path.startsWith("_fit/")
            || !path.startsWith(fit.syncPath)
            || fit.excludes.includes(path)
            || fit.excludes.some(
                exclude => path.startsWith(exclude)
                    && !fit.syncPath.startsWith(exclude)
            )

        const result = path.replace(fit.syncPath, "")

        if (!isExcluded)
            paths.push(result)
    }

    return paths
}

// Stage 2: Calculate file hashes in parallel
export const calculateFileHash: PipelineStage<string, FileWithHash> = async (path, context): Promise<FileWithHash> => {
    const { fit } = context
    const fullPath = fit.syncPath + path

    try {
        const exists = await fit.vaultOps.vault.adapter.exists(fullPath)

        if (!exists) {
            return { path, hash: "", exists: false }
        }

        let content: string

        const file = await fit.vaultOps.getTFile(fullPath)
        if (file) {
            if (RECOGNIZED_TXT_EXT.includes(file.extension)) {
                content = await fit.vaultOps.vault.read(file)
            } else {
                content = arrayBufferToBase64(await fit.vaultOps.vault.readBinary(file))
            }
        } else {
            const extension = extractExtension(path)
            if (!extension || !RECOGNIZED_TXT_EXT.includes(extension)) {
                content = arrayBufferToBase64(
                    await fit.vaultOps.vault.adapter.readBinary(fullPath)
                )
            } else {
                content = await fit.vaultOps.vault.adapter.read(fullPath)
            }
        }

        const hash = await fit.fileSha1(path + content)
        return { path, hash, exists: true }
    } catch (error) {
        console.error(`Error calculating hash for ${path}:`, error)
        return { path, hash: "", exists: false }
    }
}

// Stage 3: Get remote tree SHA
export const getRemoteTreeSha: PipelineStage<void, Record<string, string>> = async (_, context): Promise<Record<string, string>> => {
    const { fit } = context
    const { remoteCommitSha } = await fit.remoteUpdated()
    return await fit.getRemoteTreeSha(remoteCommitSha)
}

// Stage 4: Detect changes
export const detectChanges: PipelineStage<{ localHashes: FileWithHash[], remoteHashes: Record<string, string> }, FileChange[]> =
    async ({ localHashes, remoteHashes }, context): Promise<FileChange[]> => {
        const { fit } = context

        // Convert local hashes to record format
        const localHashRecord: Record<string, string> = {}
        localHashes.forEach(file => {
            if (file.exists) {
                localHashRecord[file.path] = file.hash
            }
        })

        // Get local changes
        const localChanges = compareSha(localHashRecord, fit.localSha, "local")

        // Get remote changes
        const remoteChanges = compareSha(remoteHashes, fit.lastFetchedRemoteSha, "remote")

        // Create file change objects
        const fileChanges: FileChange[] = []

        // Process local changes
        localChanges.forEach(change => {
            fileChanges.push({
                path: change.path,
                localStatus: change.status,
                localHash: localHashRecord[change.path],
                needsSync: true,
                hasConflict: false
            })
        })

        // Process remote changes
        remoteChanges.forEach(change => {
            const existingChange = fileChanges.find(fc => fc.path === change.path)

            if (existingChange) {
                existingChange.remoteStatus = change.status
                existingChange.remoteHash = change.currentSha
                existingChange.hasConflict = true
            } else {
                fileChanges.push({
                    path: change.path,
                    remoteStatus: change.status,
                    remoteHash: change.currentSha,
                    needsSync: true,
                    hasConflict: false
                })
            }
        })

        return fileChanges
    }

// Stage 5: Resolve conflicts
export const resolveConflict: PipelineStage<FileChange, SyncResult> = async (fileChange, context): Promise<SyncResult> => {
    const { fit } = context
    const { path, localStatus, remoteStatus } = fileChange

    try {
        // If no conflict, just return success
        if (!fileChange.hasConflict) {
            return {
                path,
                success: true,
                operation: fileChange.localStatus ? fileChange.localStatus : "changed"
            }
        }

        // Handle different conflict scenarios
        if (localStatus === "deleted" && remoteStatus === "REMOVED") {
            return {
                path,
                success: true,
                operation: "deleted"
            }
        }

        if (localStatus === "deleted") {
            // Remote was modified, local was deleted
            const remoteContent = await fit.getBlob(fileChange.remoteHash!)
            const conflictPath = fit.syncPath + path
            const conflictResolutionPath = conflictResolutionFolder + conflictPath

            await fit.vaultOps.writeToLocal(conflictPath, remoteContent)

            return {
                path,
                success: true,
                operation: "conflict",
                localOp: { path: conflictPath, status: "created" }
            }
        }

        if (remoteStatus === "REMOVED") {
            // Local was modified, remote was deleted
            const conflictPath = fit.syncPath + path
            const conflictResolutionPath = conflictResolutionFolder + conflictPath

            const localFileContent = arrayBufferToBase64(
                await fit.vaultOps.vault.adapter.readBinary(conflictPath)
            )

            await fit.vaultOps.writeToLocal(conflictResolutionPath, localFileContent)
            await fit.vaultOps.deleteFromLocal(conflictPath)

            return {
                path,
                success: true,
                operation: "conflict",
                localOp: { path: conflictResolutionPath, status: "created" }
            }
        }

        // Both local and remote were modified
        const conflictPath = fit.syncPath + path
        const conflictResolutionPath = conflictResolutionFolder + conflictPath

        const localFileContent = arrayBufferToBase64(
            await fit.vaultOps.vault.adapter.readBinary(conflictPath)
        )

        const remoteContent = await fit.getBlob(fileChange.remoteHash!)

        // Check if contents are actually the same
        if (removeLineEndingsFromBase64String(remoteContent) === removeLineEndingsFromBase64String(localFileContent)) {
            return {
                path,
                success: true,
                operation: "changed"
            }
        }

        // Different contents - create conflict
        await Promise.all([
            fit.vaultOps.writeToLocal(conflictPath, remoteContent),
            fit.vaultOps.writeToLocal(conflictResolutionPath, localFileContent),
        ])

        return {
            path,
            success: true,
            operation: "conflict",
            localOp: { path: conflictResolutionPath, status: "created" }
        }
    } catch (error) {
        return {
            path,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

// Stage 6: Sync local changes to remote
export const syncLocalToRemote: PipelineStage<FileChange, SyncResult> = async (fileChange, context): Promise<SyncResult> => {
    const { fit, rateLimiter } = context
    const { path, localStatus } = fileChange

    if (!localStatus) {
        return {
            path,
            success: true,
            operation: "changed"
        }
    }

    try {
        if (rateLimiter) {
            await rateLimiter.waitForSlot()
        }

        let result: SyncResult = {
            path,
            success: true
        }

        if (localStatus === "deleted") {
            result.operation = "deleted"
            result.remoteOp = { path, status: "deleted" }
        } else {
            result.operation = localStatus
            result.remoteOp = { path, status: localStatus }
        }

        if (rateLimiter) {
            rateLimiter.releaseSlot()
        }

        return result
    } catch (error) {
        if (rateLimiter) {
            rateLimiter.releaseSlot()
        }

        return {
            path,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

// Stage 7: Sync remote changes to local
export const syncRemoteToLocal: PipelineStage<FileChange, SyncResult> = async (fileChange, context): Promise<SyncResult> => {
    const { fit } = context
    const { path, remoteStatus, remoteHash } = fileChange

    if (!remoteStatus) {
        return {
            path,
            success: true,
            operation: "changed"
        }
    }

    try {
        let result: SyncResult = {
            path,
            success: true
        }

        if (remoteStatus === "REMOVED") {
            const fullPath = fit.syncPath + path
            await fit.vaultOps.deleteFromLocal(fullPath)
            result.operation = "deleted"
            result.localOp = { path: fullPath, status: "deleted" }
        } else {
            const content = await fit.getBlob(remoteHash!)
            const fullPath = fit.syncPath + path
            const fileOp = await fit.vaultOps.writeToLocal(fullPath, content)
            result.operation = fileOp.status
            result.localOp = fileOp
        }

        return result
    } catch (error) {
        return {
            path,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

// Stage 8: Update local store
export const updateLocalStore: PipelineStage<SyncResult[], void> = async (syncResults, context): Promise<void> => {
    const { fit, saveLocalStoreCallback } = context

    // Calculate new local SHA
    const newLocalSha = await fit.computeLocalSha()

    // Get latest remote SHA
    const { remoteCommitSha } = await fit.remoteUpdated()
    const newRemoteSha = await fit.getRemoteTreeSha(remoteCommitSha)

    // Update local store
    await saveLocalStoreCallback(fit.syncPath, {
        localSha: newLocalSha,
        lastFetchedRemoteSha: newRemoteSha,
        lastFetchedCommitSha: remoteCommitSha
    })
}
