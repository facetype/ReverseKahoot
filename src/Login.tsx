import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './utils/supabase/supabase.ts'
import {
  USERNAME_MAX,
  USERNAME_MIN,
  ensureProfile,
  isUserNameTaken,
  validateUserName,
} from './database/profile-api.ts'
import type { Profile } from './database/types.ts'
import './Login.css'

type Mode = 'signin' | 'signup' | 'reset' | 'update-password'

type Message = { kind: 'error' | 'success'; text: string } | null

const tabs: { mode: Mode; label: string }[] = [
  { mode: 'signin', label: 'Sign in' },
  { mode: 'signup', label: 'Create account' },
  { mode: 'reset', label: 'Reset password' },
]

const copy: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  signin: {
    title: 'Sign in',
    subtitle: 'Use your email and password.',
    submit: 'Sign in',
  },
  signup: {
    title: 'Create account',
    subtitle: 'Pick a username other players will see. You will receive a confirmation email.',
    submit: 'Create account',
  },
  reset: {
    title: 'Reset password',
    subtitle: 'We will email you a link to set a new password.',
    submit: 'Send reset link',
  },
  'update-password': {
    title: 'Set new password',
    subtitle: 'Choose a new password for your account.',
    submit: 'Update password',
  },
}

function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (!newSession) setProfile(null)
      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password')
        setMessage(null)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Whenever a session appears, make sure the user's Profile row exists and
  // load it so the username can be shown.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    ensureProfile(session.user)
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const text = err instanceof Error ? err.message : 'Could not load your profile.'
        setMessage({ kind: 'error', text })
      })
    return () => {
      cancelled = true
    }
  }, [session])

  function switchMode(next: Mode) {
    setMode(next)
    setMessage(null)
    setPassword('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setLoading(true)
    setMessage(null)

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const chosenName = userName.trim()
        const invalid = validateUserName(chosenName)
        if (invalid) throw new Error(invalid)
        if (await isUserNameTaken(chosenName)) throw new Error('That username is already taken.')

        // The username travels as auth metadata so the database trigger can
        // create the Profile row even when email confirmation is required.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { userName: chosenName } },
        })
        if (error) throw error
        if (!data.session) {
          setMessage({ kind: 'success', text: 'Account created. Check your email to confirm it.' })
        }
      } else if (mode === 'reset') {
        const redirectTo = `${window.location.origin}/login/`
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        if (error) throw error
        setMessage({
          kind: 'success',
          text: 'If an account exists for that email, a reset link is on its way.',
        })
      } else {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setMessage({ kind: 'success', text: 'Password updated. You are signed in.' })
        setPassword('')
        setMode('signin')
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Something went wrong.'
      setMessage({ kind: 'error', text })
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) return
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.signOut()
    if (error) setMessage({ kind: 'error', text: error.message })
    setLoading(false)
  }

  if (!supabaseConfigured) {
    return (
      <main className="auth-card">
        <h1>Login</h1>
        <p className="auth-message error">
          Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code>, fill in{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart
          the dev server.
        </p>
      </main>
    )
  }

  if (session && mode !== 'update-password') {
    return (
      <main className="auth-card">
        <h1>Signed in</h1>
        <p className="auth-user">
          You are signed in as <strong>{profile?.userName ?? session.user.email}</strong>
          {profile && <span className="auth-user-email"> ({session.user.email})</span>}
        </p>
        <button type="button" className="auth-submit" onClick={handleSignOut} disabled={loading}>
          Sign out
        </button>
        {message && <p className={`auth-message ${message.kind}`}>{message.text}</p>}
      </main>
    )
  }

  const { title, subtitle, submit } = copy[mode]
  const showEmail = mode !== 'update-password'
  const showUserName = mode === 'signup'
  const showPassword = mode !== 'reset'

  return (
    <main className="auth-card">
      {mode !== 'update-password' && (
        <div className="auth-tabs" role="tablist" aria-label="Authentication options">
          {tabs.map((tab) => (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={mode === tab.mode}
              onClick={() => switchMode(tab.mode)}
              disabled={loading}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <h1>{title}</h1>
      <p className="auth-subtitle">{subtitle}</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {showEmail && (
          <label className="auth-field">
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}

        {showUserName && (
          <label className="auth-field">
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              required
              minLength={USERNAME_MIN}
              maxLength={USERNAME_MAX}
              pattern="[A-Za-z0-9_]+"
              title="Letters, numbers and underscores only"
              spellCheck={false}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
            <span className="auth-hint">
              {USERNAME_MIN}-{USERNAME_MAX} characters. Letters, numbers and underscores.
            </span>
          </label>
        )}

        {showPassword && (
          <label className="auth-field">
            {mode === 'update-password' ? 'New password' : 'Password'}
            <input
              type="password"
              name="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Please wait...' : submit}
        </button>

        {mode === 'signin' && (
          <button type="button" className="auth-link" onClick={() => switchMode('reset')}>
            Forgot your password?
          </button>
        )}
      </form>

      {message && <p className={`auth-message ${message.kind}`}>{message.text}</p>}
    </main>
  )
}

export default Login
