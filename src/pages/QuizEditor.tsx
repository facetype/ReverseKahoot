import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createQuiz, getQuiz, updateQuiz, deleteQuiz } from '../database/quiz-api';
import type { QuizDraft, QuestionDraft } from '../database/types';

const emptyQuestion = (): QuestionDraft => ({
    questionText: '',
    answers: Array.from({ length: 4 }, () => ({ answerText: '', isCorrect: false }))
})

export default function QuizEditor({ userId }: { userId: number }) {
    const { quizId } = useParams(); // undefined => create
    const navigate = useNavigate();
    const [draft, setDraft] = useState<QuizDraft>({
        quizTitle: '', categoryId: null, questions: [emptyQuestion()],
    });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!quizId) return;
        getQuiz(Number(quizId))
            .then(q => setDraft({
                quizTitle: q.quizTitle,
                categoryId: q.categoryId,
                questions: q.Question.map((qq: any) => ({
                    questionText: qq.questionText,
                    answers: qq.Answer.map((a: any) => ({ answerText: a.answerText, isCorrect: a.isCorrect })),
                })),
            }))
            .catch(e => setError(e.message));
    }, [quizId]);

    const updateQuestion = (qi: number, fn: (q: QuestionDraft) => QuestionDraft) => 
        setDraft(d => ({ ...d, questions: d.questions.map((q, i) => (i === qi ? fn(q) : q)) }));

    const validate = () => {
        if (!draft.quizTitle.trim()) return 'Quiz needs a title.';
        for (const [i, q] of draft.questions.entries()) {
            if (!q.questionText.trim()) return `Question ${i + 1} is empty.`;
            if (!q.answers.some(a => a.isCorrect && a.answerText.trim())) return `Question ${i + 1} needs a correct answer.`;
        }
        return null;
    }

    const handleSave = async () => {
        const message = validate();
        
        if (message) return setError(message);
        
        const cleanup: QuizDraft = {
            ...draft,
            questions: draft.questions.map(q => ({
                ...q, answers: q.answers.filter(a => a.answerText.trim()),
            })),
        };
        try {
            if (quizId) await updateQuiz(Number(quizId), cleanup);
            else await createQuiz(userId, cleanup);
            navigate('/quizzes');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDelete = async () => {
        if (!quizId || !confirm('Delete quiz?')) return;
        try {
            await deleteQuiz(Number(quizId));
            navigate('/quizzes')
        } catch (e: any) {
            setError(e.message);
        }
    }

    return (
        <div>
            <input 
                placeholder='Quiz title' 
                value={draft.quizTitle} 
                onChange={e => setDraft(d => ({ ...d, quizTitle: e.target.value}))}/>

            {draft.questions.map((q, qi) => (
                <fieldset key={qi}>
                    <input 
                        placeholder={`Question ${qi + 1}`} 
                        value={q.questionText} 
                        onChange={e => updateQuestion(qi, x => ({ ...x, questionText: e.target.value }))}/>
                    {q.answers.map((a, ai) => (
                        <label key={ai}>
                            <input 
                                type='radio' 
                                name={`correct-${qi}`} 
                                checked={a.isCorrect} 
                                onChange={() => 
                                    updateQuestion(qi, x => ({
                                    ...x, answers: x.answers.map((y, j) => ({ ...y, isCorrect: j === ai})),
                                    }))
                                }
                            />

                            <input
                                placeholder={`Answer is ${ai + 1}`}
                                value={a.answerText}
                                onChange={e =>
                                    updateQuestion(qi, x => ({
                                        ...x, answers: x.answers.map((y, j) => (j === ai ? { ...y, answerText: e.target.value } : y)),
                                    }))
                                }
                            />
                        </label>
                    ))}
                    <button onClick={() => setDraft(d => ({ ...d, questions: d.questions.filter((_, i) => i !== qi) }))}>Remove Question</button>
                </fieldset>
            ))}

            <button onClick={() => setDraft(d => ({ ...d, questions: [...d.questions, emptyQuestion()]}))}>Add Question</button>
            <button onClick={handleSave}>Save Quiz</button>
            {quizId && <button onClick={handleDelete}>Delete Quiz</button>}
            {error && <p style={{ color: 'red' }}></p>}
        </div>
    );
}