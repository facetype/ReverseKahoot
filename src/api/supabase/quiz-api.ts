import { supabase } from './client.ts';
import type { Category, QuizDraft, QuizSummary } from '@/common/types';

// The client is null when env vars are missing; every call goes through here
// so callers get one clear error instead of a crash.
function db() {
    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase;
}

// Owner columns are never sent from the client. The database fills "userId"
// from the JWT (column default plus a BEFORE INSERT trigger), so the owner is
// always the signed-in user no matter what a request contains. This check only
// exists to give a clear error before the request is made.
export async function requireSignedIn(): Promise<string> {
    const { data, error } = await db().auth.getUser();
    if (error || !data.user) throw new Error('You must be signed in to do that.');
    return data.user.id;
}

export async function getCategories(): Promise<Category[]> {
    const { data, error } = await db()
        .from('Category')
        .select('categoryId, categoryName')
        .order('categoryName');
    if (error) throw error;
    return data ?? [];
}

export async function listQuizzes(): Promise<QuizSummary[]> {
    const { data, error } = await db()
        .from('Quiz')
        .select('quizId, quizTitle, categoryId, userId, Profile(userName)')
        .order('quizId', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(({Profile, ...quiz}) => ({
        ...quiz,
        userName: (Profile as unknown as {userName: string} | null)?.userName ?? null,
    })
    
    );
}

function requireCategory(draft: QuizDraft): number {
    if (draft.categoryId === null) throw new Error('Pick a category for the quiz.');
    return draft.categoryId;
}

// Creates (quizId null) or updates a quiz with all its questions, answers and
// hints in one database transaction (save_quiz). Rows that carry an id are
// updated in place, so the history of played games stays attached to them, and a
// failed save leaves the quiz exactly as it was. Returns the quiz id.
export async function saveQuiz(quizId: number | null, draft: QuizDraft): Promise<number> {
    const categoryId = requireCategory(draft);
    const { data, error } = await db().rpc('save_quiz', {
        p_quiz_id: quizId,
        p_title: draft.quizTitle,
        p_category_id: categoryId,
        p_questions: draft.questions,
    });
    if (error) throw new Error(error.message);
    return data as number;
}

export interface LoadedQuiz {
    quizId: number;
    quizTitle: string;
    categoryId: number;
    userId: string | null;
    Question: {
        questionId: number;
        questionText: string;
        Answer: { answerId: number; answerText: string; isCorrect: boolean }[];
        Hint: { hintId: number; hintText: string; hintCost: number }[];
    }[];
}

// Only the quiz owner can read the questions, answers and hints (RLS).
export async function getQuiz(quizId: number): Promise<LoadedQuiz> {
    const { data, error } = await db()
        .from('Quiz')
        .select('quizId, quizTitle, categoryId, userId, Question(questionId, questionText, Answer(answerId, answerText, isCorrect), Hint(hintId, hintText, hintCost))')
        .eq('quizId', quizId)
        .single();
    if (error) throw error;
    const quiz = data as unknown as LoadedQuiz;
    // The database does not promise an order; ids grow in the order things were added.
    quiz.Question.sort((a, b) => a.questionId - b.questionId);
    for (const q of quiz.Question) {
        q.Answer.sort((a, b) => a.answerId - b.answerId);
        q.Hint.sort((a, b) => a.hintId - b.hintId);
    }
    return quiz;
}

export async function deleteQuiz(quizId: number) {
    const { data: deleted, error } = await db()
        .from('Quiz')
        .delete()
        .eq('quizId', quizId)
        .select('quizId');
    if (error) throw error;
    if (!deleted || deleted.length === 0) throw new Error('You can only delete your own quizzes.');
}