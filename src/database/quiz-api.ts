import { supabase } from '../utils/supabase/supabase.ts';
import type { Category, QuizDraft, QuestionDraft, QuizSummary } from './types';

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
        .select('quizId, quizTitle, categoryId, userId')
        .order('quizId', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

async function addQuestions(quizId: number, questions: QuestionDraft[]) {
    for (const q of questions) {
        const { data: question, error } = await db()
            .from('Question')
            .insert({ quizId, questionText: q.questionText })
            .select()
            .single();
        if (error) throw error;

        const { error: aErr } = await db().from('Answer').insert(
            q.answers.map(a => ({
                questionId: question.questionId,
                answerText: a.answerText,
                isCorrect: a.isCorrect,
            }))
        );
        if (aErr) throw aErr;
    }
}

function requireCategory(draft: QuizDraft): number {
    if (draft.categoryId === null) throw new Error('Pick a category for the quiz.');
    return draft.categoryId;
}

export async function createQuiz(draft: QuizDraft) {
    await requireSignedIn();
    const categoryId = requireCategory(draft);
    const { data: quiz, error } = await db()
        .from('Quiz')
        .insert({ categoryId, quizTitle: draft.quizTitle })
        .select()
        .single();
    if (error) throw error;
    await addQuestions(quiz.quizId, draft.questions);
    return quiz;
}

export async function getQuiz(quizId: number) {
    const { data, error } = await db()
        .from('Quiz')
        .select('quizId, quizTitle, categoryId, userId, Question(questionId, questionText, Answer(answerId, answerText, isCorrect))')
        .eq('quizId', quizId)
        .single();
    if (error) throw error;
    return data;
}

// Replaces the quiz's questions wholesale. Fine while there are no games
// referencing answers; revisit once Bets exist.
export async function updateQuiz(quizId: number, draft: QuizDraft) {
    const categoryId = requireCategory(draft);
    const { data: updated, error } = await db()
        .from('Quiz')
        .update({ quizTitle: draft.quizTitle, categoryId })
        .eq('quizId', quizId)
        .select('quizId');
    if (error) throw error;
    // RLS silently filters rows you do not own, so zero rows means "not yours".
    if (!updated || updated.length === 0) throw new Error('You can only edit your own quizzes.');

    const { error: delErr } = await db()
        .from('Question')
        .delete()
        .eq('quizId', quizId);
    if (delErr) throw delErr;

    await addQuestions(quizId, draft.questions);
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
