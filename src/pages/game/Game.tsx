import { useState, useEffect } from 'react';
import '@/common/styles/game.css'

const preloads = [
    "/elements/game/spiral.svg",
    "/elements/game/shop-icon.svg",
    "/elements/game/hint-icon.svg",
    "/elements/game/cut-options-icon.svg",
    "/elements/game/reveal-answer-icon.svg",
    "/elements/game/points-icon.svg",
    "/elements/game/player-count-icon.svg",
    "/elements/game/game-arrow-button.svg",
    "/elements/game/win_badge_gold.svg",
    "/elements/game/win_badge_silver.svg",
    "/elements/game/win_badge_bronze.svg",
    "/elements/game/gold-podium.svg",
    "/elements/game/silver-podium.svg",
    "/elements/game/bronze-podium.svg",
    "/elements/game/stickers/sticker-bird.svg",
    "/elements/game/stickers/sticker-horse.svg",
    "/elements/game/stickers/sticker-rose.svg",
];

function Game() {

    //#region state variables
    const [state, setState] = useState<number>(0);
    const [gameState, setGameState] = useState<number>(0);
    const [playerType, setPlayerType] = useState<"host"|"player"|"">("player");
    const isHost = () => playerType === "host";
    const isPlayer = () => playerType === "player";
    const inGame = state === 1;
    const inResults = state === 2;
    const canUseShop = isPlayer() && inGame && gameState === 0;
    const canUseScoreboard = inGame;
    const canShowScoreboard = inGame || inResults;
    //#endregion

    //#region game variables
    const [players, setPlayers] = useState<number>(0); // example value
    const [playerPoints, setPlayerPoints] = useState<number>(1000);
    const [playerBet, setPlayerBet] = useState<number>(0);
    const [playersAnswered, setPlayersAnswered] = useState<number>(0); // example value
    const [question, setQuestion] = useState<number>(0);

    const [selectedOption, setSelectedOption] = useState<number | null>(null);
    const [placedBet, setPlacedBet] = useState<{ option: number; amount: number} | null>(null);
    const [betResult, setBetResult] = useState<{ won: boolean; amount: number } | null>(null);
    const correctOption = 1;
    const betLocked = placedBet !== null;
    const shownPlayerBet = Math.min(playerBet, playerPoints);
    
    const stickerCollection = [
        "/elements/game/stickers/sticker-bird.svg", 
        "/elements/game/stickers/sticker-horse.svg",
        "/elements/game/stickers/sticker-rose.svg"];

    // edit later, this should be defined by/use a quiz's questions
    const maxQuestions = 9;
    const optionIds = [1, 2, 3, 4];

    //#endregion

    //#region shop & scoreboard variables
    const [hintCost, setHintCost] = useState(playerPoints*0.1); // 10% of player's starting points
    const [purchasedThisQuestion, setPurchasedThisQuestion] = useState<string[]>([]);
    const [isScoreboardOpened, setIsScoreboardOpened] = useState(false);
    const [isShopOpened, setIsShopOpened] = useState(false);
    const [busy, setBusy] = useState(false);
    const shopItemIsPurchased = (shopItemId: string) => purchasedThisQuestion.includes(shopItemId);
    const [removedOptions, setRemovedOptions] = useState<number[]>([]);
    const [answerRevealed, setAnswerRevealed] = useState<boolean>(false);
    //#endregion

    useEffect(() => {
        preloads.forEach(src => {
            const img = new Image();
            img.src = src;
        });
    }, []);

    //#region  subpages & menus
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
        const badgeAmount = placedBet ? placedBet.amount : shownPlayerBet;
        return (
            <div className="gameContainer">
                <p>Bet on the correct answer that suits Question #{question + 1}...</p>
                {shopItemIsPurchased("hint") && (
                    <div className="gameHintContainer"><p>Hint: It's not Option 4</p></div>
                )}
                <div className="gameOptionsContainer">
                    {optionIds.map(option =>{
                        const removed = removedOptions.includes(option);
                        const revealed = answerRevealed && option === correctOption;
                        const classes = [
                            selectedOption === option ? "selected" : "",
                            removed ? "removed" : "",
                            revealed ? "revealed" : "",
                        ].join(" ").trim();

                        return (
                            <div className="gameOptionContainer" key={option}>
                                <button
                                    className={classes}
                                    onClick={() => selectOption(option)}
                                    disabled={betLocked || !isPlayer() || removed}>
                                    Option {option}
                                </button>
                                {selectedOption == option && badgeAmount > 0 && (
                                    <div className="gameOptionBetContainer">
                                        <span>{badgeAmount} pts</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                
                {isPlayer() && selectedOption !== null && (
                    <div className="gameBetContainer">
                        <p>You chose 'Option {selectedOption}'.</p>
                        <p>How much do you want to bet?</p>
                        <div className="gameBetInputContainer">
                            <input
                                id="slider"
                                type="range"
                                min={0}
                                max={playerPoints}
                                value={shownPlayerBet}
                                onChange={e => setPlayerBet(Number(e.target.value))}
                                aria-label="Bet amount slider"
                                disabled={playerPoints === 0}>
                            </input>
                            <input
                                id="input"
                                type="number"
                                min={0}
                                max={playerPoints}
                                step={1}
                                inputMode="numeric"
                                value={shownPlayerBet}
                                onChange={e => setPlayerBet(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                                disabled={busy}>
                            </input><p>pts</p>
                            <div className="gameBetButton"><button onClick={placeBet} disabled={shownPlayerBet <= 0}>BET</button></div>
                        </div>
                    </div>
                )}
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
                    <p>'Option {correctOption}' was correct!</p>
                    <p>Question #{question + 1} was 'INSERT QUESTION HERE'</p>
                    <button>Option {correctOption}</button>
                    {betResult && (
                        <p>
                            {betResult.won
                                ? `You won ${betResult.amount} pts!`
                                : `You lost ${betResult.amount} pts!`}
                        </p>
                    )}
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

    const shop = () => {
        // Hint: 100 pts (increases by 10% the more you buy a hint)
        // Cut options: 50% of your current points
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
                    <button onClick={() => {if (deductPlayerPoints("cut-options", Math.floor(playerPoints/2))) shopCutOptions()}}
                            disabled={shopItemIsPurchased("cut-options") || betLocked}>
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
                    <button onClick={() => {if (deductPlayerPoints("reveal-answer", Math.floor(playerPoints*0.9))) shopRevealCorrectOption()}}
                            disabled={shopItemIsPurchased("reveal-answer") || betLocked}>
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

    const footer = () => {
        /*
        <div className="pageFooterButton">
            <button onClick={devAddPlayer}>Add player</button>
        </div>
        
        <div className="pageFooterButton">
            <button onClick={devPlayerRandomAnswer}>Add Random Player Answer</button>
        </div>
        */

        /*
        {isHost() && (
            <button onClick={changeState}><p>{gameButtonText()}</p><img src="/elements/game/game-arrow-button.svg" width="50px"/></button>
        )}
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
    //#endregion

    //#region functions
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
                setIsShopOpened(false);
                setGameState(1);
                setPlayersAnswered(0);

                if (placedBet) {
                    const win = placedBet.option == correctOption;

                    if (win) {
                        setPlayerPoints(prev => prev + placedBet.amount * 2);
                    }
                    setBetResult({won: win, amount: placedBet.amount});
                }
                else {
                    setBetResult(null);
                }
            }
            else{
                // reveal answer, next question
                setGameState(0);
                setPurchasedThisQuestion([]);
                setSelectedOption(null);
                setPlacedBet(null);
                setPlayerBet(0);
                setBetResult(null);
                setRemovedOptions([]);
                setAnswerRevealed(false);
                
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
    
    const deductPlayerPoints = (shopItemId: string = "", cost: number, isHint:boolean = false): boolean => {
        if (Math.floor(cost) > playerPoints) return false;
        if (purchasedThisQuestion.includes(shopItemId)) return false;

        if (isHint) {
            setHintCost(Math.floor(hintCost*1.1));
        }

        setPlayerPoints(Math.floor(playerPoints - cost));
        setPurchasedThisQuestion([... purchasedThisQuestion, shopItemId]);
        return true;
    }

    const toggleScoreboard = () => {
        if (!canUseScoreboard) return;
        setIsScoreboardOpened(!isScoreboardOpened);
    }

    const toggleShop = () => {
        if (!canUseShop) return;
        setIsShopOpened(!isShopOpened);
    }

    const shopCutOptions = () => {
        const wrong = optionIds.filter(o => o !== correctOption);
        const keep = wrong[Math.floor(Math.random() * wrong.length)];
        const removed = wrong.filter(o => o !== keep);
        
        setRemovedOptions(removed);
        if (selectedOption !== null && removed.includes(selectedOption)) {
            setSelectedOption(null);
        }
    }

    const shopRevealCorrectOption = () => {
        setAnswerRevealed(true);
        //setSelectedOption(correctOption);
    }

    const selectOption = (option: number) => {
        if (betLocked || !isPlayer()) return;
        setSelectedOption(option);
    }

    const placeBet = () => {
        if (selectedOption === null || betLocked) return;
        if (shownPlayerBet <= 0) return;

        setPlayerPoints(playerPoints - shownPlayerBet);
        setPlacedBet({option: selectedOption, amount: shownPlayerBet}); 
    }

    //#endregion

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
