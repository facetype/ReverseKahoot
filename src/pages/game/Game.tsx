import { useState } from 'react';
import '@/common/styles/game.css'

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
        if (currentState == 0){
            // lobby
            currentState++;
        }
        else if (currentState == 1){
            // game
            if (currentGameState == 0){
                // show options, reveal answer
                currentGameState++;
            }
            else {
                // next question
                currentGameState = 0;
                currentQuestion++;
                console.log("next question")
            }
        }
        else {
            // end quiz
            console.log("end quiz");
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
            <p>Question #{question}</p>
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
