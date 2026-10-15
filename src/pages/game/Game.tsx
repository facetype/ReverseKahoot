import { useState } from 'react';
import '@/common/styles/game.css'

function Game() {
    const [state, setState] = useState(Number);
    const [gameState, setGameState] = useState(Number);
    const [question, setQuestion] = useState(Number);
    const [playerCount, setPlayerCount] = useState(Number);
    const [playersAnsweredCount, setPlayersAnsweredCount] = useState(Number);
    
    // edit later, this should be defined by/use a quiz's questions
    const maxQuestions = 10;

    const playerCounterText = () => {
        var playerCounterText = "";

        // example (THIS CRASHES THE PAGE!!!)
        //setPlayersAnsweredCount(4);
        //setPlayerCount(20);

        // better example
        var _playerCount = 20;
        var _playersAnsweredCount = 4;


        if (state == 0){
            playerCounterText = _playerCount.toString();
        }
        else{
            playerCounterText = _playersAnsweredCount.toString() + "/" + _playerCount.toString();
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

        if (state == 1){
            // game
            if (gameState == 0){
                // show options, reveal answer
                setGameState(1);
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

    const lobby = () => {
        return (
            <div className="lobbyContainer">
                <h1>Lobby</h1>
                <p>room code</p>
            </div>
        );
    }

    // placeholder buttons; can be replaced later should we think of an alternative way to implement a proper mechanic
    const gameOptions = () => {
        return (
            <div className="gameContainer">
                <h1>Game</h1>
                <p>options</p>
                <p>Question #{question}</p>
                <div className="gameOptionsContainer">
                    <button>Option 1</button>
                    <button>Option 2</button>
                    <button>Option 3</button>
                    <button>Option 4</button>
                </div>
            </div>
        );
    }

    const gameAnswer = () => {
        return (
            <div className="gameContainer">
                <h1>Game</h1>
                <p>answer</p>
                <p>Question #{question}</p>
                <div className="gameOptionsContainer">
                    <button>Option 1</button>
                </div>
            </div>
        );
    }

    const results = () => {
        return (
            <div className="resultsContainer">
                <h1>Winner winner chicken dinner</h1>
                <p>yay</p>
            </div>
        );
    }

    const pageState = () => {
        if (state == 0){
            return lobby()
        }

        if (state == 1){
            // game
            if (gameState == 0){
                return gameOptions();
            }
            else{
                return gameAnswer();
            }
        }

        if (state == 2){
            return results()
        }
    }

    return (
        <div className="pageContainer">
            <div className="gameStateContainer">
                {pageState()}
            </div>
            
            <div className="pageFooter">
                <div className="playerCounter">
                    <img src="/elements/game/player-count-icon.svg" width="20px"/>
                    {playerCounterText()}
                </div>
                <div className="pageButton">
                    <button onClick={changeState}><p>{gameButtonText()}</p><img src="/elements/game/game-button-advance.svg" width="50px"/></button>
                </div>
            </div>
        </div>
    );
}

export default Game;
