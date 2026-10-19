import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getQuizInstance,
    startQuizInstance,
    subscribeToQuizInstance,
    unsubscribeFromQuizInstance,
    type QuizInstanceSession,
} from '@/api/supabase/quiz-instance-api';
import '@/common/styles/quiz.css';
import './GamePage.css';
import Navbar from '@/common/components/navbar/navbar';

//Important for managing what codepath GamePage exposes based on role in a given QuizInstance
interface GameRole {
    isHost: false;
}

// Used to store what quiz players are playing, and other critical metadata
// Associated with every quiz.
interface QuizMetadata {
    id: string;
    currentQuestionNumber: number;
}

//Ledger of all player transactions during a quiz
interface Transaction {
    playerUUID: string; //player identifier
    type: string; // type of transaction ex. "bet"
    payload: string; // spesific transaction data
}

interface PlayerTransactions {
    //used to cross reference validity, on divergence a player may be asked to reconsider transactions.
    checksum: string;
    Transactions: Transaction[];
}

function GamePage() {
    string quizInstanceId = getQuizInstance();
    var channel = subscribeToQuizInstance(quizInstanceId);
    };

    return (
        <div className="game-page">
        <Navbar />

            <main className="game-main">
                
            </main>
        </div>
    );
}

export default GamePage;
