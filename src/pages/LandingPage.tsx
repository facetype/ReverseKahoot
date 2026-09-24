import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../utils/useSession';
import { supabase } from '../utils/supabase/supabase';
import './QuizEditor.css';
import './LandingPage.css';

const JOIN_CODE_LENGTH = 6;

function LandingPage() {
    const { session } = useSession();
    const [code, setCode] = useState('');
    const [message, setMessage] = useState<string | null>(null);

    const handleLogOut = async () => {
        if (!supabase) return;
        const { error } = await supabase.auth.signOut();
        if (error) setMessage(error.message);
    };

    const handleJoin = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (code.length !== JOIN_CODE_LENGTH) {
            setMessage(`Game codes are ${JOIN_CODE_LENGTH} characters.`);
            return;
        }
        // Games do not exist in the database yet; wire this up once they do.
        setMessage(`Joining games is not available yet (code ${code}).`);
    };

    return (
        <div className="landing-page">
            <header className="landing-header">
                {session
                    ? <>
                        <Link className="landing-host" to="/quizzes">Host a game</Link>
                        <button className="landing-host" type="button" onClick={handleLogOut}>Log out</button>
                    </>
                    : <a className="landing-host" href="/login/">Sign in</a>}
            </header>

            <main className="landing-main">
                <h1>Blinded <em>Flutter</em></h1>
                <form className="landing-join" onSubmit={handleJoin}>
                    <label htmlFor="join-code">Game code</label>
                    <input
                        id="join-code"
                        value={code}
                        onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        maxLength={JOIN_CODE_LENGTH}
                        placeholder="XY87ZK"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        aria-describedby={message ? 'join-message' : undefined}
                    />
                    <button className="quiz-button" type="submit">Join</button>
                </form>
                {message && <p id="join-message" className="quiz-muted" role="status">{message}</p>}
            </main>
        </div>
    );
}

export default LandingPage;
