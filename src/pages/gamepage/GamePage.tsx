import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/pages/auth/useSession';

import {
    getQuizInstance,
    isQuizInstanceMember,
    type QuizInstanceSession,
} from '@/api/supabase/quiz-instance-api';
import {
    sendQuizInstanceEvent,
    subscribeToQuizInstance,
    unsubscribeFromQuizInstance,
    type QuizInstanceEventMessage,
    type QuizChannelHandlers,
} from '@/api/supabase/realtime-api';

import {
    getQuiz,
} from '@/api/supabase/quiz-api.ts';
import {type RealtimeChannel, } from '@supabase/supabase-js';
import {type GameRole, type Transaction, type PlayerTransactions, } from '@pages/gamepage/GamePageTypes';
import {generateTransactionsChecksum,} from '@pages/gamepage/TransactionChecksum';
import Navbar from '@/common/components/navbar/navbar';
import '@/common/styles/quiz.css';
import './GamePage.css';



const onPlayerJoined = (players: string[]) =>{
    console.log(players);
    //What to do when a player joins
    //irrelevant to the post start game
    return;
    }
const onStarted = () => {
    // What to do when a game starts
    // Irrelevant post start
    return;
}
const onEvent = (event: string, message: QuizInstanceEventMessage) => {
    //What to do on an event in a realtime channel
    //Very relevant for this codefile
    appendRealtimeMessage(event, message);
}
const onClose = ()=>{return;}


// The event name for free-form messages players send while the game runs.
// The server reserves game-created/player-joined/game-started.
const PLAYER_MESSAGE_EVENT = 'player-message';
const LEDGER_LIMIT = 50;


function GamePage() {
    const { instanceId = '' } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    function appendRealtimeMessage(event: string, message: QuizInstanceEventMessage){
        
    }


    const { session, loading: sessionLoading } = useSession();

    const [instanceData, setInstanceData] = useState<QuizInstanceSession | null>(null);
    const [quizData, setQuizData] = useState<any | null>(null);
    const [supabaseChannel, setSupabaseChannel] = useState<RealtimeChannel | null>(null);
    const channelHandler: QuizChannelHandlers = new(onPlayerJoined, onStarted, onEvent, onClose);
    const [questionNumber, setQuestionNumber] = useState<number>();
    const realtimeData: Transaction[];

    
    // Every payload received on the game channel, newest first. The checksum
    // stays empty until divergence checking between host and players exists.
    const [ledger, setLedger] = useState<PlayerTransactions>({ checksum: '', transactions: [] });

    const lobbyPath = `/lobby/${instanceId}`;

    // Reconnect after a reload: the navigation state is gone, so read the row.
    // RLS only lets the host and the joined players see the instance, so an
    // unreadable game means "not yours". A game that has not started yet
    // belongs back in the lobby.
    useEffect(() => 
    {
        if(!instanceId){ return; }

        const getQuizData = async()=>
        {
            const resultQuizInstance = await getQuizInstance(instanceId);
            if(resultQuizInstance){
                setInstanceData(resultQuizInstance);
            }
            if(resultQuizInstance.quizId){
                const resultQuiz = await getQuiz(resultQuizInstance.quizId);
                setQuizData(resultQuiz);
            }
        }
        const getRealtimeChannel = async()=>
        {
            const resolvedChannel = await subscribeToQuizInstance(instanceId);
            setSupabaseChannel(resolvedChannel);
        }
        getQuizData();
        getRealtimeChannel();
        
        
    }, [instanceId]);

    useEffect(() => {

    }, [realtimeData]);

    return (
        <div className="game-page">
            <Navbar />
            <main className="game-main">
                <h1 className="center-text">{quizData ? quizData.quizTitle : 'Game'}</h1>

                
            </main>
        </div>
    );
}

// Renders a transaction's payload for the ledger: objects are shown as JSON,
// primitives as plain text.
function renderPayload(transaction: Transaction): string {
    const payload = transaction.payload;
    if (payload == null) return '—';
    if (typeof payload === 'object') {
        try {
            return JSON.stringify(payload);
        } catch {
            return '—';
        }
    }
    return String(payload);
}

export default GamePage;
