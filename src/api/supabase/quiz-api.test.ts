import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabaseMock } from '@/test/supabase-mock.ts'
import type { QuizDraft } from '@/common/types'
import { deleteQuiz, getQuiz, listQuizzes, requireSignedIn, saveQuiz } from './quiz-api.ts'

vi.mock('./client.ts', async () => {
    const { supabaseMock } = await import('@/test/supabase-mock.ts')
    return { supabase: supabaseMock.client, supabaseConfigured: true }
})

const draft: QuizDraft = {
    quizTitle: 'Capitals',
    categoryId: 3,
    questions: [
        {
            questionText: 'Capital of Norway?',
            answers: [
                { answerText: 'Oslo', isCorrect: true },
                { answerText: 'Bergen', isCorrect: false },
            ],
            hints: [{ hintText: 'It is the largest city in Norway.', hintCost: 50 }],
        },
        {
            questionText: 'Capital of Sweden?',
            answers: [
                { answerText: 'Stockholm', isCorrect: true },
                { answerText: 'Malmo', isCorrect: false },
            ],
            hints: [],
        },
    ],
}

beforeEach(() => supabaseMock.reset())

describe('saveQuiz', () => {
    it('creates a quiz through the transactional RPC', async () => {
        supabaseMock.queueResult({ data: 10 })

        await expect(saveQuiz(null, draft)).resolves.toBe(10)

        expect(supabaseMock.queries).toHaveLength(1)
        const [query] = supabaseMock.queries
        expect(query.table).toBe('rpc')
        expect(supabaseMock.args(query, 'rpc')).toEqual([
            'save_quiz',
            {
                p_quiz_id: null,
                p_title: 'Capitals',
                p_category_id: 3,
                p_questions: draft.questions,
            },
        ])
    })

    it('updates a quiz by passing its id to the same transactional RPC', async () => {
        supabaseMock.queueResult({ data: 10 })

        await expect(saveQuiz(10, draft)).resolves.toBe(10)

        const [query] = supabaseMock.queries
        expect(supabaseMock.args(query, 'rpc')?.[1]).toMatchObject({ p_quiz_id: 10 })
    })

    it('requires a category before calling the database', async () => {
        await expect(saveQuiz(null, { ...draft, categoryId: null })).rejects.toThrow(/category/)
        expect(supabaseMock.queries).toHaveLength(0)
    })

    it('surfaces RPC errors', async () => {
        supabaseMock.queueResult({ error: { message: 'save rejected' } })

        await expect(saveQuiz(null, draft)).rejects.toThrow('save rejected')
    })
})

describe('requireSignedIn', () => {
    it('returns the signed-in user id', async () => {
        supabaseMock.signedInAs('u1')

        await expect(requireSignedIn()).resolves.toBe('u1')
    })

    it('refuses when signed out', async () => {
        supabaseMock.signedOut()

        await expect(requireSignedIn()).rejects.toThrow(/signed in/)
        expect(supabaseMock.queries).toHaveLength(0)
    })
})

describe('deleteQuiz', () => {
    it('reports when nothing was deleted because the quiz is not yours', async () => {
        supabaseMock.queueResult({ data: [] })
        await expect(deleteQuiz(10)).rejects.toThrow(/only delete your own/)
    })

    it('deletes the quiz by id', async () => {
        supabaseMock.queueResult({ data: [{ quizId: 10 }] })

        await deleteQuiz(10)

        const [quiz] = supabaseMock.queriesOn('Quiz')
        expect(supabaseMock.args(quiz, 'delete')).toEqual([])
        expect(supabaseMock.args(quiz, 'eq')).toEqual(['quizId', 10])
    })
})

describe('listQuizzes', () => {
    it('flattens the joined profile into userName', async () => {
        supabaseMock.queueResult({
            data: [
                { quizId: 2, quizTitle: 'B', categoryId: 1, userId: 'u1', Profile: { userName: 'ada' } },
                { quizId: 1, quizTitle: 'A', categoryId: 1, userId: null, Profile: null },
            ],
        })

        expect(await listQuizzes()).toEqual([
            { quizId: 2, quizTitle: 'B', categoryId: 1, userId: 'u1', userName: 'ada' },
            { quizId: 1, quizTitle: 'A', categoryId: 1, userId: null, userName: null },
        ])
    })
})

describe('getQuiz', () => {
    it('sorts questions, answers, and hints by id', async () => {
        supabaseMock.queueResult({ data: {
            quizId: 10,
            quizTitle: 'Capitals',
            categoryId: 3,
            userId: 'u1',
            Question: [
                {
                    questionId: 102,
                    questionText: 'Second',
                    Answer: [{ answerId: 202, answerText: 'B', isCorrect: false }, { answerId: 201, answerText: 'A', isCorrect: true }],
                    Hint: [{ hintId: 302, hintText: 'Later', hintCost: 20 }, { hintId: 301, hintText: 'Earlier', hintCost: 10 }],
                },
                {
                    questionId: 101,
                    questionText: 'First',
                    Answer: [],
                    Hint: [],
                },
            ],
        } })

        const quiz = await getQuiz(10)

        expect(quiz.Question.map(question => question.questionId)).toEqual([101, 102])
        expect(quiz.Question[1].Answer.map(answer => answer.answerId)).toEqual([201, 202])
        expect(quiz.Question[1].Hint.map(hint => hint.hintId)).toEqual([301, 302])
        const [query] = supabaseMock.queriesOn('Quiz')
        expect(supabaseMock.args(query, 'eq')).toEqual(['quizId', 10])
    })
})
