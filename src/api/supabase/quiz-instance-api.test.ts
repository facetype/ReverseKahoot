import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabaseMock } from '@/test/supabase-mock.ts'
import {
    createQuizInstance,
    ensureSession,
    getQuizInstance,
    joinQuizInstance,
    startQuizInstance,
} from './quiz-instance-api.ts'

vi.mock('./client.ts', async () => {
    const { supabaseMock } = await import('@/test/supabase-mock.ts')
    return { supabase: supabaseMock.client, supabaseConfigured: true }
})

// What supabase-js hands back for a non-2xx edge function response: the body
// is only reachable through error.context.
function functionError(status: number, body: unknown) {
    return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(JSON.stringify(body), { status }),
    })
}

beforeEach(() => supabaseMock.reset())

describe('ensureSession', () => {
    it('reuses the existing session', async () => {
        supabaseMock.signedInAs('host-1')

        expect(await ensureSession()).toBe('host-1')
        expect(supabaseMock.auth.signInAnonymously).not.toHaveBeenCalled()
    })

    it('signs guests in anonymously', async () => {
        supabaseMock.signedOut()
        supabaseMock.auth.signInAnonymously.mockResolvedValue({ data: { user: { id: 'guest-1' } }, error: null })

        expect(await ensureSession()).toBe('guest-1')
    })

    it('explains when guest sign-in is switched off', async () => {
        supabaseMock.signedOut()
        supabaseMock.auth.signInAnonymously.mockResolvedValue({
            data: { user: null },
            error: { message: 'Anonymous sign-ins are disabled' },
        })

        await expect(ensureSession()).rejects.toThrow('Guest join is disabled; sign in to join a game.')
    })
})

describe('createQuizInstance', () => {
    it('creates a lobby and normalises the response', async () => {
        supabaseMock.signedInAs('host-1')
        supabaseMock.functions.invoke.mockResolvedValue({
            data: { id: 'inst-1', quizId: 7, hostId: 'host-1', joinCode: 'ABC234', isStarted: null, attendingPlayers: null },
            error: null,
        })

        expect(await createQuizInstance(7)).toEqual({
            instanceId: 'inst-1',
            quizId: 7,
            hostId: 'host-1',
            joinCode: 'ABC234',
            isStarted: false,
            attendingPlayers: [],
            players: [],
            game: {
                phase: 'lobby',
                questionStartedAt: null,
                currentQuestion: null,
                lastReveal: null,
            },
            quizTitle: null,
            betCount: 0,
            channel: 'quiz-instance:inst-1',
        })
        expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('CreateQuizInstance', { body: { quizId: 7 } })
    })

    it('rejects a response without an instance id', async () => {
        supabaseMock.signedInAs('host-1')
        supabaseMock.functions.invoke.mockResolvedValue({ data: { joinCode: 'ABC234' }, error: null })

        await expect(createQuizInstance(7)).rejects.toThrow(/missing an id/)
    })
})

describe('joinQuizInstance', () => {
    it('joins as a guest and returns the lobby', async () => {
        supabaseMock.signedOut()
        supabaseMock.auth.signInAnonymously.mockResolvedValue({ data: { user: { id: 'guest-1' } }, error: null })
        supabaseMock.functions.invoke.mockResolvedValue({
            data: {
                instanceId: 'inst-1',
                joinCode: 'ABC234',
                attendingPlayers: ['guest-1'],
                players: [{ userId: 'guest-1', nickname: 'Ada', points: 0, wager: 0, pointsWon: 0 }],
                phase: 'lobby',
                channel: 'quiz-instance:inst-1',
                alreadyJoined: true,
            },
            error: null,
        })

        const result = await joinQuizInstance('ABC234', 'Ada')

        expect(result.instanceId).toBe('inst-1')
        expect(result.attendingPlayers).toEqual(['guest-1'])
        expect(result.players[0].nickname).toBe('Ada')
        expect(result.alreadyJoined).toBe(true)
        expect(supabaseMock.auth.signInAnonymously).toHaveBeenCalledOnce()
        expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('JoinQuizInstance', { body: { joinCode: 'ABC234', nickname: 'Ada' } })
    })

    it('defaults alreadyJoined to false', async () => {
        supabaseMock.signedInAs('player-1')
        supabaseMock.functions.invoke.mockResolvedValue({ data: { instanceId: 'inst-1' }, error: null })

        expect((await joinQuizInstance('ABC234', 'Player')).alreadyJoined).toBe(false)
    })

    it('surfaces the error message from the edge function body', async () => {
        supabaseMock.signedInAs('player-1')
        supabaseMock.functions.invoke.mockResolvedValue({
            data: null,
            error: functionError(404, { error: 'No game with that code.' }),
        })

        await expect(joinQuizInstance('NOPE22', 'Player')).rejects.toThrow('No game with that code.')
    })

    it('falls back to the generic message when the body has no error text', async () => {
        supabaseMock.signedInAs('player-1')
        supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request') })

        await expect(joinQuizInstance('ABC234', 'Player')).rejects.toThrow('Failed to send a request')
    })

    it('does not call the edge function when no session can be started', async () => {
        supabaseMock.signedOut()
        supabaseMock.auth.signInAnonymously.mockResolvedValue({ data: { user: null }, error: { message: 'network down' } })

        await expect(joinQuizInstance('ABC234', 'Player')).rejects.toThrow('network down')
        expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
    })
})

describe('startQuizInstance', () => {
    it('starts the game for the given instance', async () => {
        supabaseMock.signedInAs('host-1')
        supabaseMock.functions.invoke.mockResolvedValue({
            data: { id: 'inst-1', isStarted: true, attendingPlayers: ['p1', 'p2'] },
            error: null,
        })

        const result = await startQuizInstance('inst-1')

        expect(result.isStarted).toBe(true)
        expect(result.attendingPlayers).toEqual(['p1', 'p2'])
        expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('StartQuizInstance', { body: { instanceId: 'inst-1' } })
    })

    it('surfaces a refusal, such as a non-host trying to start', async () => {
        supabaseMock.signedInAs('player-1')
        supabaseMock.functions.invoke.mockResolvedValue({
            data: null,
            error: functionError(403, { error: 'Only the host can start the game.' }),
        })

        await expect(startQuizInstance('inst-1')).rejects.toThrow('Only the host can start the game.')
    })
})

describe('getQuizInstance', () => {
    it('reads the lobby row by id', async () => {
        supabaseMock.queueResult({
            data: { id: 'inst-1', quizId: 7, hostId: 'host-1', joinCode: 'ABC234', isStarted: true, attendingPlayers: ['p1'] },
        })

        expect(await getQuizInstance('inst-1')).toEqual({
            instanceId: 'inst-1',
            quizId: 7,
            hostId: 'host-1',
            joinCode: 'ABC234',
            isStarted: true,
            attendingPlayers: ['p1'],
            players: [],
            game: {
                phase: 'lobby',
                questionStartedAt: null,
                currentQuestion: null,
                lastReveal: null,
            },
            quizTitle: null,
            betCount: 0,
            channel: 'quiz-instance:inst-1',
        })
        const [query] = supabaseMock.queriesOn('QuizInstance')
        expect(supabaseMock.args(query, 'eq')).toEqual(['id', 'inst-1'])
    })

    it('reports a missing or unreadable game', async () => {
        supabaseMock.queueResult({ data: null })
        await expect(getQuizInstance('gone')).rejects.toThrow('This game could not be found.')
    })
})
