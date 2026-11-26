import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { supabaseMock } from '@/test/supabase-mock.ts'
import { USERNAME_MAX, ensureProfile, isUserNameTaken, validateUserName } from './profile-api.ts'

vi.mock('./client.ts', async () => {
    const { supabaseMock } = await import('@/test/supabase-mock.ts')
    return { supabase: supabaseMock.client, supabaseConfigured: true }
})

function user(id: string, metadata: Record<string, unknown> = {}): User {
    return { id, user_metadata: metadata } as unknown as User
}

beforeEach(() => supabaseMock.reset())

describe('validateUserName', () => {
    it('accepts letters, numbers and underscores', () => {
        expect(validateUserName('quiz_master_42')).toBeNull()
    })

    it('rejects names that are too short, ignoring surrounding whitespace', () => {
        expect(validateUserName('ab')).toMatch(/at least 3/)
        expect(validateUserName('  ab   ')).toMatch(/at least 3/)
    })

    it('rejects names that are too long', () => {
        expect(validateUserName('a'.repeat(USERNAME_MAX))).toBeNull()
        expect(validateUserName('a'.repeat(USERNAME_MAX + 1))).toMatch(/at most 24/)
    })

    it('rejects spaces and special characters', () => {
        for (const name of ['two words', 'name!', 'navn-med-strek', 'bruker@mail']) {
            expect(validateUserName(name)).toMatch(/letters, numbers and underscores/)
        }
    })
})

describe('isUserNameTaken', () => {
    it('is true when a profile with that name exists', async () => {
        supabaseMock.queueResult({ data: [{ userId: 'u1' }] })

        expect(await isUserNameTaken('  Taken  ')).toBe(true)

        const [query] = supabaseMock.queriesOn('Profile')
        // Case-insensitive match on the trimmed name.
        expect(supabaseMock.args(query, 'ilike')).toEqual(['userName', 'Taken'])
    })

    it('is false when no profile matches', async () => {
        supabaseMock.queueResult({ data: [] })
        expect(await isUserNameTaken('free_name')).toBe(false)
    })

    it('never blocks sign-up when the lookup fails', async () => {
        supabaseMock.queueResult({ error: { message: 'permission denied' } })
        expect(await isUserNameTaken('whoever')).toBe(false)
    })
})

describe('ensureProfile', () => {
    it('returns the existing profile without writing', async () => {
        const existing = { userId: 'u1', userName: 'ada' }
        supabaseMock.queueResult({ data: existing })

        expect(await ensureProfile(user('u1', { userName: 'ignored' }))).toEqual(existing)
        expect(supabaseMock.queriesOn('Profile')).toHaveLength(1)
    })

    it('creates the missing profile from the sign-up metadata', async () => {
        supabaseMock.queueResult({ data: null })
        supabaseMock.queueResult({ data: { userId: 'u1', userName: 'ada' } })

        expect(await ensureProfile(user('u1', { userName: '  ada ' }))).toEqual({ userId: 'u1', userName: 'ada' })

        const upsert = supabaseMock.queriesOn('Profile')[1]
        expect(supabaseMock.args(upsert, 'upsert')?.[0]).toEqual({ userId: 'u1', userName: 'ada' })
    })

    it('returns null when there is no profile and no username to create one from', async () => {
        supabaseMock.queueResult({ data: null })

        expect(await ensureProfile(user('u1'))).toBeNull()
        expect(supabaseMock.queriesOn('Profile')).toHaveLength(1)
    })
})
