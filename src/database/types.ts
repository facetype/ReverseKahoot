export interface AnswerDraft { answerText: string; isCorrect: boolean }
export interface QuestionDraft { questionText: string; answers: AnswerDraft[] }
export interface QuizDraft { quizTitle: string; categoryId: number | null; questions: QuestionDraft[] }
