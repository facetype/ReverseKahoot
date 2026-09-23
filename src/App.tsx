import { useEffect, useState } from 'react'
import { listQuizzes } from './database/quiz-api'
import type { QuizSummary } from './database/types'

// Example component: lists quiz titles. Not mounted anywhere; see Home.tsx.
export default function App() {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])

  useEffect(() => {
    listQuizzes()
      .then(setQuizzes)
      .catch((error: unknown) => console.error('Error fetching quizzes:', error))
  }, [])

  return (
    <ul>
      {quizzes.map((quiz) => (
        <li key={quiz.quizId}>{quiz.quizTitle}</li>
      ))}
    </ul>
  )
}
