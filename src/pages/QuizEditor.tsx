import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createQuiz, getCategories, getQuiz, updateQuiz, deleteQuiz } from '../database/quiz-api';
import type { Category, QuizDraft, QuestionDraft } from '../database/types';
import { useSession } from '../utils/useSession';
import './QuizEditor.css';

const emptyQuestion = (): QuestionDraft => ({
    questionText: '',
    answers: Array.from({ length: 4 }, () => ({ answerText: '', isCorrect: false }))
})

function QuizEditor() {
    const { quizId } = useParams(); // undefined => create
    const navigate = useNavigate();
    const { session, loading: sessionLoading } = useSession();
    const [categories, setCategories] = useState<Category[]>([]);
    const [draft, setDraft] = useState<QuizDraft>({
        quizTitle: '', categoryId: null, questions: [emptyQuestion()],
    });
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        getCategories()
            .then(list => {
                setCategories(list);
                // Default to the only category when there is exactly one.
                if (list.length === 1) {
                    setDraft(d => (d.categoryId === null ? { ...d, categoryId: list[0].categoryId } : d));
                }
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load categories.'));
    }, []);

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
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the quiz.'));
    }, [quizId]);

    const updateQuestion = (qi: number, fn: (q: QuestionDraft) => QuestionDraft) =>
        setDraft(d => ({ ...d, questions: d.questions.map((q, i) => (i === qi ? fn(q) : q)) }));

    const validate = () => {
        if (!draft.quizTitle.trim()) return 'Quiz needs a title.';
        if (draft.categoryId === null) return 'Pick a category.';
        if (draft.questions.length === 0) return 'Add at least one question.';
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
            quizTitle: draft.quizTitle.trim(),
            questions: draft.questions.map(q => ({
                ...q, answers: q.answers.filter(a => a.answerText.trim()),
            })),
        };
        setSaving(true);
        setError(null);
        try {
            if (quizId) await updateQuiz(Number(quizId), cleanup);
            else await createQuiz(cleanup);
            navigate('/');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not save the quiz.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!quizId) return;
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await deleteQuiz(Number(quizId));
            navigate('/');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not delete the quiz.');
            setConfirmDelete(false);
        } finally {
            setSaving(false);
        }
    }

    if (!sessionLoading && !session) {
        return (
            <div className="quiz-page">
                <h1>{quizId ? 'Edit quiz' : 'New quiz'}</h1>
                <p className="quiz-muted">You need to be signed in to create or edit quizzes.</p>
                <a className="quiz-button" href="/login/">Go to sign in</a>
            </div>
        );
    }

    return (
        <div className="quiz-page">
            <header className="quiz-page-header">
                <h1>{quizId ? 'Edit quiz' : 'New quiz'}</h1>
                <Link className="quiz-link" to="/">Back to quizzes</Link>
            </header>

            <div className="quiz-form">
                <label className="quiz-field">
                    Quiz title
                    <input
                        placeholder="Quiz title"
                        value={draft.quizTitle}
                        onChange={e => setDraft(d => ({ ...d, quizTitle: e.target.value }))}
                    />
                </label>

                <label className="quiz-field">
                    Category
                    <select
                        value={draft.categoryId ?? ''}
                        onChange={e => setDraft(d => ({ ...d, categoryId: e.target.value ? Number(e.target.value) : null }))}
                    >
                        <option value="">Pick a category</option>
                        {categories.map(c => (
                            <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>
                        ))}
                    </select>
                </label>

                {draft.questions.map((q, qi) => (
                    <fieldset key={qi} className="quiz-question">
                        <legend>Question {qi + 1}</legend>
                        <input
                            placeholder={`Question ${qi + 1}`}
                            value={q.questionText}
                            onChange={e => updateQuestion(qi, x => ({ ...x, questionText: e.target.value }))}
                        />
                        {q.answers.map((a, ai) => (
                            <label key={ai} className="quiz-answer">
                                <input
                                    type="radio"
                                    name={`correct-${qi}`}
                                    title="Mark as the correct answer"
                                    checked={a.isCorrect}
                                    onChange={() =>
                                        updateQuestion(qi, x => ({
                                            ...x, answers: x.answers.map((y, j) => ({ ...y, isCorrect: j === ai })),
                                        }))
                                    }
                                />
                                <input
                                    placeholder={`Answer ${ai + 1}`}
                                    value={a.answerText}
                                    onChange={e =>
                                        updateQuestion(qi, x => ({
                                            ...x, answers: x.answers.map((y, j) => (j === ai ? { ...y, answerText: e.target.value } : y)),
                                        }))
                                    }
                                />
                            </label>
                        ))}
                        <button
                            type="button"
                            className="quiz-link"
                            onClick={() => setDraft(d => ({ ...d, questions: d.questions.filter((_, i) => i !== qi) }))}
                        >
                            Remove question
                        </button>
                    </fieldset>
                ))}

                <div className="quiz-actions">
                    <button type="button" onClick={() => setDraft(d => ({ ...d, questions: [...d.questions, emptyQuestion()] }))}>
                        Add question
                    </button>
                    <button type="button" className="quiz-button" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save quiz'}
                    </button>
                    {quizId && (
                        <button type="button" className="quiz-danger" onClick={handleDelete} disabled={saving}>
                            {confirmDelete ? 'Click again to confirm delete' : 'Delete quiz'}
                        </button>
                    )}
                </div>

                {error && <p className="quiz-error" role="alert">{error}</p>}
            </div>
        </div>
    );
}

export default QuizEditor
