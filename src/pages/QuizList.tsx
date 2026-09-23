import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCategories, listQuizzes } from '../database/quiz-api';
import type { Category, QuizSummary } from '../database/types';
import { useSession } from '../utils/useSession';
import './QuizEditor.css';

function QuizList() {
    const { session } = useSession();
    const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [error, setError] = useState<string | null>(null);

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

    return (
        <div className="quiz-page">
            <header className="quiz-page-header">
                <h1>Quizzes</h1>
                {userId
                    ? <Link className="quiz-button" to="/quizzes/new">New quiz</Link>
                    : <a className="quiz-button" href="/login/">Sign in to create quizzes</a>}
            </header>

            {error && <p className="quiz-error">{error}</p>}

            {quizzes.length === 0 && !error && <p className="quiz-muted">No quizzes yet.</p>}

            <ul className="quiz-list">
                {quizzes.map(quiz => (
                    <li key={quiz.quizId} className="quiz-list-item">
                        <div>
                            <strong>{quiz.quizTitle}</strong>
                            <span className="quiz-muted"> {categoryName(quiz.categoryId)}</span>
                        </div>
                        {userId && quiz.userId === userId && (
                            <Link className="quiz-link" to={`/quizzes/${quiz.quizId}`}>Edit</Link>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default QuizList;
