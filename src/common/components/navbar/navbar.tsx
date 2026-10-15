import './navbar.css';
import { Link } from 'react-router-dom';
import { useSession } from '@/pages/auth/useSession';
import { supabase } from '@/api/supabase/client';

const Navbar = () => {
  const { session } = useSession();

  const handleLogOut = async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
  };

  return (
    <div className="navbar">
      <div className="navbar-left">
        <Link className="navbar-host" to="/">
          <img className="favicon" src='/public/favicon.svg' width="30px" height="30px"/>
        </Link>
      </div>
      <div className="navbar-right">
        {session
            ? <>
                <Link className="navbar-host" to="/quizzes">Search Quiz</Link>
                <button className="navbar-host" type="button" onClick={handleLogOut}>Log out</button>
            </>
            : <a className="navbar-host" href="/login/">Sign in</a>}
      </div>
    </div>
  );
};

export default Navbar;