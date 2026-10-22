// Important for managing what codepath GamePage exposes based on role in a given QuizInstance.
interface GameRole {
    isHost: boolean;
}

// Planned: quiz metadata (id + currentQuestionNumber) once the host's question
// loop exists and the instance tracks progress.

// Ledger of all player transactions during a quiz. Every payload members send
// through sendQuizInstanceEvent lands here.
interface Transaction {
    playerUUID: string; // player identifier
    type: string; // type of transaction ex. "bet"
    sentAt?: string; // server-verified send time
    payload: unknown; // specific transaction data
}

interface PlayerTransactions {
    // used to cross reference validity, on divergence a player may be asked to reconsider transactions.
    checksum: string;
    transactions: Transaction[];
}

