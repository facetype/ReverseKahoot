import type { GameQuestion } from '@/api/supabase/quiz-instance-api';

interface ShopPanelProps {
    hints: GameQuestion['hints'];
    boughtIds: ReadonlySet<number>;
    points: number;
    busy: boolean;
    onBuy: (hintId: number) => void;
    onClose: () => void;
}

// The slide-in shop. For now it sells the hints the quiz author wrote for this
// question; the layout has room for more kinds of items.
function ShopPanel({ hints, boughtIds, points, busy, onBuy, onClose }: ShopPanelProps) {
    return (
        <aside className="gameShopContainer" aria-label="Shop">
            <div className="gamePanelHeader">
                <div className="gameShopHeaderContainer">
                    <h3><img src="/elements/game/shop-icon.svg" width="20" alt="" /> Shop</h3>
                    <p>Spend your points to buy an item</p>
                </div>
                <button type="button" className="gamePanelClose" onClick={onClose} aria-label="Close shop">×</button>
            </div>
            {hints.map((hint, index) => {
                const bought = boughtIds.has(hint.hintId);
                return (
                    <div className="gameShopItemContainer" key={hint.hintId}>
                        <button
                            type="button"
                            onClick={() => onBuy(hint.hintId)}
                            disabled={bought || busy || hint.cost > points}
                        >
                            <div className="gameShopItemIconContainer">
                                <img src="/elements/game/hint-icon.svg" width="20" alt="" />
                            </div>
                            <div className="gameShopItemNameContainer">
                                <p>Hint {index + 1}</p>
                            </div>
                            <div className="gameShopItemCostContainer">
                                {bought ? 'Bought' : `${hint.cost} pts`}
                            </div>
                        </button>
                    </div>
                );
            })}
        </aside>
    );
}

export default ShopPanel;