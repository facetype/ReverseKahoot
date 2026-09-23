import { Route, Routes } from 'react-router-dom';
import QuizList from './pages/QuizList';
import QuizEditor from './pages/QuizEditor';

/* Home page. Routes are hash based (see main.tsx), so URLs look like /#/quizzes/new */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<QuizList />} />
      <Route path="/quizzes/new" element={<QuizEditor />} />
      <Route path="/quizzes/:quizId" element={<QuizEditor />} />
      <Route path="*" element={<QuizList />} />
    </Routes>
  )
}
