import { Route, Routes } from 'react-router-dom';
import QuizList from '@/pages/QuizList';
import QuizEditor from '@/pages/QuizEditor';
import LandingPage from '@/pages/LandingPage';

/* App routes. Routes are hash based (see src/main.tsx), so URLs look like /#/quizzes/new */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/quizzes" element={<QuizList />} />
      <Route path="/quizzes/new" element={<QuizEditor />} />
      <Route path="/quizzes/:quizId" element={<QuizEditor />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )
}
