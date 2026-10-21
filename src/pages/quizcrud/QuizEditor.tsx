import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteQuiz, getCategories, getQuiz, saveQuiz } from '@/api/supabase/quiz-api';
import type { AnswerDraft, Category, HintDraft, QuestionDraft, QuizDraft } from '@/common/types';
import {
    DEFAULT_HINT_COST,
    MAX_ANSWERS,
    MAX_HINTS,
    MAX_HINT_COST,
    MAX_QUESTIONS,
    MAX_TEXT_LENGTH,
    MAX_TITLE_LENGTH,
    MIN_ANSWERS,
} from '@/common/constants/game';
import { useSession } from '@/pages/auth/useSession';
import '@/common/styles/quiz.css';
import Navbar from '@/common/components/navbar/navbar';

// Terms in this editor match the game. The question is hidden from players until
// the round ends; they pick one of the answers, and may pay for hints to see more.

// Rows get a client-side key so React keeps the right inputs when one is removed.
type EditorQuestion = QuestionDraft & { key: string };

const emptyQuestion = (): EditorQuestion => ({
    key: crypto.randomUUID(),
    questionText: '',
    answers: Array.from({ length: MAX_ANSWERS }, () => ({ answerText: '', isCorrect: false })),
    hints: [],
});

function EditorShell({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <Navbar />
            <div className="quiz-page">{children}</div>
        </div>
    );
}

function QuizEditor() {
    const { quizId } = useParams(); // undefined => create
    const navigate = useNavigate();
    const { session, loading: sessionLoading } = useSession();
    const [categories, setCategories] = useState<Category[]>([]);
    const [title, setTitle] = useState('');
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [questions, setQuestions] = useState<EditorQuestion[]>(() => [emptyQuestion()]);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [checking, setChecking] = useState(Boolean(quizId));

    // Guests (anonymous players) have a session but may not author quizzes.
    const userId = session && !session.user.is_anonymous ? session.user.id : null;

    useEffect(() => {
        getCategories()
            .then(list => {
                setCategories(list);
                // Default to the only category when there is exactly one.
                if (list.length === 1) setCategoryId(current => current ?? list[0].categoryId);
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load categories.'));
    }, []);

    useEffect(() => {
        if (!quizId || sessionLoading || !userId) return;
        let cancelled = false;
        getQuiz(Number(quizId))
            .then(q => {
                if (cancelled) return;
                if (q.userId !== userId) {
                    navigate('/quizzes', { replace: true });
                    return;
                }
                setTitle(q.quizTitle);
                setCategoryId(q.categoryId);
                setQuestions(q.Question.map(qq => {
                    const answers: AnswerDraft[] = qq.Answer.map(a => ({ answerId: a.answerId, answerText: a.answerText, isCorrect: a.isCorrect }));
                    // Pad to the full set of slots so an answer can be added back later.
                    while (answers.length < MAX_ANSWERS) answers.push({ answerId: undefined, answerText: '', isCorrect: false });
                    return {
                        key: crypto.randomUUID(),
                        questionId: qq.questionId,
                        questionText: qq.questionText,
                        answers,
                        hints: qq.Hint.map(h => ({ hintId: h.hintId, hintText: h.hintText, hintCost: h.hintCost })),
                    };
                }));
                setChecking(false);
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : 'Could not load the quiz.');
                setChecking(false);
            });
        return () => { cancelled = true; };
    }, [quizId, sessionLoading, userId, navigate]);

    const updateQuestion = (key: string, fn: (q: EditorQuestion) => EditorQuestion) =>
        setQuestions(list => list.map(q => (q.key === key ? fn(q) : q)));

    const updateHint = (key: string, index: number, patch: Partial<HintDraft>) =>
        updateQuestion(key, q => ({ ...q, hints: q.hints.map((h, i) => (i === index ? { ...h, ...patch } : h)) }));

    // The same rules save_quiz enforces, so most mistakes are caught before saving.
    const validate = (): string | null => {
        if (!title.trim()) return 'Quiz needs a title.';
        if (categoryId === null) return 'Pick a category.';
        if (questions.length === 0) return 'Add at least one question.';
        for (const [i, q] of questions.entries()) {
            const label = `Question ${i + 1}`;
            if (!q.questionText.trim()) return `${label} is empty.`;
            const filled = q.answers.filter(a => a.answerText.trim());
            if (filled.length < MIN_ANSWERS) return `${label} needs at least ${MIN_ANSWERS} answers.`;
            if (filled.filter(a => a.isCorrect).length !== 1) return `${label} needs exactly one correct answer.`;
            const texts = filled.map(a => a.answerText.trim().toLowerCase());
            if (new Set(texts).size !== texts.length) return `${label} has two identical answers.`;
            for (const [h, hint] of q.hints.entries()) {
                if (!hint.hintText.trim()) return `Hint ${h + 1} of ${label} is empty.`;
                if (!Number.isInteger(hint.hintCost) || hint.hintCost < 1 || hint.hintCost > MAX_HINT_COST) {
                    return `Hint ${h + 1} of ${label} must cost between 1 and ${MAX_HINT_COST} points.`;
                }
            }
        }
        return null;
    };

    const handleSave = async () => {
        const message = validate();
        if (message) return setError(message);

        const draft: QuizDraft = {
            quizTitle: title.trim(),
            categoryId,
            questions: questions.map(({ key: _key, ...q }) => ({
                ...q,
                questionText: q.questionText.trim(),
                // A cleared answer slot is dropped, which removes that answer.
                answers: q.answers
                    .filter(a => a.answerText.trim())
                    .map(a => ({ ...a, answerText: a.answerText.trim() })),
                hints: q.hints.map(h => ({ ...h, hintText: h.hintText.trim() })),
            })),
        };
        setSaving(true);
        setError(null);
        try {
            await saveQuiz(quizId ? Number(quizId) : null, draft);
            navigate('/quizzes');
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
            navigate('/quizzes');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not delete the quiz.');
            setConfirmDelete(false);
        } finally {
            setSaving(false);
        }
    };

    const removeQuestion = (q: EditorQuestion, index: number) => {
        const hasContent = q.questionText.trim() || q.answers.some(a => a.answerText.trim());
        if (hasContent && !window.confirm(`Remove question ${index + 1}?`)) return;
        setQuestions(list => list.filter(x => x.key !== q.key));
    };

    if (sessionLoading) {
        return <EditorShell><p className="quiz-muted center-text">Loading…</p></EditorShell>;
    }
    if (!userId) {
        return (
            <EditorShell>
                <h1>{quizId ? 'Edit quiz' : 'New quiz'}</h1>
                <p className="quiz-muted">You need to be signed in with an account to create or edit quizzes.</p>
                <Link className="quiz-button" to="/login">Go to sign in</Link>
            </EditorShell>
        );
    }
    if (quizId && checking) {
        return <EditorShell><p className="quiz-muted center-text">Loading quiz…</p></EditorShell>;
    }

    return (
        <EditorShell>
            <header className="quiz-page-header">
                <h1>{quizId ? 'Edit quiz' : 'New quiz'}</h1>
            </header>

            <div className="quiz-form">
                <label className="quiz-field">
                    Quiz title
                    <input
                        placeholder="Quiz title"
                        maxLength={MAX_TITLE_LENGTH}
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />
                </label>

                <label className="quiz-field">
                    Category
                    <select
                        value={categoryId ?? ''}
                        onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : null)}
                    >
                        <option value="">Pick a category</option>
                        {categories.map(c => (
                            <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>
                        ))}
                    </select>
                </label>

                <p className="quiz-muted">
                    Players never see the question until the round ends. They bet on one of the answers
                    and can pay for hints, so write hints that narrow things down without giving it away.
                </p>

                {questions.map((q, qi) => (
                    <fieldset key={q.key} className="quiz-question">
                        <legend>Question {qi + 1}</legend>
                        <input
                            placeholder="The question (hidden until the reveal)"
                            aria-label={`Question ${qi + 1} text`}
                            maxLength={MAX_TEXT_LENGTH}
                            value={q.questionText}
                            onChange={e => updateQuestion(q.key, x => ({ ...x, questionText: e.target.value }))}
                        />

                        <p className="quiz-editor-heading">
                            Answers ({MIN_ANSWERS} to {MAX_ANSWERS}). Select the correct one.
                        </p>
                        {q.answers.map((a, ai) => (
                            <label key={ai} className="quiz-answer">
                                <input
                                    type="radio"
                                    name={`correct-${q.key}`}
                                    title="Mark as the correct answer"
                                    aria-label={`Answer ${ai + 1} is correct`}
                                    checked={a.isCorrect}
                                    disabled={!a.answerText.trim()}
                                    onChange={() =>
                                        updateQuestion(q.key, x => ({
                                            ...x, answers: x.answers.map((y, j) => ({ ...y, isCorrect: j === ai })),
                                        }))
                                    }
                                />
                                <input
                                    placeholder={`Answer ${ai + 1}${ai >= MIN_ANSWERS ? ' (optional)' : ''}`}
                                    maxLength={MAX_TEXT_LENGTH}
                                    value={a.answerText}
                                    onChange={e =>
                                        updateQuestion(q.key, x => ({
                                            ...x,
                                            answers: x.answers.map((y, j) => {
                                                if (j !== ai) return y;
                                                const answerText = e.target.value;
                                                // An empty slot cannot be the correct answer.
                                                return { ...y, answerText, isCorrect: answerText.trim() ? y.isCorrect : false };
                                            }),
                                        }))
                                    }
                                />
                            </label>
                        ))}

                        <p className="quiz-editor-heading">Hints (optional, up to {MAX_HINTS}). Players pay points to see them.</p>
                        {q.hints.map((hint, hi) => (
                            <div key={hint.hintId ?? `new-${hi}`} className="quiz-hint">
                                <input
                                    placeholder={`Hint ${hi + 1}`}
                                    aria-label={`Hint ${hi + 1} text`}
                                    maxLength={MAX_TEXT_LENGTH}
                                    value={hint.hintText}
                                    onChange={e => updateHint(q.key, hi, { hintText: e.target.value })}
                                />
                                <input
                                    type="number"
                                    min={1}
                                    max={MAX_HINT_COST}
                                    step={1}
                                    inputMode="numeric"
                                    aria-label={`Hint ${hi + 1} price in points`}
                                    title="Price in points"
                                    value={hint.hintCost}
                                    onChange={e => updateHint(q.key, hi, { hintCost: Math.floor(Number(e.target.value) || 0) })}
                                />
                                <button
                                    type="button"
                                    className="quiz-link"
                                    onClick={() => updateQuestion(q.key, x => ({ ...x, hints: x.hints.filter((_, i) => i !== hi) }))}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        {q.hints.length < MAX_HINTS && (
                            <button
                                type="button"
                                className="quiz-link"
                                onClick={() =>
                                    updateQuestion(q.key, x => ({
                                        ...x, hints: [...x.hints, { hintText: '', hintCost: DEFAULT_HINT_COST }],
                                    }))
                                }
                            >
                                Add a hint
                            </button>
                        )}

                        <button type="button" className="quiz-link" onClick={() => removeQuestion(q, qi)}>
                            Remove question
                        </button>
                    </fieldset>
                ))}

                <div className="quiz-actions">
                    <button
                        type="button"
                        onClick={() => setQuestions(list => [...list, emptyQuestion()])}
                        disabled={questions.length >= MAX_QUESTIONS}
                    >
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
        </EditorShell>
    );
}

export default QuizEditor;