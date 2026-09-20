import { supabase } from '../utils/supabase/supabase';
import type { QuizDraft, QuestionDraft } from './types';

async function addQuestions(quizId: number, questions: QuestionDraft[]) {
    for (const q of questions) {
        const { data: question, error } = await supabase
            .from('Question')
            .insert({ quizId, questionText: q.questionText })
            .select()
            .single();
        if (error) throw error;

        const { error: aErr } = await supabase.from('Answer').insert(
            q.answers.map(a => ({
                questionId: question.questionId,
                answerText: a.answerText,
                isCorrect: a.isCorrect,
            }))
        );
        if (aErr) throw aErr;
    }
}

export async function createQuiz(userId: number, draft: QuizDraft) {
    const { data: quiz, error } = await supabase
        .from('Quiz')
        .insert({ userId, categoryId: draft.categoryId, quizTitle: draft.quizTitle })
        .select()
        .single();
    if (error) throw error;
    await addQuestions(quiz.quizId, draft.questions);
    return quiz;
}

export async function getQuiz(quizId: number) {
    const { data, error } = await supabase
        .from('Quiz')
        .select('quizId, quizTitle, categoryId, Question(questionId, questionText, Answer(answerId, answerText, isCorrect))')
        .eq('quizId', quizId)
        .single();
    if (error) throw error;
    return data;
}

// shortcut (edit later)
export async function updateQuiz(quizId: number, draft: QuizDraft) {
    const { error } = await supabase
        .from('Quiz')
        .update({ quizTitle: draft.quizTitle, categoryId: draft.categoryId })
        .eq('quizId', quizId);
    if (error) throw error;

    const { error: delErr } = await supabase
        .from('Question')
        .delete()
        .eq('quizId', quizId)
    if (delErr) throw delErr;

    await addQuestions(quizId, draft.questions);
}

export async function deleteQuiz(quizId: number) {
    const { error } = await supabase
        .from('Quiz')
        .delete()
        .eq('quizId', quizId);
    if (error) throw error;
}
