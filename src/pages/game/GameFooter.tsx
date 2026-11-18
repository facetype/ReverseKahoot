interface GameFooterProps {
    // Player only: current points, and the shop toggle (omit when nothing is for sale).
    points?: number | null;
    onToggleShop?: () => void;
    shopOpen?: boolean;
    // The player counter doubles as the scoreboard toggle (omit to hide it).
    counterText?: string;
    onToggleScoreboard?: () => void;
    scoreboardOpen?: boolean;
    // Host only: the button that moves the game on.
    actionLabel?: string;
    onAction?: () => void;
    actionDisabled?: boolean;
}

// The bar along the bottom of the game screen.
function GameFooter({
    points,
    onToggleShop,
    shopOpen = false,
    counterText,
    onToggleScoreboard,
    scoreboardOpen = false,
    actionLabel,
    onAction,
    actionDisabled = false,
}: GameFooterProps) {
    return (
        <footer className="pageFooter">
            <div className="pageFooterLeftButtonsContainer">
                {onToggleShop && (
                    <div className="shopButton">
                        <button type="button" onClick={onToggleShop} aria-expanded={shopOpen}>
                            <img src="/elements/game/shop-icon.svg" width="30" alt="" />
                            <p>Shop</p>
                        </button>
                    </div>
                )}
                {points !== undefined && points !== null && (
                    <div className="currentPointsContainer">
                        <img src="/elements/game/points-icon.svg" width="30" alt="" />
                        <p>{points} pts</p>
                    </div>
                )}
            </div>

            <div className="pageFooterRightButtonsContainer">
                {counterText !== undefined && onToggleScoreboard && (
                    <div className="playerCounter">
                        <button
                            type="button"
                            onClick={onToggleScoreboard}
                            aria-expanded={scoreboardOpen}
                            aria-label={`Scoreboard, ${counterText}`}
                        >
                            <img src="/elements/game/player-count-icon.svg" width="20" alt="" />
                            {counterText}
                        </button>
                    </div>
                )}
                {actionLabel && onAction && (
                    <div className="pageButton">
                        <button type="button" onClick={onAction} disabled={actionDisabled}>
                            <p>{actionLabel}</p>
                            <img src="/elements/game/game-arrow-button.svg" width="50" alt="" />
                        </button>
                    </div>
                )}
            </div>
        </footer>
    );
}

export default GameFooter;