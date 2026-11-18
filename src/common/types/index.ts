export interface AnswerDraft { answerId?: number; answerText: string; isCorrect: boolean }
export interface HintDraft { hintId?: number; hintText: string; hintCost: number }

export interface QuestionDraft { questionText: string; answers: AnswerDraft[]; hints: HintDraft[] }
export interface QuizDraft { quizTitle: string; categoryId: number | null; questions: QuestionDraft[] }
export interface Profile { userId: string; userName: string }
export interface Category { categoryId: number; categoryName: string }
export interface QuizSummary { quizId: number; quizTitle: string; categoryId: number; userId: string | null; userName: string | null }
