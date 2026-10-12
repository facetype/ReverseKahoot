import './navbar.css';
import { Link } from 'react-router-dom';
import { useSession } from '@/features/auth/useSession';
import { supabase } from '@/api/supabase/client';
import { useState, type FormEvent } from 'react';

const Navbar = () => {
  const { session } = useSession();
  const [message, setMessage] = useState<string | null>(null);

  const handleLogOut = async () => {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) setMessage(error.message);
  };

  return (
    <div className="navbar">
      <div className="navbar-left">
        <img className="favicon" src='../../../../public/favicon.svg' width="30px" height="30px"/>
      </div>
      <div className="navbar-right">
        {session
            ? <>
                <Link className="navbar-host" to="/">Join Quiz</Link>
                <Link className="navbar-host" to="/quizzes">Search Quiz</Link>
                <button className="navbar-host" type="button" onClick={handleLogOut}>Log out</button>
            </>
            : <a className="navbar-host" href="/login/">Sign in</a>}
      </div>
    </div>
  );
};

export default Navbar;