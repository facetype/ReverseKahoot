import { useEffect } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabase/client';
import QuizList from '@/pages/quizcrud/QuizList';
import QuizEditor from '@/pages/quizcrud/QuizEditor';
import LandingPage from '@/pages/landingpage/LandingPage';
import Login from '@/pages/auth/Login';

/* App routes. Routes are hash based (see src/main.tsx), so URLs look like /#/quizzes/new */
export default function AppRoutes() {
  const navigate = useNavigate();

  // Password reset emails land on the site root; send the user to the login
  // page so they can set a new password.
  useEffect(() => {
    if (!supabase) return;
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') navigate('/login', { state: { recovery: true } });
    });
    return () => listener.subscription.unsubscribe();
  }, [navigate]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/quizzes" element={<QuizList />} />
      <Route path="/quizzes/new" element={<QuizEditor />} />
      <Route path="/quizzes/:quizId" element={<QuizEditor />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )
}
