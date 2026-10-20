import { useState } from 'react';
import '@/common/styles/game.css'

function Game() {
    const [state, setState] = useState(Number);
    const [gameState, setGameState] = useState(Number);
    const [question, setQuestion] = useState(Number);
    const [playerType, setPlayerType] = useState<"host"|"player"|"">("player");
    const [players, setPlayers] = useState(Number); // example value
    const [playersAnswered, setPlayersAnswered] = useState(Number); // example value
    const [playerPoints, setPlayerPoints] = useState(1000);
    const [hintCost, setHintCost] = useState(playerPoints*0.1); // 10% of player's starting points
    const [isScoreboardOpened, setIsScoreboardOpened] = useState(false);
    const [isShopOpened, setIsShopOpened] = useState(false);
    const [purchasedThisQuestion, setPurchasedThisQuestion] = useState<string[]>([]);
    const stickerCollection = [
        "/elements/game/stickers/sticker-bird.svg", 
        "/elements/game/stickers/sticker-horse.svg",
        "/elements/game/stickers/sticker-rose.svg"];
    // edit later, this should be defined by/use a quiz's questions
    const maxQuestions = 9;
        
    const isHost = () => playerType === "host";
    const isPlayer = () => playerType === "player";
    const inGame = state === 1;
    const inResults = state === 2;
    const canUseShop = isPlayer() && inGame && gameState === 0;
    const canUseScoreboard = inGame;
    const canShowScoreboard = inGame || inResults;
    const shopItemIsPurchased = (shopItemId: string) => purchasedThisQuestion.includes(shopItemId);

    const playerCounterText = () => {
        var playerCounterText = "";
        
        if (state == 0){
            playerCounterText = players.toString();
        }
        else{
            playerCounterText = playersAnswered.toString() + "/" + players.toString();
        }
        
        return playerCounterText;
    }

    const gameButtonText = () => {
        var text = "";

        if (state == 0){
            text = "Start quiz";
        }
        else if (state == 1){
            if (gameState == 0){
                text = "Reveal answer";
            }
            else {
                text = "Next question";
            }
        }
        else {
            text = "End quiz";
        }

        return text;
    };

    const changeState = () => {
        if (state == 0){
            // lobby, start quiz
            setState(state + 1);
        }
        else if (state == 1){
            // game
            if (gameState == 0){
                // show options, reveal answer
                setGameState(1);
                setPlayersAnswered(0);
            }
            else{
                // reveal answer, next question
                setGameState(0);
                setPurchasedThisQuestion([]);
                
                if (question >= maxQuestions){
                    setQuestion(0);
                    setIsShopOpened(false);
                    setIsScoreboardOpened(true); // show the final results in the scoreboard
                    setState(2);
                }
                else{
                    setQuestion(question + 1);
                }
            }
        }
        else {
            window.location.href = "/";
        }

        //console.log("state:", state);
        //console.log("game state:", gameState);
        //console.log("question:", question);
    }

    const lobby = () => {
        return (
            <div className="lobbyContainer">
                <h1>Quiz name</h1>
                <div className="lobbyRoomcodeContainer">
                    <h2>ROOM CODE</h2>
                    <p className="lobbyRoomCode">D 7 8 G 1 3</p>
                    <p>(Enter the code to join the quiz)</p>
                </div>
                
                <div className="lobbyPlayerStickersContainer">
                </div>
            </div>
        );
    }

    // placeholder buttons; can be replaced later should we think of an alternative way to implement a proper mechanic
    const gameOptions = () => {
        return (
            <div className="gameContainer">
                <p>Bet on the correct answer that suits Question #{question + 1}...</p>
                <div className="gameOptionsContainer">
                    <button>Option 1</button>
                    <button>Option 2</button>
                    <button>Option 3</button>
                    <button>Option 4</button>
                </div>
                <div className="gameHintContainer"><p>Hint: It's not Option 4</p></div>
            </div>
        );
    }

    const gameAnswer = () => {
        return (
            <div className="gameResultsContainer">
                <div id="back" className="spiralBackground">
                    <img src="/elements/game/spiral.svg"/>
                </div>

                <div id="front">
                    <p>'Option 1' was correct!</p>
                    <p>Question #{question + 1} was 'INSERT QUESTION HERE'</p>
                    <button>Option 1</button>
                </div>
            </div>
        );
    }

    const results = () => {
        return (
            <div className="gameResultsContainer">
                <div id="back" className="spiralBackground">
                    <img src="/elements/game/spiral.svg"/>
                </div>

                <div id="front">
                    <div className="gameResultsTextContainer">
                        <h1>FINAL RESULTS</h1>
                        <p>The winners of today's quiz are...</p>
                    </div>
                    <div className="gameResultsQuizWinnersContainer">
                        <div className="gameResultsSecondPlaceContainer">
                            <img id="front" src={stickerCollection[0]} width="150px"/>
                            <img id="badge" src="/elements/game/win_badge_silver.svg" width="64px"/>
                            <div id="front" className="gameResultsNameplateContainer">
                                <p>Player 2</p>
                            </div>
                            <div id="back" className="gameResultsSilverPodium">
                                <img src="/elements/game/silver-podium.svg" width="300px"/>
                            </div>
                        </div>
                        
                        <div className="gameResultsFirstPlaceContainer">
                            <img id="front" src={stickerCollection[1]} width="150px"/>
                            <img id="badge" src="/elements/game/win_badge_gold.svg" width="64px"/>
                            <div id="front" className="gameResultsNameplateContainer">
                                <p>Player 1</p>
                            </div>
                            <div id="back" className="gameResultsGoldPodium">
                                <img src="/elements/game/gold-podium.svg" width="300px"/>
                            </div>
                        </div>
                        
                        <div className="gameResultsThirdPlaceContainer">
                            <img id="front" src={stickerCollection[2]} width="150px"/>
                            <img id="badge" src="/elements/game/win_badge_bronze.svg" width="64px"/>
                            <div id="front" className="gameResultsNameplateContainer">
                                <p>Player 3</p>
                            </div>
                            <div id="back" className="gameResultsBronzePodium">
                                <img src="/elements/game/bronze-podium.svg" width="300px"/>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const scoreboard = () => {
        return (
        <div id="front" className="gameAnswerScoreboardContainer">
            <h3>Scoreboard</h3>
            <div className="gameAnswerScoreboardPlayerContainer">
                <img src={stickerCollection[1]} width="50px"/>
                <p>Player 1</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <img src={stickerCollection[0]} width="50px"/>
                <p>Player 2</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>
            
            <div className="gameAnswerScoreboardPlayerContainer">
                <img src={stickerCollection[2]} width="50px"/>
                <p>Player 3</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>
        </div>
        );
    }

    const deductPlayerPoints = (shopItemId: string, cost: number, isHint:boolean = false) => {
        if (Math.floor(cost) > playerPoints) return;
        if (purchasedThisQuestion.includes(shopItemId)) return;

        if (isHint) {
            setHintCost(Math.floor(hintCost + hintCost*1.1));
        }

        setPlayerPoints(Math.floor(playerPoints - cost));
        setPurchasedThisQuestion([... purchasedThisQuestion, shopItemId]);
    }

    const shop = () => {

        // Hint: 100 pts (increases by 10% the more you buy a hint)
        // Cut options in two: 50% of your current points
        // Reveal answer: 90% of your current points

        return (
            <div className="gameShopContainer">
                <div className="gameShopHeaderContainer">
                    
                    <h3><img src="/elements/game/shop-icon.svg" width="20px"/> Shop</h3>
                    <p>Spend your points to buy an item</p>
                </div>
                <div className="gameShopItemContainer">
                    <button onClick={() => deductPlayerPoints("hint", Math.floor(hintCost), true)}
                            disabled={shopItemIsPurchased("hint") || Math.floor(hintCost) > playerPoints}>
                        <div className="gameShopItemIconContainer">
                            <img src="/elements/game/hint-icon.svg" width="20px"/>
                        </div>
                        <div className="gameShopItemNameContainer">
                            <p>Hint</p>
                        </div>
                        <div className="gameShopItemCostContainer">
                            {Math.floor(hintCost)} pts
                        </div>
                    </button>
                </div>

                <div className="gameShopItemContainer">
                    <button onClick={() => deductPlayerPoints("cut-options", Math.floor(playerPoints/2))}
                            disabled={shopItemIsPurchased("cut-options")}>
                        <div className="gameShopItemIconContainer">
                            <img src="/elements/game/cut-options-icon.svg" width="40px"/>
                        </div>
                        <div className="gameShopItemNameContainer">
                            <p>Cut options</p>
                        </div>
                        <div className="gameShopItemCostContainer">
                            {Math.floor(playerPoints/2)} pts
                        </div>
                    </button>
                </div>

                <div className="gameShopItemContainer">
                    <button onClick={() => deductPlayerPoints("reveal-answer", Math.floor(playerPoints*0.9))}
                            disabled={shopItemIsPurchased("reveal-answer")}>
                        <div className="gameShopItemIconContainer">
                            <img src="/elements/game/reveal-answer-icon.svg" width="50px"/>
                        </div>
                        <div className="gameShopItemNameContainer">
                            <p>Reveal answer</p>
                        </div>
                        <div className="gameShopItemCostContainer">
                            {Math.floor(playerPoints*0.9)} pts
                        </div>
                    </button>
                </div>

            </div>
        );
    }

    const pageState = () => {
        if (state == 0){
            return lobby()
        }
        else if (state == 1){
            if (gameState == 0){
                return gameOptions();
            }
            else{
                return gameAnswer();
            }
        }
        else {
            return results()
        }
    }

    const AddPlayer = () => {
        setPlayers(players + 1);
    }

    const AddPlayerAnswer = () => {
        if (playersAnswered < players) {
            setPlayersAnswered(playersAnswered + 1)
        }
    }

    const toggleScoreboard = () => {
        if (!canUseScoreboard) return;
        setIsScoreboardOpened(!isScoreboardOpened);
    }

    const toggleShop = () => {
        if (!canUseShop) return;
        setIsShopOpened(!isShopOpened);
    }

    const footer = () => {
        /*
        <div className="pageFooterButton">
            <button onClick={devAddPlayer}>Add player</button>
        </div>
        
        <div className="pageFooterButton">
            <button onClick={devPlayerRandomAnswer}>Add Random Player Answer</button>
        </div>
        */

        return (
            <div id="front" className="pageFooter">
                <div className="pageFooterLeftButtonsContainer">
                    {canUseShop && (
                        <div className="shopButton">
                            <button onClick={toggleShop}>
                                <img src="/elements/game/shop-icon.svg" width="30px"/>
                                <p>Shop</p>
                            </button>
                        </div>
                    )}
                </div>

                <div className="pageFooterMiddleButtonsContainer">
                    {isPlayer() && (
                        <div className="currentPointsContainer">
                            <img src="/elements/game/points-icon.svg" width="30px"/>
                            <p>{playerPoints} pts</p>
                        </div>
                    )}
                </div>

                <div className="pageFooterRightButtonsContainer">
                    {state != 2 && (
                        <div className="playerCounter">
                            <button onClick={toggleScoreboard}>
                                <img src="/elements/game/player-count-icon.svg" width="20px"/>
                                {playerCounterText()}
                            </button>
                        </div>
                    )}

                    <div className="pageButton">
                            <button onClick={changeState}><p>{gameButtonText()}</p><img src="/elements/game/game-arrow-button.svg" width="50px"/></button>
                    </div>
                </div>
            </div>
        );
    }

    /*
    {isHost() && (
        <button onClick={changeState}><p>{gameButtonText()}</p><img src="/elements/game/game-arrow-button.svg" width="50px"/></button>
    )}
    */


    return (
        <div className="pageContainer">
            <div className="gameStateContainer">
                {canUseShop && isShopOpened && shop()}
                {pageState()}
                {canShowScoreboard && isScoreboardOpened && scoreboard()}
            </div>
            
            {footer()}
        </div>
    );
}

export default Game;
