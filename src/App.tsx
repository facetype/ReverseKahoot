import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase/supabase'

interface Quiz {
  quizId: number
  quizTitle: string
}

export default function App() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([])

  useEffect(() => {
    async function getQuiz() {
      const { data, error } = await supabase.from('Quiz').select()

      if (error) {
        console.error('Error fetching quizzes:', error)
        return
      }

      if (data) {
        setQuizzes(data)
      }
    }

    getQuiz()
  }, [])

  return (
    <ul>
      {quizzes.map((quiz) => (
        <li key={quiz.quizId}>{quiz.quizTitle}</li>
      ))}
    </ul>
  )
}