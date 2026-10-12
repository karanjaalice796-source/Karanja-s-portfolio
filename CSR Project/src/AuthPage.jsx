import React, { useState } from 'react';
import './AuthPage.css';
import { supabase, supabaseConfigured } from './supabaseClient.js';

function AuthPage({ onContinueAsGuest, onAuthenticated }) {
  const [mode, setMode] = useState('signup');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchMode(nextMode) {
    setMode(nextMode);
    setNotice('');
    setErrorMessage('');
    setShowPassword(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setNotice('');
    setErrorMessage('');

    if (!supabase) {
      setErrorMessage('Account access is not configured yet. Add the Supabase project URL and publishable key to .env.local, then restart the app.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email'));
    const password = String(formData.get('password'));
    setIsSubmitting(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: String(formData.get('name')),
              role: String(formData.get('role')),
              updates: formData.get('updates') === 'on',
            },
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) throw error;
        if (data.session) {
          onAuthenticated(data.session);
        } else {
          setNotice('Your account was created. Check your email to confirm your address, then log in to enter the portal.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuthenticated(data.session);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not complete account access. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSignUp = mode === 'signup';

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Empower Hope">
        <a className="auth-brand" href="#home" onClick={(event) => { event.preventDefault(); onContinueAsGuest(); }}>
          <span className="auth-brand-mark">EH</span>
          <span>Empower Hope<small>LEARNING PORTAL</small></span>
        </a>

        <div className="auth-story-copy">
          <span className="auth-kicker"><span aria-hidden="true">✦</span> LEARN WITHOUT LIMITS</span>
          <h1>Every learner<br />deserves a chance<br />to <em>shine.</em></h1>
          <p>Find free learning resources, build digital skills, and grow together with your school community.</p>
        </div>

        <div className="auth-story-footer">
          <div className="auth-people" aria-hidden="true"><span>A</span><span>J</span><span>M</span><span>+</span></div>
          <p><strong>Learning belongs to everyone.</strong><br />Made for connected and offline classrooms.</p>
        </div>
        <span className="auth-decoration auth-decoration-one" aria-hidden="true"></span>
        <span className="auth-decoration auth-decoration-two" aria-hidden="true"></span>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand">
            <span className="auth-brand-mark">EH</span>
            <span>Empower Hope<small>LEARNING PORTAL</small></span>
          </div>

          <div className="auth-heading">
            <p className="auth-overline">{isSignUp ? 'YOUR LEARNING JOURNEY STARTS HERE' : 'WELCOME BACK'}</p>
            <h2 id="auth-title">{isSignUp ? 'Create your account' : 'Good to see you again'}</h2>
            <p>{isSignUp ? 'Join your school community and explore new possibilities.' : 'Sign in to continue learning and sharing.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button id="signup-tab" className={isSignUp ? 'is-selected' : ''} type="button" role="tab" aria-selected={isSignUp} aria-controls="auth-form" onClick={() => switchMode('signup')}>Create account</button>
            <button id="login-tab" className={!isSignUp ? 'is-selected' : ''} type="button" role="tab" aria-selected={!isSignUp} aria-controls="auth-form" onClick={() => switchMode('login')}>Log in</button>
          </div>

          <form id="auth-form" className="auth-form" onSubmit={handleSubmit} aria-labelledby={isSignUp ? 'signup-tab' : 'login-tab'}>
            {isSignUp && (
              <>
                <label className="auth-field">Full name
                  <input autoComplete="name" name="name" placeholder="e.g. Amina Wanjiku" required />
                </label>
                <label className="auth-field">I am a
                  <select name="role" defaultValue="" required>
                    <option value="" disabled>Select your role</option>
                    <option>Student</option>
                    <option>Teacher</option>
                    <option>Parent or caregiver</option>
                    <option>Community member</option>
                  </select>
                </label>
              </>
            )}
            <label className="auth-field">Email address
              <input autoComplete="email" name="email" type="email" placeholder="you@example.com" required />
            </label>
            <label className="auth-field">Password
              <span className="auth-password-wrap">
                <input autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength={8} name="password" placeholder="At least 8 characters" required type={showPassword ? 'text' : 'password'} />
                <button className="auth-show-password" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {isSignUp ? (
              <label className="auth-consent"><input name="updates" type="checkbox" /><span>Send me occasional updates about new learning resources.</span></label>
            ) : (
              <label className="auth-consent"><input name="remember" type="checkbox" /><span>Remember me on this device</span></label>
            )}
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
            {!supabaseConfigured && <p className="auth-setup-hint">Connect a Supabase project to enable accounts. Guest access is available below.</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}<span aria-hidden="true">→</span></button>
          </form>

          <div className="auth-divider"><span>OR</span></div>
          <button className="auth-guest" type="button" onClick={onContinueAsGuest}>Explore the portal as a guest <span aria-hidden="true">↗</span></button>
          <p className="auth-privacy">Free learning resources, ready for your whole school community.</p>
        </div>
      </section>
    </main>
  );
}

export default AuthPage;
