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
                <h1>Game</h1>
                <p>options</p>
                <p>Question #{question + 1}</p>
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
            <div className="gameAnswerContainer">
                <div id="back">
                    <img src="/elements/game/spiral.svg"/>
                </div>

                <div id="front">
                    <h1>Game</h1>
                    <p>answer</p>
                    <p>Question #{question + 1}</p>
                    <button>Option 1</button>
                </div>
            </div>
        );
    }

    const results = () => {
        return (
            <div className="gameResultsContainer">
                <div id="back">
                    <img src="/elements/game/spiral.svg"/>
                </div>

                <div id="front">
                    <h1>Winner winner chicken dinner</h1>
                    <p>yay</p>
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
                    <button onClick={changeState}><p>{gameButtonText()}</p><img src="/elements/game/game-button-advance.svg" width="50px"/></button>
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
