import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCategories, listQuizzes } from '@/api/supabase/quiz-api';
import { hostGame } from '@/api/supabase/game-api';
import type { Category, HostedGame, QuizSummary } from '@/common/types';
import { useSession } from '@/features/auth/useSession';
import '@/common/styles/quiz.css';
import Navbar from '@/common/components/navbar/navbar';
import { useMemo } from 'react';

function QuizList() {
    const { session } = useSession();
    const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [hosted, setHosted] = useState<(HostedGame & { quizTitle: string }) | null>(null);
    const [hostingQuizId, setHostingQuizId] = useState<number | null>(null);
    const [searchItem, setSearchItem] = useState('');

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

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchItem(e.target.value);
    }

    const searchedItems = useMemo(() => {
        const searchTerm = searchItem.trim().toLowerCase();
        if (!searchTerm) return quizzes;

        // usernames
        if (searchTerm.startsWith('@')) {
            const username = searchTerm.slice(1);
            if (!username) return quizzes;
            
            return quizzes.filter(q => q.userName?.toLowerCase().includes(username));
        }

        // quizzes
        return quizzes.filter(q => q.quizTitle.toLowerCase().includes(searchTerm));
    }, [quizzes, searchItem]);

    return (
        <div><Navbar/>
        <div className="quiz-page">
            <h1 className="center-text">Quizzes</h1>
            <br/>
            <header className="quiz-page-header">

                <input className="quiz-page-search"
                    type="text"
                    value={searchItem}
                    onChange={handleInputChange}
                    placeholder="Search for quizzes, or add '@' at the beginning to search for users"
                />
                {userId
                    ? <Link className="quiz-button" to="/quizzes/new">New quiz</Link>
                    : <a className="quiz-button" href="/login/">Sign in</a>}
            </header>

            {error && <p className="quiz-error center-text">{error}</p>}

            {hosted && (
                <section className="quiz-hosted" role="status" aria-label="Hosted game">
                    <p className="quiz-muted">Game code for <strong>{hosted.quizTitle}</strong></p>
                    <p className="quiz-code">{hosted.gameCode}</p>
                    <p className="quiz-muted">Players enter this code on the home page to join.</p>
                </section>
            )}

            {quizzes.length === 0 && !error && <p className="quiz-muted center-text">No quizzes yet.</p>}

            <ul className="quiz-list">
                {searchedItems.map(quiz => (
                    <li key={quiz.quizId} className="quiz-list-item">
                        <div>
                            <strong>{quiz.quizTitle}</strong>
                            <span className="quiz-muted"> {categoryName(quiz.categoryId)}</span>
                            <br/><span>@{quiz.userName ?? 'unknown'}</span>
                            <br/><span className="quiz-page-date-text">Created: (dd.mm.YYYY) | Last edited: (dd.mm.YYYY)</span>
                        </div>
                        {userId && (
                            <div className="quiz-item-actions">
                                <Link className="quiz-link" to={`/quizzes/${quiz.quizId}`}>Edit</Link>
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
        </div>
    );
}

export default QuizList;
