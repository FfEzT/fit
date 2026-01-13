export class RateLimiter {
    private maxConcurrent: number
    private currentRunning: number = 0
    private queue: Array<() => void> = []
    private delayMs: number
    private requestCount: number = 0
    private windowStart: number = Date.now()
    private maxRequestsPerWindow: number
    private windowMs: number

    constructor(
        maxConcurrent: number = 5,
        delayMs: number = 100,
        maxRequestsPerWindow: number = 100,
        windowMs: number = 60000 // 1 minute
    ) {
        this.maxConcurrent = maxConcurrent
        this.delayMs = delayMs
        this.maxRequestsPerWindow = maxRequestsPerWindow
        this.windowMs = windowMs
    }

    private resetWindowIfNeeded(): void {
        const now = Date.now()
        if (now - this.windowStart > this.windowMs) {
            this.requestCount = 0
            this.windowStart = now
        }
    }

    private async waitForWindow(): Promise<void> {
        this.resetWindowIfNeeded()

        if (this.requestCount >= this.maxRequestsPerWindow) {
            const timeToWait = this.windowMs - (Date.now() - this.windowStart)
            if (timeToWait > 0) {
                await new Promise(resolve => setTimeout(resolve, timeToWait))
                this.resetWindowIfNeeded()
            }
        }
    }

    async waitForSlot(): Promise<void> {
        await this.waitForWindow()

        return new Promise<void>((resolve) => {
            if (this.currentRunning < this.maxConcurrent) {
                this.currentRunning++
                this.requestCount++
                resolve()
            } else {
                this.queue.push(() => {
                    this.currentRunning++
                    this.requestCount++
                    resolve()
                })
            }
        })
    }

    releaseSlot(): void {
        this.currentRunning--
        if (this.queue.length > 0) {
            const next = this.queue.shift()!
            setTimeout(next, this.delayMs)
        }
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        await this.waitForSlot()
        try {
            return await fn()
        } finally {
            this.releaseSlot()
        }
    }

    getStats(): { currentRunning: number, queueLength: number, requestCount: number, windowTimeLeft: number } {
        this.resetWindowIfNeeded()
        return {
            currentRunning: this.currentRunning,
            queueLength: this.queue.length,
            requestCount: this.requestCount,
            windowTimeLeft: this.windowMs - (Date.now() - this.windowStart)
        }
    }
}

// GitHub API has specific rate limits
export class GitHubRateLimiter extends RateLimiter {
    constructor() {
        // GitHub API allows up to 5000 requests per hour for authenticated requests
        // We'll use a conservative limit of 10 requests per second with a 100ms delay
        // And 1000 requests per hour (with some buffer)
        super(10, 100, 1000, 3600000) // 1 hour window
    }
}
