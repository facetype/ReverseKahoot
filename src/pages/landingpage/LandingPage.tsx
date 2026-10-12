import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinQuizInstance } from '@/api/supabase/quiz-instance-api';
import '@/common/styles/quiz.css';
import { JOIN_CODE_LENGTH } from '@/common/constants/game';
import './LandingPage.css';
import Navbar from '@/common/components/navbar/navbar';

function LandingPage() {
    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [joining, setJoining] = useState(false);

    const handleJoin = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (code.length !== JOIN_CODE_LENGTH) {
            setMessage(`Game codes are ${JOIN_CODE_LENGTH} characters.`);
            return;
        }
        setJoining(true);
        setMessage(null);
        try {
            const instance = await joinQuizInstance(code);
            navigate(`/lobby/${instance.instanceId}`, { state: { instance, isHost: false } });
        } catch (err: unknown) {
            setMessage(err instanceof Error ? err.message : 'Could not join the game.');
        } finally {
            setJoining(false);
        }
    };

    return (
        <div className="landing-page">
            <Navbar />

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
                    <button className="quiz-button" type="submit" disabled={joining}>
                        {joining ? 'Joining…' : 'Join'}
                    </button>
                </form>
                {message && <p id="join-message" className="quiz-muted" role="status">{message}</p>}
            </main>
        </div>
    );
}

export default LandingPage;
