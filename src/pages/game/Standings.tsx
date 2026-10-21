import type { PlayerStanding } from '@/api/supabase/quiz-instance-api';

interface StandingsProps {
    standings: PlayerStanding[];
    me?: string | null;
    // Show each player's result on the question just revealed.
    showResult?: boolean;
    limit?: number;
}

function formatResult(pointsWon: number, wager: number): string {
    if (wager === 0) return 'no bet';
    return pointsWon > 0 ? `+${pointsWon}` : `${pointsWon}`;
}

function Standings({ standings, me = null, showResult = false, limit }: StandingsProps) {
    const shown = limit ? standings.slice(0, limit) : standings;
    if (shown.length === 0) return <p className="quiz-muted center-text">No players.</p>;

    return (
        <ol className="game-standings" aria-label="Leaderboard">
            {shown.map((player, index) => (
                <li
                    key={player.userId}
                    className={`game-standing${player.userId === me ? ' game-standing-me' : ''}`}
                >
                    <span className="game-rank">{index + 1}</span>
                    <span className="game-nickname">
                        {player.nickname}
                        {player.userId === me ? ' (you)' : ''}
                    </span>
                    {showResult && (
                        <span
                            className={`game-result ${player.pointsWon > 0 ? 'game-win' : player.pointsWon < 0 ? 'game-loss' : ''}`}
                        >
                            {formatResult(player.pointsWon, player.wager)}
                        </span>
                    )}
                    <span className="game-points">{player.points} pts</span>
                </li>
            ))}
        </ol>
    );
}

export default Standings;
