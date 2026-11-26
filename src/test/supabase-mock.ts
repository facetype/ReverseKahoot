import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// A stand-in for the Supabase client used by the API tests. Table queries are
// recorded (table + every chained call) and resolve with the next queued
// result, in the order the code under test awaits them.
//
// Usage in a test file:
//
//   vi.mock('./client.ts', async () => {
//       const { supabaseMock } = await import('@/test/supabase-mock.ts')
//       return { supabase: supabaseMock.client, supabaseConfigured: true }
//   })

export interface QueryResult {
    data?: unknown
    error?: unknown
}

export interface RecordedQuery {
    table: string
    // Each chained call as [method, ...args], e.g. ['eq', 'quizId', 7].
    calls: unknown[][]
}

const queue: QueryResult[] = []
const queries: RecordedQuery[] = []

function queryBuilder(table: string, initialCall?: unknown[]) {
    const query: RecordedQuery = { table, calls: [] }
    if (initialCall) query.calls.push(initialCall)
    queries.push(query)
    const builder: object = new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') {
                return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
                    const next = queue.shift()
                    const settled = next
                        ? Promise.resolve({ data: next.data ?? null, error: next.error ?? null })
                        : Promise.reject(new Error(`Unexpected query on "${table}": no result queued.`))
                    return settled.then(resolve, reject)
                }
            }
            return (...args: unknown[]) => {
                query.calls.push([String(prop), ...args])
                return builder
            }
        },
    })
    return builder
}

function from(table: string) {
    return queryBuilder(table)
}

function rpc(name: string, args: Record<string, unknown>) {
    return queryBuilder('rpc', ['rpc', name, args])
}

const auth = {
    getUser: vi.fn(),
    getSession: vi.fn(),
    signInAnonymously: vi.fn(),
}

const functions = {
    invoke: vi.fn(),
}

export const supabaseMock = {
    client: { from, rpc, auth, functions } as unknown as SupabaseClient,
    auth,
    functions,
    queries,

    // Queues the result of the next awaited table query.
    queueResult(result: QueryResult = {}) {
        queue.push(result)
    },

    // Recorded queries against one table, in the order they were started.
    queriesOn(table: string): RecordedQuery[] {
        return queries.filter(q => q.table === table)
    },

    // Arguments of the first call to `method` in a recorded query.
    args(query: RecordedQuery, method: string): unknown[] | undefined {
        return query.calls.find(call => call[0] === method)?.slice(1)
    },

    // Number of queued results the code under test never consumed.
    pendingResults(): number {
        return queue.length
    },

    reset() {
        queue.length = 0
        queries.length = 0
        auth.getUser.mockReset()
        auth.getSession.mockReset()
        auth.signInAnonymously.mockReset()
        functions.invoke.mockReset()
    },

    signedInAs(userId: string) {
        auth.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null })
    },

    signedOut() {
        auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
        auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    },
}
