export interface AnswerDraft { answerText: string; isCorrect: boolean }
export interface QuestionDraft { questionText: string; answers: AnswerDraft[] }
export interface QuizDraft { quizTitle: string; categoryId: number | null; questions: QuestionDraft[] }
export interface Profile { userId: string; userName: string }
export interface Category { categoryId: number; categoryName: string }
export interface QuizSummary { quizId: number; quizTitle: string; categoryId: number; userId: string | null }
export interface HostedGame { gameId: number; gameCode: string }
