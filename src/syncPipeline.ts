import { Fit } from "./fit"
import { LocalChange, LocalFileStatus, RemoteChange, RemoteChangeType, ClashStatus, FileOpRecord } from "./fitTypes"
import { LocalStores } from "main"
import FitNotice from "./fitNotice"

// Types for the pipeline stages
export type FileWithHash = {
    path: string
    hash: string
    exists: boolean
}

export type FileChange = {
    path: string
    localStatus?: LocalFileStatus
    remoteStatus?: RemoteChangeType
    localHash?: string
    remoteHash?: string
    needsSync: boolean
    hasConflict: boolean
}

export type SyncResult = {
    path: string
    success: boolean
    operation?: "created" | "changed" | "deleted" | "conflict"
    localOp?: FileOpRecord
    remoteOp?: LocalChange
    error?: string
}

export type PipelineContext = {
    fit: Fit
    saveLocalStoreCallback: (path: string, localStore: Partial<LocalStores>) => Promise<void>
    syncNotice: FitNotice
    rateLimiter?: RateLimiter
}

export type RateLimiter = {
    waitForSlot: () => Promise<void>
    releaseSlot: () => void
}

// Pipeline stage function type
export type PipelineStage<T, R> = (input: T, context: PipelineContext) => Promise<R>

// Pipeline composition function
export function composePipeline<T, R>(stages: PipelineStage<any, any>[]): PipelineStage<T, R> {
    return async (input: T, context: PipelineContext): Promise<R> => {
        let result: any = input
        for (const stage of stages) {
            result = await stage(result, context)
        }
        return result as R
    }
}

// Parallel pipeline stage function
export function parallelStage<T, R>(
    stage: PipelineStage<T, R>,
    concurrency: number = 5
): PipelineStage<T[], R[]> {
    return async (input: T[], context: PipelineContext): Promise<R[]> => {
        const results: R[] = []
        const executing: Promise<void>[] = []

        for (const item of input) {
            const promise = stage(item, context).then(result => {
                results.push(result)
            })

            executing.push(promise)

            if (executing.length >= concurrency) {
                await Promise.race(executing)
                // Remove completed promises
                const completedIndex = executing.findIndex(p =>
                    results.length > executing.indexOf(p)
                )
                if (completedIndex !== -1) {
                    executing.splice(completedIndex, 1)
                }
            }
        }

        await Promise.all(executing)
        return results
    }
}

// Batch processing with rate limiting
export function batchWithRateLimit<T, R>(
    stage: PipelineStage<T, R>,
    batchSize: number = 10,
    delayMs: number = 100
): PipelineStage<T[], R[]> {
    return async (input: T[], context: PipelineContext): Promise<R[]> => {
        const results: R[] = []

        for (let i = 0; i < input.length; i += batchSize) {
            const batch = input.slice(i, i + batchSize)

            if (context.rateLimiter) {
                await context.rateLimiter.waitForSlot()
            }

            const batchResults = await Promise.all(
                batch.map(item => stage(item, context))
            )

            results.push(...batchResults)

            if (context.rateLimiter) {
                context.rateLimiter.releaseSlot()
            }

            // Add delay between batches if not the last batch
            if (i + batchSize < input.length && delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs))
            }
        }

        return results
    }
}

// Filter function for pipeline
export function filter<T>(predicate: (item: T) => boolean): PipelineStage<T[], T[]> {
    return async (input: T[], context: PipelineContext): Promise<T[]> => {
        return input.filter(predicate)
    }
}

// Map function for pipeline
export function map<T, R>(mapper: (item: T) => R): PipelineStage<T[], R[]> {
    return async (input: T[], context: PipelineContext): Promise<R[]> => {
        return input.map(mapper)
    }
}

// Reduce function for pipeline
export function reduce<T, R>(
    reducer: (acc: R, item: T) => R,
    initialValue: R
): PipelineStage<T[], R> {
    return async (input: T[], context: PipelineContext): Promise<R> => {
        return input.reduce(reducer, initialValue)
    }
}

// Fork function for parallel processing
export function fork<T>(...stages: PipelineStage<T, any>[]): PipelineStage<T, any[]> {
    return async (input: T, context: PipelineContext): Promise<any[]> => {
        return Promise.all(stages.map(stage => stage(input, context)))
    }
}

// Join function for merging results
export function join<T>(joiner: (...results: any[]) => T): PipelineStage<any[], T> {
    return async (input: any[], context: PipelineContext): Promise<T> => {
        return joiner(...input)
    }
}
