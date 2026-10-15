import { useState } from 'react';
import '@/pages/game/game.css'

function Game() {
    const [state, setState] = useState(0);
    const [gameState, setGameState] = useState(0);
    const [question, setQuestion] = useState(0);
    
    var currentState = 0; // 0 = lobby, 1 = game, 2 = end
    var currentGameState = 0; // 0 = gameOptions, 1 = gameAnswer
    
    // edit later, this should be defined by/use a quiz's questions
    var currentQuestion = 0;
    const maxQuestions = 20;

    const gameButtonText = () => {
        if (state == 0){
            return "Start quiz";
        }
        else if (state == 1){
            if (gameState == 0){
                return "Reveal answer";
            }
            else {
                return "Next question";
            }
            
        }
        else {
            return "End quiz";
        }
    };

    const changeState = () => {
        if (currentState == 1){ // we're in the game, so run through the two states (show options, reveal answer & results)
            currentGameState++;
            console.log("we are gaming, game state:", currentGameState);
        }
        else {
            currentState++; // advance to game (we start at the lobby)
            currentQuestion++;
        }

        // the game after showing all questions
        if (currentGameState == 1){
            if (currentQuestion == maxQuestions){
                currentState++;
                currentGameState = 2; // end quiz
            }
        }

        if (currentState == 2){
            console.log("game ended")
        }

        setState(currentState);
        setGameState(currentGameState);
        setQuestion(currentQuestion);

        console.log("state:", state);
        console.log("game state:", gameState);
        console.log("question:", question);
    }

    return (
        <div className="gameContainer">
            <h1>Game</h1>
            <p>game</p>

            <div className="gameFooter">
                <div className="playerCounter">
                    4/20
                </div>
                <div className="gameButton">
                    <button onClick={changeState}><p>{gameButtonText()}</p></button>
                    
                </div>
            </div>
        </div>
    );
}

export default Game;
