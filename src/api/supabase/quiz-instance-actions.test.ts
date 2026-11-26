import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabaseMock } from '@/test/supabase-mock.ts'
import { advanceGame, buyHint, getPlayerState, placeBet } from './quiz-instance-api.ts'

vi.mock('./client.ts', async () => {
    const { supabaseMock } = await import('@/test/supabase-mock.ts')
    return { supabase: supabaseMock.client, supabaseConfigured: true }
})

beforeEach(() => supabaseMock.reset())

describe('quiz instance game actions', () => {
    it('advances from the phase the host has open', async () => {
        const state = {
            phase: 'question',
            questionStartedAt: '2026-11-26T12:00:00Z',
            currentQuestion: { questionId: 3, index: 1, total: 4, text: 'Clue', options: [], hints: [] },
            lastReveal: null,
        }
        supabaseMock.functions.invoke.mockResolvedValue({ data: state, error: null })

        await expect(advanceGame('inst-1', 'lobby')).resolves.toEqual(state)
        expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('AdvanceQuizInstance', {
            body: { instanceId: 'inst-1', fromPhase: 'lobby' },
        })
    })

    it('places a bet and returns the private player state', async () => {
        const state = { nickname: 'Ada', points: 100, bet: { answerId: 7, wager: 50 }, hints: [] }
        supabaseMock.functions.invoke.mockResolvedValue({ data: state, error: null })

        await expect(placeBet('inst-1', 7, 50)).resolves.toEqual(state)
        expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('PlaceBet', {
            body: { instanceId: 'inst-1', answerId: 7, wager: 50 },
        })
    })

    it('buys hints and fetches the current private player state', async () => {
        const state = { nickname: 'Ada', points: 80, bet: null, hints: [{ hintId: 9, text: 'A hint', cost: 20 }] }
        supabaseMock.functions.invoke.mockResolvedValue({ data: state, error: null })

        await expect(buyHint('inst-1', 9)).resolves.toEqual(state)
        expect(supabaseMock.functions.invoke).toHaveBeenLastCalledWith('BuyHint', {
            body: { instanceId: 'inst-1', hintId: 9 },
        })

        await expect(getPlayerState('inst-1')).resolves.toEqual(state)
        expect(supabaseMock.functions.invoke).toHaveBeenLastCalledWith('GetPlayerState', {
            body: { instanceId: 'inst-1' },
        })
    })
})
