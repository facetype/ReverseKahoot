import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCategories, listQuizzes } from '../database/quiz-api';
import { hostGame } from '../database/game-api';
import type { Category, HostedGame, QuizSummary } from '../database/types';
import { useSession } from '../utils/useSession';
import './QuizEditor.css';

function QuizList() {
    const { session } = useSession();
    const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [hosted, setHosted] = useState<(HostedGame & { quizTitle: string }) | null>(null);
    const [hostingQuizId, setHostingQuizId] = useState<number | null>(null);

    useEffect(() => {
        Promise.all([listQuizzes(), getCategories()])
            .then(([q, c]) => {
                setQuizzes(q);
                setCategories(c);
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load quizzes.'));
    }, []);

    const categoryName = (id: number) =>
        categories.find(c => c.categoryId === id)?.categoryName ?? 'Uncategorised';

    const userId = session?.user.id ?? null;

    const handleHost = async (quiz: QuizSummary) => {
        setHostingQuizId(quiz.quizId);
        setError(null);
        try {
            const game = await hostGame(quiz.quizId);
            setHosted({ ...game, quizTitle: quiz.quizTitle });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not host the game.');
        } finally {
            setHostingQuizId(null);
        }
    };

    return (
        <div className="quiz-page">
            <header className="quiz-page-header">
                <h1>Quizzes</h1>
                {userId
                    ? <Link className="quiz-button" to="/quizzes/new">New quiz</Link>
                    : <a className="quiz-button" href="/login/">Sign in to create quizzes</a>}
            </header>

            {error && <p className="quiz-error">{error}</p>}

            {hosted && (
                <section className="quiz-hosted" role="status" aria-label="Hosted game">
                    <p className="quiz-muted">Game code for <strong>{hosted.quizTitle}</strong></p>
                    <p className="quiz-code">{hosted.gameCode}</p>
                    <p className="quiz-muted">Players enter this code on the home page to join.</p>
                </section>
            )}

            {quizzes.length === 0 && !error && <p className="quiz-muted">No quizzes yet.</p>}

            <ul className="quiz-list">
                {quizzes.map(quiz => (
                    <li key={quiz.quizId} className="quiz-list-item">
                        <div>
                            <strong>{quiz.quizTitle}</strong>
                            <span className="quiz-muted"> {categoryName(quiz.categoryId)}</span>
                        </div>
                        {userId && (
                            <div className="quiz-item-actions">
                                {quiz.userId === userId && (
                                    <Link className="quiz-link" to={`/quizzes/${quiz.quizId}`}>Edit</Link>
                                )}
                                <button
                                    className="quiz-button"
                                    type="button"
                                    onClick={() => handleHost(quiz)}
                                    disabled={hostingQuizId !== null}
                                    aria-label={`Host ${quiz.quizTitle}`}
                                >
                                    {hostingQuizId === quiz.quizId ? 'Hosting…' : 'Host'}
                                </button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default QuizList;
