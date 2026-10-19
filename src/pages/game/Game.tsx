import { useState } from 'react';
import '@/common/styles/game.css'

function Game() {
    const [state, setState] = useState(Number);
    const [gameState, setGameState] = useState(Number);
    const [question, setQuestion] = useState(Number);
    const [players, setPlayers] = useState(Number); // example value
    const [playersAnswered, setPlayersAnswered] = useState(Number); // example value
    
    // edit later, this should be defined by/use a quiz's questions
    const maxQuestions = 9;

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
                
                if (question >= maxQuestions){
                    setQuestion(0);
                    setState(2);
                }
                else{
                    setQuestion(question + 1);
                }
            }
        }

        //console.log("state:", state);
        //console.log("game state:", gameState);
        //console.log("question:", question);
    }

    //#region subpages & subpage components 
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

                <div id="front" style={{flex:'1'}}>
                    <p>'Option 1' was correct!</p>
                    <p>Question #{question + 1} was 'INSERT QUESTION HERE'</p>
                    <button>Option 1</button>
                </div>
                {scoreboard()}
            </div>
        );
    }

    const results = () => {
        return (
            <div className="gameResultsContainer">
                <div id="back" className="spiralBackground">
                    <img src="/elements/game/spiral.svg"/>
                </div>

                <div id="front" style={{flex:'1'}}>
                    <h1>FINAL RESULTS</h1>
                    <p>The winners of today's quiz are...</p>
                    <div className="gameResultsQuizWinnersContainer">
                        <div className="gameResultsSecondPlaceContainer">
                            <img src="/elements/game/win_badge_silver.svg" width="30px"/>
                            <p>[Insert Sticker]</p>
                            <div id="front" className="gameResultsNameplateContainer">
                                <p>Player 2</p>
                            </div>
                            <div id="back" className="gameResultsSilverPodium">
                                <img src="/elements/game/silver-podium.svg" width="300px"/>
                            </div>
                        </div>
                        
                        <div className="gameResultsFirstPlaceContainer">
                            <img src="/elements/game/win_badge_gold.svg" width="30px"/>
                            <p>[Insert Sticker]</p>
                            <div id="front" className="gameResultsNameplateContainer">
                                <p>Player 1</p>
                            </div>
                            <div id="back" className="gameResultsGoldPodium">
                                <img src="/elements/game/gold-podium.svg" width="300px"/>
                            </div>
                        </div>
                        
                        <div className="gameResultsThirdPlaceContainer">
                            <img src="/elements/game/win_badge_bronze.svg" width="30px"/>
                            <p>[Insert Sticker]</p>
                            <div id="front" className="gameResultsNameplateContainer">
                                <p>Player 3</p>
                            </div>
                            <div id="back" className="gameResultsBronzePodium">
                                <img src="/elements/game/bronze-podium.svg" width="300px"/>
                            </div>
                        </div>
                    </div>
                </div>
                {scoreboard()}
            </div>
        );
    }

    //#region scoreboard
    const scoreboard = () => {
        return (
        <div id="front" className="gameAnswerScoreboardContainer">
            <h3>Scoreboard</h3>
            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 1</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 2</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>
            
            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 3</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>
            
            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 4</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>
            
            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 5</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 6</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 7</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 8</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 9</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 10</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 11</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 12</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 13</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 14</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 15</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 16</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>

            <div className="gameAnswerScoreboardPlayerContainer">
                <p>Player 17</p>
                <div className="gameAnswerScoreboardPlayerPointsContainer">
                    <p>1130 pts</p>
                </div>
            </div>
        </div>
        );
    }
    //#endregion
    //#endregion

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

    const devAddPlayer = () => {
        setPlayers(players + 1);
    }

    const devPlayerRandomAnswer = () => {
        if (playersAnswered < players) {
            setPlayersAnswered(playersAnswered + 1)
        }
    }

    const footer = () => {
        return (
            <div id="front" className="pageFooter">
                <div className="pageFooterButton">
                    <button onClick={devAddPlayer}>Add player</button>
                </div>
                
                <div className="pageFooterButton">
                    <button onClick={devPlayerRandomAnswer}>Add Random Player Answer</button>
                </div>

                <div className="playerCounter">
                    <img src="/elements/game/player-count-icon.svg" width="20px"/>
                    {playerCounterText()}
                </div>

                <div className="pageButton">
                    <button onClick={changeState}><p>{gameButtonText()}</p><img src="/elements/game/game-arrow-button.svg" width="50px"/></button>
                </div>
            </div>
        );
    }

    return (
        <div className="pageContainer">
            <div className="gameStateContainer">
                {pageState()}
            </div>
            
            {footer()}
        </div>
    );
}

export default Game;
