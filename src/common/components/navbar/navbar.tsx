import './navbar.css';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '@/pages/auth/useSession';
import { supabase } from '@/api/supabase/client';

const Navbar = () => {
  const { session, isGuest } = useSession();
  const location = useLocation();
  const onLoginPage = location.pathname === '/login';

  const handleLogOut = async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
  };

  return (
    <div className="navbar">
        <Link className="navbar-left" to="/">
          <img className="favicon" src='/favicon.svg' width="30px" height="30px"/>
        </Link>
      <div className="navbar-right">
        {session && !isGuest
            ? <>
                <Link className="navbar-host" to="/quizzes">Quizzes</Link>
                <button className="navbar-host" type="button" onClick={handleLogOut}>Log out</button>
            </>
            : !onLoginPage && (
                <Link
                  className="navbar-host"
                  to="/login"
                  state={{ from: location.pathname + location.search + location.hash }}
                >
                  Sign in
                </Link>
            )}
      </div>
    </div>
  );
};

export default Navbar;