import type { User } from '@supabase/supabase-js'
import { supabase } from '../utils/supabase/supabase.ts'
import type { Profile } from './types'

export const USERNAME_MIN = 3
export const USERNAME_MAX = 24
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/

// Returns an error message, or null when the username is acceptable.
export function validateUserName(userName: string): string | null {
    const value = userName.trim()
    if (value.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`
    if (value.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters.`
    if (!USERNAME_PATTERN.test(value)) return 'Username can only contain letters, numbers and underscores.'
    return null
}

// Case-insensitive check against public.Profile. Returns false when the table
// is not readable (RLS), so it never blocks sign-up on its own; the unique
// index in the database is the real guard.
export async function isUserNameTaken(userName: string): Promise<boolean> {
    if (!supabase) return false
    const { data, error } = await supabase
        .from('Profile')
        .select('userId')
        .ilike('userName', userName.trim())
        .limit(1)
    if (error) return false
    return (data?.length ?? 0) > 0
}

export async function getProfile(userId: string): Promise<Profile | null> {
    if (!supabase) return null
    const { data, error } = await supabase
        .from('Profile')
        .select('userId, userName')
        .eq('userId', userId)
        .maybeSingle()
    if (error) throw error
    return data
}

// Makes sure the signed-in user has a row in public.Profile.
// The database trigger (see supabase/migrations) normally creates it at
// sign-up; this is the client-side fallback that reads the username the user
// chose from auth metadata and inserts it if the row is missing.
export async function ensureProfile(user: User): Promise<Profile | null> {
    if (!supabase) return null
    const existing = await getProfile(user.id)
    if (existing) return existing

    const userName = typeof user.user_metadata?.userName === 'string'
        ? user.user_metadata.userName.trim()
        : ''
    if (!userName) return null

    const { data, error } = await supabase
        .from('Profile')
        .upsert({ userId: user.id, userName }, { onConflict: 'userId', ignoreDuplicates: true })
        .select('userId, userName')
        .maybeSingle()
    if (error) throw error
    return data ?? { userId: user.id, userName }
}
