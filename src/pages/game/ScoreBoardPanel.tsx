import type { PlayerStanding } from '@/api/supabase/quiz-instance-api';
import { stickerFor } from '@/common/stickers';

interface ScoreboardPanelProps {
    standings: PlayerStanding[];
    me?: string | null;
    onClose: () => void;
}

// The slide-in leaderboard. Points only change when a round is revealed, so
// opening it mid-round shows the standing after the previous round.
function ScoreboardPanel({ standings, me = null, onClose }: ScoreboardPanelProps) {
    return (
        <aside className="gameAnswerScoreboardContainer" aria-label="Scoreboard">
            <div className="gamePanelHeader">
                <h3>Scoreboard</h3>
                <button type="button" className="gamePanelClose" onClick={onClose} aria-label="Close scoreboard">×</button>
            </div>
            {standings.length === 0 && <p className="gamePanelEmpty">No players yet.</p>}
            {standings.map((player, index) => (
                <div
                    key={player.userId}
                    className={`gameAnswerScoreboardPlayerContainer${player.userId === me ? ' gameScoreboardMe' : ''}`}
                >
                    <img src={stickerFor(player.userId)} width="50" alt="" />
                    <p>
                        {index + 1}. {player.nickname}
                        {player.userId === me ? ' (you)' : ''}
                    </p>
                    <div className="gameAnswerScoreboardPlayerPointsContainer">
                        <p>{player.points} pts</p>
                    </div>
                </div>
            ))}
        </aside>
    );
}

export default ScoreboardPanel;