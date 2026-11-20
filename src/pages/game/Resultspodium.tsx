import type { PlayerStanding } from '@/api/supabase/quiz-instance-api';
import { drawingStickerFor, shapeStickerFor } from '@/common/stickers';

// Left to right: second, first, third. Medal art and podium art are the same
// files the design uses.
const PLACES = [
    { index: 1, medal: 'silver', label: 'Second place' },
    { index: 0, medal: 'gold', label: 'First place' },
    { index: 2, medal: 'bronze', label: 'Third place' },
] as const;

interface ResultsPodiumProps {
    standings: PlayerStanding[];
    me?: string | null;
}

// The top three players on a podium. Fewer than three players is fine.
function ResultsPodium({ standings, me = null }: ResultsPodiumProps) {
    return (
        <div className="gameResultsQuizWinnersContainer">
            {PLACES.map(({ index, medal, label }) => {
                const player = standings[index];
                if (!player) return null;
                return (
                    <div key={medal} className={`gameResultsPlace gameResultsPlace-${medal}`} aria-label={label}>
                        <div className="gameResultsStickerWrap">
                            <div>
                                <img className="gameResultsSticker gameResultsStickerShape" src={shapeStickerFor(player.userId)} alt="" />
                                <img className="gameResultsSticker gameResultsStickerDrawing" src={drawingStickerFor(player.userId)} alt="" />
                            </div>
                            <img className="gameResultsBadge" src={`/elements/game/win_badge_${medal}.svg`} alt="" />
                        </div>
                        <div className="gameResultsNameplateContainer">
                            <p>{player.nickname}{player.userId === me ? ' (you)' : ''}</p>
                        </div>
                        <img className="gameResultsPodium" src={`/elements/game/${medal}-podium.svg`} alt="" />
                    </div>
                );
            })}
        </div>
    );
}

export default ResultsPodium;