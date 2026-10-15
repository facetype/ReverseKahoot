import { useState } from 'react';
import '@/common/styles/game.css'

function Game() {
    const [state, setState] = useState(Number);
    const [gameState, setGameState] = useState(Number);
    const [question, setQuestion] = useState(Number);
    
    // edit later, this should be defined by/use a quiz's questions
    const maxQuestions = 10;

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

        console.log("state:", state);
        console.log("game state:", gameState);
        console.log("question:", question);
    }

    return (
        <div className="gameContainer">
            <h1>Game</h1>
            <p>game</p>
            <p>Question #{question + 1}</p>
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
